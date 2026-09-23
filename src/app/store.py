"""
Data access + governed calculation recording.

Read paths return the book, scenarios, assumptions, results and audit trail.
Write paths (create/edit/calculate/select/submit/review) each (a) mutate the
scenario, (b) — for calculate — persist an immutable `indication_results` row,
and (c) append an event to `indication_audit_log`. Nothing that changes state
does so without an audit event; nothing is "calculated" without being recorded.

The arithmetic itself is the shared `indication_engine` (single source of truth,
also validated offline). NOTE (revisit): the mechanics run in-process here for
instant feedback; the roadmap is to move them into a governed UC function/job so
the app computes nothing at all — see project notes.
"""
from __future__ import annotations
import hashlib
import json
import uuid
from datetime import date
from typing import Any

from config import fqn, current_user, BOOK_FLAVOUR
from sql import execute_query
from indication_engine import (
    ExperienceYear, calc_segment, decompose, CALC_VERSION,
    ASSUMPTION_ORDER, ASSUMPTION_META,
)
import on_level

CURRENCY = {"eu_commercial": "EUR", "us_retail": "USD"}.get(BOOK_FLAVOUR, "EUR")


def _f(x): return float(x) if x is not None else None
def _i(x): return int(float(x)) if x is not None else None
def _b(x): return str(x).lower() == "true"


# --------------------------------------------------------------------------- meta
async def meta() -> dict[str, Any]:
    lobs = await execute_query(f"SELECT lob_code, lob_label, tail, display_order FROM {fqn('line_of_business')} ORDER BY display_order")
    terrs = await execute_query(f"SELECT territory_code, territory_label, region FROM {fqn('territory')} ORDER BY display_order")
    periods = await execute_query(f"SELECT DISTINCT indication_period FROM {fqn('indication_scenarios')} ORDER BY indication_period")
    ver = await execute_query(f"SELECT max(experience_version) v FROM {fqn('indication_experience')}")
    roles = await execute_query(f"SELECT min_abs_change, max_abs_change, approver_role, note FROM {fqn('approval_role')} ORDER BY min_abs_change")
    return {
        "entity_name": None,  # filled by route from config
        "currency": CURRENCY,
        "calc_version": CALC_VERSION,
        "experience_version": ver[0]["v"] if ver else None,
        "products": [{"code": r["lob_code"], "label": r["lob_label"], "tail": r["tail"]} for r in lobs],
        "territories": [{"code": r["territory_code"], "label": r["territory_label"], "region": r["region"]} for r in terrs],
        "periods": [_i(r["indication_period"]) for r in periods] or [2027],
        "assumptions": [{"name": n, **ASSUMPTION_META[n]} for n in ASSUMPTION_ORDER],
        "approval_roles": [{"min": _f(r["min_abs_change"]), "max": _f(r["max_abs_change"]),
                            "role": r["approver_role"], "note": r["note"]} for r in roles],
    }


# ---------------------------------------------------------------- experience load
async def _segment_experience(lob: str, terr: str, version: str | None = None) -> tuple[list[ExperienceYear], float]:
    # Filter by the pinned experience_version when given (reproducibility); else latest.
    vclause = "AND experience_version = :ver" if version else \
        "AND experience_version = (SELECT max(experience_version) FROM {t} WHERE lob_code=:lob AND territory_code=:terr)".format(t=fqn('indication_experience'))
    rows = await execute_query(
        f"""SELECT accident_year, earned_premium, reported_incurred, claim_count, exposure,
                   rate_level_index, ldf_to_ultimate
            FROM {fqn('indication_experience')}
            WHERE lob_code = :lob AND territory_code = :terr {vclause} ORDER BY accident_year""",
        {"lob": lob, "terr": terr, **({"ver": version} if version else {})})
    exp = [ExperienceYear(
        accident_year=_i(r["accident_year"]), earned_premium=_f(r["earned_premium"]),
        reported_incurred=_f(r["reported_incurred"]), claim_count=_i(r["claim_count"]),
        exposure=_f(r["exposure"]), rate_level_index=_f(r["rate_level_index"]),
        ldf_to_ultimate=_f(r["ldf_to_ultimate"])) for r in rows]
    rs = await execute_query(
        f"SELECT current_rate_level FROM {fqn('segment_rate_state')} WHERE lob_code=:lob AND territory_code=:terr",
        {"lob": lob, "terr": terr})
    crl = _f(rs[0]["current_rate_level"]) if rs else 1.0
    return exp, crl


async def assumptions_for(scenario_id: str) -> tuple[dict[str, float], dict[str, float]]:
    rows = await execute_query(
        f"SELECT assumption_name, assumption_value, baseline_value FROM {fqn('indication_assumptions')} WHERE scenario_id=:sid",
        {"sid": scenario_id})
    cur = {r["assumption_name"]: _f(r["assumption_value"]) for r in rows}
    base = {r["assumption_name"]: _f(r["baseline_value"]) for r in rows}
    return cur, base


async def baseline_scenario_id(lob: str, terr: str, period: int) -> str:
    return f"baseline-{lob}-{terr}-{period}"


def _result_dict(res) -> dict[str, Any]:
    return {
        "indicated_rate_change": res.indicated_rate_change,
        "projected_loss_ratio": res.projected_loss_ratio,
        "permissible_loss_ratio": res.permissible_loss_ratio,
        "experience_loss_ratio": res.experience_loss_ratio,
        "on_level_earned_premium": res.on_level_earned_premium,
        "projected_ultimate_loss": res.projected_ultimate_loss,
        "required_premium": res.required_premium,
        "current_rate_level": res.current_rate_level,
        "detail_years": res.detail_years,
        # premium-basis measures (Phase 1A)
        "total_earned_premium": res.total_earned_premium,
        "raw_reported_loss_ratio": res.raw_reported_loss_ratio,
        "on_level_reported_loss_ratio": res.on_level_reported_loss_ratio,
        "overall_on_level_factor": res.overall_on_level_factor,
        "on_level_method": res.on_level_method,
    }


# ------------------------------------------------------ on-level premium plumbing
async def _rate_state(lob: str, terr: str) -> dict[str, Any]:
    rs = await execute_query(
        f"""SELECT current_rate_level, baseline_effective_date, baseline_rate_index,
                   history_complete_from, reference_rate_date, policy_term_days, on_level_method,
                   rate_history_version
            FROM {fqn('segment_rate_state')} WHERE lob_code=:lob AND territory_code=:terr""",
        {"lob": lob, "terr": terr})
    return rs[0] if rs else {}


async def default_premium_settings(lob: str, terr: str) -> dict[str, Any]:
    rs = await _rate_state(lob, terr)
    return {
        "method": rs.get("on_level_method") or on_level.LEGACY,
        "reference_rate_date": str(rs.get("reference_rate_date") or "2026-01-01"),
        "baseline_effective_date": str(rs.get("baseline_effective_date") or "2018-01-01"),
        "baseline_rate_index": _f(rs.get("baseline_rate_index")) or 1.0,
        "policy_term_days": _i(rs.get("policy_term_days")) or 365,
        "rate_history_version": rs.get("rate_history_version"),
        "event_overrides": [],
    }


async def segment_rate_context(lob: str, terr: str) -> dict[str, Any]:
    """Rate state + dated implemented rate history + default premium settings, for the
    on-level panel (an editable, scenario-local view of the rate history)."""
    rs = await _rate_state(lob, terr)
    ev = await execute_query(
        f"""SELECT effective_date, rate_change_pct, rate_level_index, event_id, status, date_source, note
            FROM {fqn('rate_change_history')} WHERE lob_code=:lob AND territory_code=:terr
            ORDER BY effective_date""", {"lob": lob, "terr": terr})
    events = [{"effective_date": str(r["effective_date"]) if r["effective_date"] else None,
               "rate_change_pct": _f(r["rate_change_pct"]), "rate_level_index": _f(r["rate_level_index"]),
               "event_id": r["event_id"], "status": r["status"], "date_source": r["date_source"]} for r in ev]
    return {
        "current_rate_level": _f(rs.get("current_rate_level")),
        "baseline_effective_date": str(rs.get("baseline_effective_date") or "2018-01-01"),
        "baseline_rate_index": _f(rs.get("baseline_rate_index")) or 1.0,
        "reference_rate_date": str(rs.get("reference_rate_date") or "2026-01-01"),
        "policy_term_days": _i(rs.get("policy_term_days")) or 365,
        "on_level_method": rs.get("on_level_method") or on_level.LEGACY,
        "events": events,
        "default_settings": await default_premium_settings(lob, terr),
        "methods": [on_level.LEGACY, on_level.PARALLELOGRAM],
    }


async def _rate_history(lob: str, terr: str, settings: dict[str, Any]) -> on_level.RateHistory:
    ev = await execute_query(
        f"""SELECT effective_date, rate_change_pct, event_id, status, date_source
            FROM {fqn('rate_change_history')}
            WHERE lob_code=:lob AND territory_code=:terr AND status='implemented' AND effective_date IS NOT NULL
            ORDER BY effective_date""", {"lob": lob, "terr": terr})
    events = {r["event_id"] or str(r["effective_date"]): on_level.RateEvent(
        effective_date=date.fromisoformat(str(r["effective_date"])), change=_f(r["rate_change_pct"]),
        status="implemented", event_id=r["event_id"], date_source=r["date_source"] or "observed") for r in ev}
    # scenario-local overrides: replace/add by event_id (bounded, demo use)
    for ov in (settings.get("event_overrides") or []):
        eid = ov.get("event_id") or ov["effective_date"]
        events[eid] = on_level.RateEvent(effective_date=date.fromisoformat(ov["effective_date"]),
                                         change=float(ov["change"]), status="implemented",
                                         event_id=eid, date_source="scenario_override")
    return on_level.RateHistory(
        baseline_index=float(settings.get("baseline_rate_index", 1.0)),
        baseline_date=date.fromisoformat(settings.get("baseline_effective_date", "2018-01-01")),
        events=sorted(events.values(), key=lambda e: e.effective_date),
        version=settings.get("rate_history_version"),
        complete_from=date.fromisoformat(settings.get("baseline_effective_date", "2018-01-01")))


async def compute_on_level(lob: str, terr: str, exp: list[ExperienceYear], settings: dict[str, Any]
                           ) -> tuple[dict[int, float] | None, dict[str, Any]]:
    """Return (factors_by_year | None, premium_summary). Legacy => None (engine uses
    its inline annual-index factor, identical); parallelogram => earning-aware factors."""
    method = settings.get("method", on_level.LEGACY)
    term = int(settings.get("policy_term_days", 365))
    ref = date.fromisoformat(str(settings.get("reference_rate_date", "2026-01-01")))
    if method == on_level.PARALLELOGRAM:
        hist = await _rate_history(lob, terr, settings)
        periods = [on_level.Period(e.accident_year, date(e.accident_year, 1, 1),
                                   date(e.accident_year + 1, 1, 1), e.earned_premium, e.reported_incurred)
                   for e in exp]
        ol = on_level.calculate_on_level(periods, hist, ref, term, on_level.PARALLELOGRAM)
        factors = {row["key"]: row["on_level_factor"] for row in ol["periods"]}
        by_year = {row["key"]: row for row in ol["periods"]}
        return factors, {"method": method, "reference_index": ol["reference_index"], "by_year": by_year}
    return None, {"method": on_level.LEGACY}


def _snapshot_hash(snapshot: dict[str, Any]) -> str:
    return hashlib.sha256(json.dumps(snapshot, sort_keys=True, default=str).encode()).hexdigest()


async def scenario_premium_settings(scenario_id: str) -> dict[str, Any] | None:
    r = await execute_query(
        f"SELECT premium_settings_json FROM {fqn('indication_scenarios')} WHERE scenario_id=:sid", {"sid": scenario_id})
    if r and r[0].get("premium_settings_json"):
        try:
            return json.loads(r[0]["premium_settings_json"])
        except Exception:  # noqa: BLE001
            return None
    return None


def _basis_label(base: dict, scen: dict) -> str:
    if scen.get("method") == on_level.PARALLELOGRAM and base.get("method") != on_level.PARALLELOGRAM:
        return "Earning-aware on-level (parallelogram)"
    if scen.get("method") != base.get("method"):
        return f"On-level method → {scen.get('method')}"
    return "Premium rate basis"


def _premium_summary(res, summary: dict) -> dict[str, Any]:
    return {
        "method": res.on_level_method,
        "total_earned_premium": res.total_earned_premium,
        "total_on_level_earned_premium": res.on_level_earned_premium,
        "overall_on_level_factor": res.overall_on_level_factor,
        "raw_reported_loss_ratio": res.raw_reported_loss_ratio,
        "on_level_reported_loss_ratio": res.on_level_reported_loss_ratio,
        "reference_index": summary.get("reference_index"),
        "currency": CURRENCY,
    }


def _merge_on_level_detail(res, summary: dict) -> None:
    by_year = summary.get("by_year") or {}
    for d in res.detail_years:
        oy = by_year.get(d["accident_year"])
        if oy:
            d["average_earned_index"] = round(oy["average_earned_index"], 6)
            d["reference_index"] = round(oy["reference_index"], 6)


# ------------------------------------------------------------- preview (ephemeral)
async def run_preview(lob: str, terr: str, period: int, assumptions: dict[str, float],
                      premium_settings: dict[str, Any] | None = None) -> dict[str, Any]:
    """Instant what-if. NOT recorded — clearly a preview until the scenario is
    calculated (which persists it)."""
    exp, crl = await _segment_experience(lob, terr)
    bsid = await baseline_scenario_id(lob, terr, period)
    _, baseline = await assumptions_for(bsid)
    base_settings = await scenario_premium_settings(bsid) or await default_premium_settings(lob, terr)
    settings = premium_settings or base_settings
    factors, summary = await compute_on_level(lob, terr, exp, settings)
    res = calc_segment(exp, crl, period, assumptions, on_level_factors=factors,
                       on_level_method=settings.get("method", on_level.LEGACY))
    _merge_on_level_detail(res, summary)
    base_factors, _bs = await compute_on_level(lob, terr, exp, base_settings)
    base_res = calc_segment(exp, crl, period, baseline, on_level_factors=base_factors,
                            on_level_method=base_settings.get("method", on_level.LEGACY)) if baseline else None
    steps = decompose(exp, crl, period, baseline, assumptions, baseline_factors=base_factors,
                      scenario_factors=factors, premium_basis_label=_basis_label(base_settings, settings)) if baseline else []
    return {
        "result": _result_dict(res),
        "baseline_indicated": base_res.indicated_rate_change if base_res else None,
        "decomposition": steps,
        "premium_summary": _premium_summary(res, summary),
        "premium_settings": settings,
        "recorded": False,
    }


# ------------------------------------------------------------------- audit helper
async def _audit(scenario_id: str, action: str, frm: str | None, to: str | None,
                 result_id: str | None = None, note: str | None = None) -> None:
    await execute_query(
        f"""INSERT INTO {fqn('indication_audit_log')}
            (event_id, log_ts, scenario_id, action, actor, from_status, to_status,
             calc_version, result_id, note, details)
            VALUES (:eid, current_timestamp(), :sid, :act, :actor, :frm, :to, :cv, :rid, :note, NULL)""",
        {"eid": str(uuid.uuid4()), "sid": scenario_id, "act": action, "actor": current_user(),
         "frm": frm, "to": to, "cv": CALC_VERSION, "rid": result_id, "note": note})


# ----------------------------------------------------------------- scenario reads
async def scenarios(lob: str | None = None, terr: str | None = None, period: int | None = None) -> list[dict]:
    where, params = [], {}
    if lob:
        where.append("s.lob_code=:lob"); params["lob"] = lob
    if terr:
        where.append("s.territory_code=:terr"); params["terr"] = terr
    if period:
        where.append("s.indication_period=:period"); params["period"] = period
    clause = ("WHERE " + " AND ".join(where)) if where else ""
    rows = await execute_query(
        f"""SELECT s.scenario_id, s.scenario_name, s.lob_code, s.territory_code, s.indication_period,
                   s.status, s.is_baseline, s.owner, s.reviewer, s.created_by, s.created_at, s.updated_at,
                   s.selected_rate_change, s.selection_comment, s.comments, s.cloned_from,
                   r.indicated_rate_change, r.projected_loss_ratio
            FROM {fqn('indication_scenarios')} s
            LEFT JOIN (SELECT scenario_id, indicated_rate_change, projected_loss_ratio,
                              row_number() OVER (PARTITION BY scenario_id ORDER BY calculation_timestamp DESC) rn
                       FROM {fqn('indication_results')}) r
              ON r.scenario_id = s.scenario_id AND r.rn = 1
            {clause} ORDER BY s.is_baseline DESC, s.updated_at DESC""", params)
    for r in rows:
        r["is_baseline"] = _b(r["is_baseline"])
        r["indicated_rate_change"] = _f(r["indicated_rate_change"])
        r["projected_loss_ratio"] = _f(r["projected_loss_ratio"])
        r["selected_rate_change"] = _f(r["selected_rate_change"])
        r["indication_period"] = _i(r["indication_period"])
    return rows


async def scenario_detail(scenario_id: str) -> dict[str, Any]:
    s = await execute_query(f"SELECT * FROM {fqn('indication_scenarios')} WHERE scenario_id=:sid", {"sid": scenario_id})
    if not s:
        return {}
    sc = s[0]
    cur, base = await assumptions_for(scenario_id)
    res = await execute_query(
        f"""SELECT * FROM {fqn('indication_results')} WHERE scenario_id=:sid
            ORDER BY calculation_timestamp DESC LIMIT 1""", {"sid": scenario_id})
    result = None
    if res:
        rr = res[0]
        result = {k: _f(rr[k]) for k in ("indicated_rate_change", "selected_rate_change", "projected_loss_ratio",
                  "permissible_loss_ratio", "experience_loss_ratio", "required_premium",
                  "on_level_earned_premium", "projected_ultimate_loss")}
        result["calc_version"] = rr["calc_version"]
        result["experience_version"] = rr["experience_version"]
        result["calculated_by"] = rr["calculated_by"]
        result["calculation_timestamp"] = str(rr["calculation_timestamp"])
        result["detail_years"] = json.loads(rr["detail_json"]) if rr.get("detail_json") else []
        result["decomposition"] = json.loads(rr["decomposition_json"]) if rr.get("decomposition_json") else []
        result["premium_summary"] = json.loads(rr["premium_summary_json"]) if rr.get("premium_summary_json") else None
        result["input_hash"] = rr.get("input_hash")
        result["rate_history_version"] = rr.get("rate_history_version")
    sc["is_baseline"] = _b(sc["is_baseline"])
    sc["indication_period"] = _i(sc["indication_period"])
    sc["selected_rate_change"] = _f(sc["selected_rate_change"])
    settings = None
    if sc.get("premium_settings_json"):
        try:
            settings = json.loads(sc["premium_settings_json"])
        except Exception:  # noqa: BLE001
            settings = None
    if settings is None:
        settings = await default_premium_settings(sc["lob_code"], sc["territory_code"])
    return {"scenario": sc, "assumptions": cur, "baseline": base, "result": result,
            "premium_settings": settings,
            "assumption_order": ASSUMPTION_ORDER, "assumption_meta": ASSUMPTION_META}


# ---------------------------------------------------------------- scenario writes
async def create_scenario(name: str, lob: str, terr: str, period: int, cloned_from: str | None) -> str:
    """New DRAFT scenario. Assumptions copied from the source (or the approved
    baseline). The baseline_value column always tracks the approved baseline."""
    src = cloned_from or await baseline_scenario_id(lob, terr, period)
    src_cur, base = await assumptions_for(src)
    # clone the source's premium settings (method/dates/term/history/overrides)
    src_settings = await scenario_premium_settings(src) or await default_premium_settings(lob, terr)
    sid = f"scn-{lob}-{terr}-{period}-{uuid.uuid4().hex[:8]}"
    await execute_query(
        f"""INSERT INTO {fqn('indication_scenarios')}
            (scenario_id, scenario_name, lob_code, territory_code, indication_period, status, is_baseline,
             owner, reviewer, created_by, created_at, updated_at, submitted_at, reviewed_at, approved_at,
             selected_rate_change, selection_comment, comments, cloned_from, experience_version,
             premium_settings_json, last_calculated_input_hash)
            SELECT :sid, :name, :lob, :terr, :period, 'DRAFT', false, :usr, NULL, :usr,
                   current_timestamp(), current_timestamp(), NULL, NULL, NULL,
                   NULL, NULL, NULL, :src, max(experience_version), :ps, NULL
            FROM {fqn('indication_experience')}""",
        {"sid": sid, "name": name, "lob": lob, "terr": terr, "period": period,
         "usr": current_user(), "src": (cloned_from or None), "ps": json.dumps(src_settings)})
    # copy assumptions — one fully-parameterised INSERT per row (no interpolation)
    for n in ASSUMPTION_ORDER:
        await execute_query(
            f"""INSERT INTO {fqn('indication_assumptions')}
                (scenario_id, assumption_name, assumption_value, baseline_value, unit, updated_by, updated_at)
                VALUES (:sid, :name, :val, :base, :unit, :usr, current_timestamp())""",
            {"sid": sid, "name": n, "val": float(src_cur.get(n, 0.0)),
             "base": float(base.get(n, 0.0)), "unit": ASSUMPTION_META[n]["unit"], "usr": current_user()})
    await _audit(sid, "CREATE", None, "DRAFT", note=(f"cloned from {cloned_from}" if cloned_from else "new draft"))
    return sid


async def save_assumptions(scenario_id: str, assumptions: dict[str, float]) -> None:
    for name in ASSUMPTION_ORDER:            # names come only from this whitelist
        if name in assumptions:
            await execute_query(
                f"""UPDATE {fqn('indication_assumptions')} SET assumption_value = :val,
                    updated_by=:usr, updated_at=current_timestamp()
                    WHERE scenario_id=:sid AND assumption_name=:name""",
                {"val": float(assumptions[name]), "usr": current_user(), "sid": scenario_id, "name": name})
    await execute_query(
        f"UPDATE {fqn('indication_scenarios')} SET updated_at=current_timestamp() WHERE scenario_id=:sid",
        {"sid": scenario_id})
    await _audit(scenario_id, "EDIT", None, None, note="assumptions edited")


class StaleInput(Exception):
    """Raised when a scenario is submitted with inputs changed since its last calculation."""


async def save_premium_settings(scenario_id: str, settings: dict[str, Any]) -> None:
    """Persist the premium settings (method/reference date/term/history/overrides) as one
    validated JSON object. Editing settings makes the last result stale until recalculated."""
    method = settings.get("method", on_level.LEGACY)
    if method not in (on_level.LEGACY, on_level.PARALLELOGRAM):
        raise ValueError(f"unknown on-level method: {method}")
    await execute_query(
        f"""UPDATE {fqn('indication_scenarios')} SET premium_settings_json=:ps, updated_at=current_timestamp()
            WHERE scenario_id=:sid""", {"ps": json.dumps(settings), "sid": scenario_id})
    await _audit(scenario_id, "EDIT", None, None, note=f"premium settings edited (method={method})")


async def scenario_input_hash(scenario_id: str) -> str:
    """Hash of the scenario's CURRENT inputs — must match the same shape record_calculation snapshots."""
    det = await scenario_detail(scenario_id)
    sc = det["scenario"]
    exp_ver = sc.get("experience_version")
    exp, _ = await _segment_experience(sc["lob_code"], sc["territory_code"], version=exp_ver)
    settings = det.get("premium_settings") or {}
    snapshot = {"assumptions": det["assumptions"], "experience_version": exp_ver,
                "rate_history_version": settings.get("rate_history_version"),
                "premium_settings": settings, "prospective_period": _i(sc["indication_period"]),
                "accident_years": [e.accident_year for e in exp]}
    return _snapshot_hash(snapshot)


async def record_calculation(scenario_id: str) -> dict[str, Any]:
    """Run the engine for a saved scenario and PERSIST the result (immutable) +
    an audit event. This is the governed, reproducible calculation path."""
    det = await scenario_detail(scenario_id)
    if not det:
        raise ValueError("scenario not found")
    sc = det["scenario"]
    lob, terr, period = sc["lob_code"], sc["territory_code"], _i(sc["indication_period"])
    exp_ver = sc.get("experience_version")
    exp, crl = await _segment_experience(lob, terr, version=exp_ver)
    settings = det.get("premium_settings") or await default_premium_settings(lob, terr)
    factors, summary = await compute_on_level(lob, terr, exp, settings)
    res = calc_segment(exp, crl, period, det["assumptions"], on_level_factors=factors,
                       on_level_method=settings.get("method", on_level.LEGACY))
    _merge_on_level_detail(res, summary)
    base_settings = await scenario_premium_settings(await baseline_scenario_id(lob, terr, period)) \
        or await default_premium_settings(lob, terr)
    base_factors, _bs = await compute_on_level(lob, terr, exp, base_settings)
    steps = decompose(exp, crl, period, det["baseline"], det["assumptions"], baseline_factors=base_factors,
                      scenario_factors=factors, premium_basis_label=_basis_label(base_settings, settings))
    rid = str(uuid.uuid4())
    snapshot = {"assumptions": det["assumptions"], "experience_version": exp_ver,
                "rate_history_version": settings.get("rate_history_version"),
                "premium_settings": settings, "prospective_period": period,
                "accident_years": [e.accident_year for e in exp]}
    input_hash = _snapshot_hash(snapshot)
    prem_summary = _premium_summary(res, summary)
    await execute_query(
        f"""INSERT INTO {fqn('indication_results')}
            (result_id, scenario_id, calc_version, experience_version, indicated_rate_change,
             selected_rate_change, projected_loss_ratio, permissible_loss_ratio, experience_loss_ratio,
             required_premium, on_level_earned_premium, projected_ultimate_loss,
             decomposition_json, detail_json, calculated_by, calculation_timestamp,
             input_snapshot_json, input_hash, rate_history_version, premium_summary_json)
            VALUES (:rid, :sid, :cv, :ev, :ind, NULL,
                    :plr, :perm, :elr, :reqp, :olep, :ult,
                    :decomp, :detail, :usr, current_timestamp(),
                    :snap, :hash, :rhv, :psum)""",
        {"rid": rid, "sid": scenario_id, "cv": CALC_VERSION, "ev": exp_ver,
         "ind": res.indicated_rate_change, "plr": res.projected_loss_ratio,
         "perm": res.permissible_loss_ratio, "elr": res.experience_loss_ratio,
         "reqp": res.required_premium, "olep": res.on_level_earned_premium, "ult": res.projected_ultimate_loss,
         "decomp": json.dumps(steps), "detail": json.dumps(res.detail_years), "usr": current_user(),
         "snap": json.dumps(snapshot, default=str), "hash": input_hash,
         "rhv": settings.get("rate_history_version"), "psum": json.dumps(prem_summary)})
    # mark the scenario's last-calculated input so a later edit is detectably stale
    await execute_query(
        f"UPDATE {fqn('indication_scenarios')} SET updated_at=current_timestamp(), last_calculated_input_hash=:h WHERE scenario_id=:sid",
        {"sid": scenario_id, "h": input_hash})
    await _audit(scenario_id, "CALCULATE", None, None, result_id=rid, note="indication calculated + recorded")
    return {"result": _result_dict(res), "decomposition": steps, "recorded": True, "result_id": rid}


async def select_rate(scenario_id: str, selected: float, comment: str) -> None:
    await execute_query(
        f"""UPDATE {fqn('indication_scenarios')} SET selected_rate_change=:sel,
            selection_comment=:c, updated_at=current_timestamp() WHERE scenario_id=:sid""",
        {"sel": float(selected), "c": comment, "sid": scenario_id})
    await _audit(scenario_id, "SELECT_RATE", None, None, note=f"selected {selected:+.3f}: {comment}")


# Role seniority for server-side approval enforcement. Higher rank can approve
# anything a lower rank can. In production these ranks come from the IdP / UC
# group membership; here the reviewer asserts a role and we gate on its rank.
ROLE_RANK = {"Pricing Manager": 1, "Chief Pricing Actuary": 2, "Pricing Committee": 3}


async def required_role(abs_change: float) -> str:
    rows = await execute_query(
        f"""SELECT approver_role FROM {fqn('approval_role')}
            WHERE :c >= min_abs_change AND :c < max_abs_change ORDER BY min_abs_change DESC LIMIT 1""",
        {"c": abs_change})
    return rows[0]["approver_role"] if rows else "Pricing Committee"


class ApprovalDenied(Exception):
    """Raised when the asserted approver role is too junior for the change size."""


async def set_status(scenario_id: str, action: str, reviewer: str | None = None,
                     note: str | None = None, approver_role: str | None = None) -> dict[str, Any]:
    transitions = {"submit": ("SUBMITTED", "submitted_at"), "review": ("REVIEWED", "reviewed_at"),
                   "approve": ("APPROVED", "approved_at"), "reject": ("REJECTED", None)}
    to, ts_col = transitions[action]
    cur = await execute_query(
        f"SELECT status, last_calculated_input_hash FROM {fqn('indication_scenarios')} WHERE scenario_id=:sid",
        {"sid": scenario_id})
    frm = cur[0]["status"] if cur else None

    # --- stale-input guard: a scenario edited since its last calculation cannot be submitted ---
    if action == "submit":
        last = cur[0]["last_calculated_input_hash"] if cur else None
        if not last:
            raise StaleInput("calculate the indication before submitting")
        if await scenario_input_hash(scenario_id) != last:
            raise StaleInput("inputs changed since the last calculation — recalculate before submitting")

    # --- server-side approval enforcement: role must be senior enough for the size ---
    if action == "approve":
        res = await execute_query(
            f"""SELECT indicated_rate_change FROM {fqn('indication_results')}
                WHERE scenario_id=:sid ORDER BY calculation_timestamp DESC LIMIT 1""", {"sid": scenario_id})
        ind = abs(_f(res[0]["indicated_rate_change"])) if res else 0.0
        need = await required_role(ind)
        have_rank = ROLE_RANK.get(approver_role or "", 0)
        if have_rank < ROLE_RANK.get(need, 99):
            await _audit(scenario_id, "APPROVE_DENIED", frm, frm,
                         note=f"blocked: {approver_role or 'no role'} cannot approve {ind:+.1%} (needs {need})")
            raise ApprovalDenied(
                f"A change of {ind:+.1%} requires sign-off by {need}; "
                f"'{approver_role or 'no role asserted'}' is not senior enough.")

    sets = [f"status='{to}'", "updated_at=current_timestamp()"]   # status from fixed whitelist above
    if ts_col:
        sets.append(f"{ts_col}=current_timestamp()")
    params: dict[str, Any] = {"sid": scenario_id}
    if reviewer:
        sets.append("reviewer=:rev"); params["rev"] = reviewer
    await execute_query(
        f"UPDATE {fqn('indication_scenarios')} SET {', '.join(sets)} WHERE scenario_id=:sid", params)
    note_full = (note or "") + (f" [{approver_role}]" if approver_role else "")
    await _audit(scenario_id, action.upper(), frm, to, note=note_full.strip() or None)
    return {"status": to}


async def trigger_reset() -> dict[str, Any]:
    """Return the workbench to a pristine, deterministic state: drop every
    app-created (non-baseline) scenario and its assumptions + results, leaving
    the seeded approved baselines. The append-only audit log is never deleted —
    the reset itself is recorded there (immutability is the point)."""
    non_base = f"(SELECT scenario_id FROM {fqn('indication_scenarios')} WHERE NOT is_baseline)"
    removed = await execute_query(f"SELECT count(*) n FROM {fqn('indication_scenarios')} WHERE NOT is_baseline")
    n = _i(removed[0]["n"]) if removed else 0
    await execute_query(f"DELETE FROM {fqn('indication_results')} WHERE scenario_id IN {non_base}")
    await execute_query(f"DELETE FROM {fqn('indication_assumptions')} WHERE scenario_id IN {non_base}")
    await execute_query(f"DELETE FROM {fqn('indication_scenarios')} WHERE NOT is_baseline")
    await execute_query(
        f"""INSERT INTO {fqn('indication_audit_log')}
            (event_id, log_ts, scenario_id, action, actor, from_status, to_status,
             calc_version, result_id, note, details)
            VALUES (:eid, current_timestamp(), '(reset)', 'RESET', :actor, NULL, NULL, :cv, NULL, :note, NULL)""",
        {"eid": str(uuid.uuid4()), "actor": current_user(), "cv": CALC_VERSION,
         "note": f"reset to pristine baselines; removed {n} scenario(s)"})
    return {"reset": True, "removed_scenarios": n}


# ------------------------------------------------------------------- portfolio
async def portfolio(period: int) -> dict[str, Any]:
    """One row per segment: approved baseline indication + latest premium, plus
    the selected rate and status of the most recent non-baseline scenario."""
    rows = await execute_query(
        f"""WITH latest AS (
              SELECT scenario_id, indicated_rate_change, projected_loss_ratio, on_level_earned_premium,
                     row_number() OVER (PARTITION BY scenario_id ORDER BY calculation_timestamp DESC) rn
              FROM {fqn('indication_results')})
            SELECT s.lob_code, l.lob_label, s.territory_code, t.territory_label,
                   r.indicated_rate_change AS baseline_indicated, r.projected_loss_ratio,
                   r.on_level_earned_premium, s.selected_rate_change, s.scenario_id
            FROM {fqn('indication_scenarios')} s
            JOIN {fqn('line_of_business')} l ON l.lob_code=s.lob_code
            JOIN {fqn('territory')} t ON t.territory_code=s.territory_code
            LEFT JOIN latest r ON r.scenario_id=s.scenario_id AND r.rn=1
            WHERE s.is_baseline AND s.indication_period=:period
            ORDER BY l.display_order, t.display_order""", {"period": period})
    segs, tot_prem, tot_req = [], 0.0, 0.0
    for r in rows:
        ind = _f(r["baseline_indicated"]) or 0.0
        prem = _f(r["on_level_earned_premium"]) or 0.0
        sel = _f(r["selected_rate_change"])
        tot_prem += prem
        tot_req += prem * (1 + ind)
        segs.append({"lob_code": r["lob_code"], "lob_label": r["lob_label"],
                     "territory_code": r["territory_code"], "territory_label": r["territory_label"],
                     "baseline_indicated": ind, "projected_loss_ratio": _f(r["projected_loss_ratio"]),
                     "on_level_earned_premium": prem, "selected_rate_change": sel,
                     "baseline_scenario_id": r["scenario_id"]})
    portfolio_indicated = (tot_req / tot_prem - 1) if tot_prem else 0.0
    return {"period": period, "segments": segs, "currency": CURRENCY,
            "total_premium": tot_prem, "portfolio_indicated": portfolio_indicated}


async def compare(ids: list[str]) -> dict[str, Any]:
    out = []
    for sid in ids:
        d = await scenario_detail(sid)
        if d:
            out.append(d)
    return {"scenarios": out, "assumption_order": ASSUMPTION_ORDER, "assumption_meta": ASSUMPTION_META}


async def audit_trail(scenario_id: str) -> list[dict]:
    return await execute_query(
        f"""SELECT log_ts, action, actor, from_status, to_status, calc_version, result_id, note
            FROM {fqn('indication_audit_log')} WHERE scenario_id=:sid ORDER BY log_ts""",
        {"sid": scenario_id})
