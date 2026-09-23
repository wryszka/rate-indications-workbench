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
import json
import uuid
from typing import Any

from config import fqn, current_user, BOOK_FLAVOUR
from sql import execute_query
from indication_engine import (
    ExperienceYear, calc_segment, decompose, CALC_VERSION,
    ASSUMPTION_ORDER, ASSUMPTION_META,
)

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
async def _segment_experience(lob: str, terr: str) -> tuple[list[ExperienceYear], float]:
    rows = await execute_query(
        f"""SELECT accident_year, earned_premium, reported_incurred, claim_count, exposure,
                   rate_level_index, ldf_to_ultimate
            FROM {fqn('indication_experience')}
            WHERE lob_code = :lob AND territory_code = :terr ORDER BY accident_year""",
        {"lob": lob, "terr": terr})
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
    }


# ------------------------------------------------------------- preview (ephemeral)
async def run_preview(lob: str, terr: str, period: int, assumptions: dict[str, float]) -> dict[str, Any]:
    """Instant what-if. NOT recorded — clearly a preview until the scenario is
    calculated (which persists it)."""
    exp, crl = await _segment_experience(lob, terr)
    _, baseline = await assumptions_for(await baseline_scenario_id(lob, terr, period))
    res = calc_segment(exp, crl, period, assumptions)
    base_res = calc_segment(exp, crl, period, baseline) if baseline else None
    steps = decompose(exp, crl, period, baseline, assumptions) if baseline else []
    return {
        "result": _result_dict(res),
        "baseline_indicated": base_res.indicated_rate_change if base_res else None,
        "decomposition": steps,
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
    sc["is_baseline"] = _b(sc["is_baseline"])
    sc["indication_period"] = _i(sc["indication_period"])
    sc["selected_rate_change"] = _f(sc["selected_rate_change"])
    return {"scenario": sc, "assumptions": cur, "baseline": base, "result": result,
            "assumption_order": ASSUMPTION_ORDER, "assumption_meta": ASSUMPTION_META}


# ---------------------------------------------------------------- scenario writes
async def create_scenario(name: str, lob: str, terr: str, period: int, cloned_from: str | None) -> str:
    """New DRAFT scenario. Assumptions copied from the source (or the approved
    baseline). The baseline_value column always tracks the approved baseline."""
    src = cloned_from or await baseline_scenario_id(lob, terr, period)
    src_cur, base = await assumptions_for(src)
    sid = f"scn-{lob}-{terr}-{period}-{uuid.uuid4().hex[:8]}"
    await execute_query(
        f"""INSERT INTO {fqn('indication_scenarios')}
            (scenario_id, scenario_name, lob_code, territory_code, indication_period, status, is_baseline,
             owner, reviewer, created_by, created_at, updated_at, submitted_at, reviewed_at, approved_at,
             selected_rate_change, selection_comment, comments, cloned_from, experience_version)
            SELECT :sid, :name, :lob, :terr, :period, 'DRAFT', false, :usr, NULL, :usr,
                   current_timestamp(), current_timestamp(), NULL, NULL, NULL,
                   NULL, NULL, NULL, :src, max(experience_version)
            FROM {fqn('indication_experience')}""",
        {"sid": sid, "name": name, "lob": lob, "terr": terr, "period": period,
         "usr": current_user(), "src": (cloned_from or None)})
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


async def record_calculation(scenario_id: str) -> dict[str, Any]:
    """Run the engine for a saved scenario and PERSIST the result (immutable) +
    an audit event. This is the governed, reproducible calculation path."""
    det = await scenario_detail(scenario_id)
    if not det:
        raise ValueError("scenario not found")
    sc = det["scenario"]
    lob, terr, period = sc["lob_code"], sc["territory_code"], _i(sc["indication_period"])
    exp, crl = await _segment_experience(lob, terr)
    res = calc_segment(exp, crl, period, det["assumptions"])
    steps = decompose(exp, crl, period, det["baseline"], det["assumptions"])
    rid = str(uuid.uuid4())
    ev = await execute_query(f"SELECT max(experience_version) v FROM {fqn('indication_experience')}")
    exp_ver = ev[0]["v"] if ev else None
    await execute_query(
        f"""INSERT INTO {fqn('indication_results')}
            (result_id, scenario_id, calc_version, experience_version, indicated_rate_change,
             selected_rate_change, projected_loss_ratio, permissible_loss_ratio, experience_loss_ratio,
             required_premium, on_level_earned_premium, projected_ultimate_loss,
             decomposition_json, detail_json, calculated_by, calculation_timestamp)
            VALUES (:rid, :sid, :cv, :ev, :ind, :ind,
                    :plr, :perm, :elr, :reqp, :olep, :ult,
                    :decomp, :detail, :usr, current_timestamp())""",
        {"rid": rid, "sid": scenario_id, "cv": CALC_VERSION, "ev": exp_ver,
         "ind": res.indicated_rate_change, "plr": res.projected_loss_ratio,
         "perm": res.permissible_loss_ratio, "elr": res.experience_loss_ratio,
         "reqp": res.required_premium, "olep": res.on_level_earned_premium, "ult": res.projected_ultimate_loss,
         "decomp": json.dumps(steps), "detail": json.dumps(res.detail_years), "usr": current_user()})
    await execute_query(
        f"UPDATE {fqn('indication_scenarios')} SET updated_at=current_timestamp() WHERE scenario_id=:sid",
        {"sid": scenario_id})
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
        f"SELECT status FROM {fqn('indication_scenarios')} WHERE scenario_id=:sid", {"sid": scenario_id})
    frm = cur[0]["status"] if cur else None

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
