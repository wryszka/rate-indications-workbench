"""Rate Indications Workbench — FastAPI backend."""
from __future__ import annotations
import logging
from pathlib import Path

import csv
import io

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, Response
from fastapi.staticfiles import StaticFiles

import config
import store
import agent_client
import agents
import genie
import on_level


def _f(x):
    return float(x) if x is not None else None

log = logging.getLogger("rate_indications")
app = FastAPI(title="Rate Indications Workbench")


@app.middleware("http")
async def identity(request: Request, call_next):
    user = (request.headers.get("X-Forwarded-Email")
            or request.headers.get("X-Forwarded-Preferred-Username")
            or request.headers.get("X-Forwarded-User")
            or (config.DEV_FALLBACK_USER if not config.IN_APP_RUNTIME else "unknown"))
    config.set_current_user(user)
    return await call_next(request)


def ok(data): return JSONResponse(data)
def err(msg, code=400): return JSONResponse({"error": msg}, status_code=code)


def fail(where: str, e: Exception, code=400):
    """Log the real error server-side; return a safe generic message to the client."""
    log.exception("%s failed: %s", where, e)
    return JSONResponse({"error": f"{where} failed. See server logs."}, status_code=code)


@app.get("/api/meta")
async def get_meta():
    m = await store.meta()
    m["entity_name"] = config.ENTITY_NAME
    m["book_flavour"] = config.BOOK_FLAVOUR
    m["ai_mode"] = config.ai_mode()
    m["current_user"] = config.current_user()
    m["genie_enabled"] = bool(config.GENIE_SPACE_ID)
    return ok(m)


@app.get("/api/portfolio")
async def get_portfolio(period: int = 2027):
    return ok(await store.portfolio(period))


@app.get("/api/segment")
async def get_segment(lob: str, territory: str, period: int = 2027):
    bsid = await store.baseline_scenario_id(lob, territory, period)
    detail = await store.scenario_detail(bsid)
    scns = await store.scenarios(lob, territory, period)
    rate_context = await store.segment_rate_context(lob, territory)
    return ok({"baseline": detail, "scenarios": scns, "rate_context": rate_context})


@app.post("/api/preview")
async def post_preview(body: dict):
    try:
        return ok(await store.run_preview(body["lob"], body["territory"], int(body["period"]),
                                          body["assumptions"], body.get("premium_settings")))
    except on_level.OnLevelError as e:
        return err(str(e))                # actionable, safe validation message
    except Exception as e:  # noqa: BLE001
        return fail("preview", e)


@app.get("/api/scenarios")
async def list_scenarios(lob: str | None = None, territory: str | None = None, period: int | None = None):
    return ok({"scenarios": await store.scenarios(lob, territory, period)})


@app.post("/api/scenarios")
async def create_scenario(body: dict):
    try:
        sid = await store.create_scenario(body["name"], body["lob"], body["territory"],
                                          int(body["period"]), body.get("cloned_from"))
        return ok({"scenario_id": sid})
    except Exception as e:  # noqa: BLE001
        return fail("create scenario", e)


@app.get("/api/scenarios/{sid}")
async def get_scenario(sid: str):
    d = await store.scenario_detail(sid)
    return ok(d) if d else err("scenario not found", 404)


@app.put("/api/scenarios/{sid}/assumptions")
async def put_assumptions(sid: str, body: dict):
    await store.save_assumptions(sid, body["assumptions"])
    return ok({"saved": True})


@app.put("/api/scenarios/{sid}/premium-settings")
async def put_premium_settings(sid: str, body: dict):
    try:
        await store.save_premium_settings(sid, body["premium_settings"])
        return ok({"saved": True})
    except Exception as e:  # noqa: BLE001
        return fail("save premium settings", e)


@app.post("/api/scenarios/{sid}/calculate")
async def calculate(sid: str):
    try:
        return ok(await store.record_calculation(sid))
    except Exception as e:  # noqa: BLE001
        return fail("calculate", e)


@app.post("/api/scenarios/{sid}/select-rate")
async def select_rate(sid: str, body: dict):
    try:
        await store.select_rate(sid, float(body["selected_rate_change"]), body.get("comment", ""))
        return ok({"saved": True})
    except Exception as e:  # noqa: BLE001
        return fail("select rate", e)


@app.post("/api/scenarios/{sid}/submit")
async def submit(sid: str):
    try:
        await store.set_status(sid, "submit", note="submitted for review")
        return ok({"status": "SUBMITTED"})
    except store.StaleInput as e:
        return JSONResponse({"error": str(e), "stale": True}, status_code=409)
    except Exception as e:  # noqa: BLE001
        return fail("submit", e)


@app.post("/api/scenarios/{sid}/review")
async def review(sid: str, body: dict):
    decision = body.get("decision", "approve")
    action = "approve" if decision == "approve" else "reject"
    try:
        r = await store.set_status(sid, action, reviewer=config.current_user(),
                                   note=body.get("note", ""), approver_role=body.get("approver_role"))
        return ok(r)
    except store.ApprovalDenied as e:
        # Server-side governance gate: role too junior for the change size.
        return JSONResponse({"error": str(e), "denied": True}, status_code=403)
    except Exception as e:  # noqa: BLE001
        return fail("review", e)


@app.get("/api/compare")
async def compare(ids: str):
    return ok(await store.compare([i for i in ids.split(",") if i]))


@app.get("/api/audit")
async def audit(scenario_id: str):
    return ok({"events": await store.audit_trail(scenario_id)})


def _csv_safe(v):
    s = "" if v is None else str(v)
    return ("'" + s) if s[:1] in ("=", "+", "-", "@") else s   # neutralise spreadsheet formulas


@app.get("/api/scenarios/{sid}/export")
async def export_result(sid: str):
    """CSV of the scenario's latest recorded result — per-year on-level detail + headline,
    with the same numerators/currency/settings shown in the UI."""
    d = await store.scenario_detail(sid)
    if not d or not d.get("result"):
        return err("no recorded result to export", 404)
    r, sc = d["result"], d["scenario"]
    ps = r.get("premium_summary") or {}
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["scenario", sc.get("scenario_name"), "segment", f"{sc.get('lob_code')}/{sc.get('territory_code')}"])
    w.writerow(["method", ps.get("method"), "currency", ps.get("currency"), "calc_version", r.get("calc_version"),
                "experience_version", r.get("experience_version")])
    w.writerow(["indicated_rate_change", r.get("indicated_rate_change"), "on_level_reported_LR",
                ps.get("on_level_reported_loss_ratio"), "raw_reported_LR", ps.get("raw_reported_loss_ratio")])
    w.writerow([])
    cols = ["accident_year", "earned_premium", "on_level_factor", "on_level_earned_premium", "reported_incurred",
            "raw_reported_lr", "on_level_reported_lr", "average_earned_index", "reference_index",
            "effective_ldf", "ultimate_loss", "trend_factor", "trended_ultimate"]
    w.writerow(cols)
    for dy in (r.get("detail_years") or []):
        w.writerow([_csv_safe(dy.get(c)) for c in cols])
    return Response(content=buf.getvalue(), media_type="text/csv",
                    headers={"Content-Disposition": f'attachment; filename="{sid}.csv"'})


@app.get("/api/ai-mode")
async def get_ai_mode():
    return ok({"mode": config.ai_mode()})


@app.post("/api/ai-mode")
async def set_ai_mode(body: dict):
    return ok({"mode": config.set_ai_mode(body.get("mode", ""))})


@app.post("/api/admin/reset")
async def reset(body: dict | None = None):
    """Rebuild the book + reseed the audited baselines to a pristine, deterministic
    state (clears app-created scenarios). Triggers the governed Full Build job."""
    try:
        return ok(await store.trigger_reset())
    except Exception as e:  # noqa: BLE001
        return fail("reset", e)


@app.get("/api/genie/status")
async def genie_status():
    return ok({"enabled": bool(config.GENIE_SPACE_ID), "space_id": config.GENIE_SPACE_ID})


@app.post("/api/genie/ask")
async def genie_ask(body: dict):
    """Ask the book in natural language via the embedded Genie space (Conversation API)."""
    try:
        return ok(await genie.ask(body.get("question", ""), body.get("conversation_id")))
    except Exception as e:  # noqa: BLE001
        return fail("genie", e)


@app.post("/api/agent/review")
async def agent_review(body: dict):
    """Advise-only pre-submission peer review of a saved scenario."""
    try:
        d = await store.scenario_detail(body["scenario_id"])
        sc, res = d.get("scenario", {}), d.get("result") or {}
        payload = {"segment": f"{sc.get('lob_code')} / {sc.get('territory_code')}",
                   "period": sc.get("indication_period"), "assumptions": d.get("assumptions"),
                   "baseline": d.get("baseline"), "result": res,
                   "selected_rate_change": _f(sc.get("selected_rate_change")),
                   "on_level_method": (res.get("premium_summary") or {}).get("method")}
        return ok(await agents.run("review", payload, body.get("mode", config.ai_mode())))
    except Exception as e:  # noqa: BLE001
        return fail("agent review", e)


@app.post("/api/agent/recommend")
async def agent_recommend(body: dict):
    """Advise-only: propose a starting assumption set (a draft the actuary edits)."""
    try:
        bsid = await store.baseline_scenario_id(body["lob"], body["territory"], int(body["period"]))
        d = await store.scenario_detail(bsid)
        det_years = (d.get("result") or {}).get("detail_years") or []
        payload = {"segment": f"{body['lob']} / {body['territory']}",
                   "experience": [{"accident_year": y.get("accident_year"), "earned_premium": y.get("earned_premium"),
                                   "reported_incurred": y.get("reported_incurred"), "raw_reported_lr": y.get("raw_reported_lr")}
                                  for y in det_years],
                   "baseline_assumptions": d.get("assumptions"),
                   "assumption_names": d.get("assumption_order")}
        return ok(await agents.run("recommend", payload, body.get("mode", config.ai_mode())))
    except Exception as e:  # noqa: BLE001
        return fail("agent recommend", e)


@app.post("/api/agent/interrogate")
async def agent_interrogate(body: dict):
    """Advise-only Q&A over the rate history + earning-aware on-level detail."""
    try:
        lob, terr, period = body["lob"], body["territory"], int(body["period"])
        rc = await store.segment_rate_context(lob, terr)
        bsid = await store.baseline_scenario_id(lob, terr, period)
        _, base_assum = await store.assumptions_for(bsid)
        settings = await store.default_premium_settings(lob, terr)
        settings["method"] = "parallelogram_fixed_term"
        prev = await store.run_preview(lob, terr, period, base_assum, settings)
        payload = {"segment": f"{lob} / {terr}", "method": "parallelogram_fixed_term",
                   "reference_rate_date": rc.get("reference_rate_date"),
                   "rate_events": rc.get("events"),
                   "detail_years": prev["result"].get("detail_years"),
                   "premium_summary": prev.get("premium_summary")}
        return ok(await agents.run("interrogate", payload, body.get("mode", config.ai_mode()),
                                   question=body.get("question", "")))
    except Exception as e:  # noqa: BLE001
        return fail("agent interrogate", e)


@app.post("/api/agent/committee-paper")
async def agent_committee_paper(body: dict):
    """Advise-only: draft a committee paper from a recorded result."""
    try:
        d = await store.scenario_detail(body["scenario_id"])
        sc, res = d.get("scenario", {}), d.get("result") or {}
        payload = {"segment": f"{sc.get('lob_code')} / {sc.get('territory_code')}",
                   "period": sc.get("indication_period"), "result": res,
                   "decomposition": res.get("decomposition"), "assumptions": d.get("assumptions"),
                   "selected_rate_change": _f(sc.get("selected_rate_change")),
                   "selection_comment": sc.get("selection_comment"),
                   "calc_version": res.get("calc_version"), "experience_version": res.get("experience_version"),
                   "on_level_method": (res.get("premium_summary") or {}).get("method")}
        return ok(await agents.run("committee_paper", payload, body.get("mode", config.ai_mode())))
    except Exception as e:  # noqa: BLE001
        return fail("committee paper", e)


@app.get("/api/governance")
async def governance(period: int | None = None):
    return ok(await store.governance_overview(period))


@app.post("/api/agent/governance")
async def agent_governance(body: dict):
    """Advise-only governance/model-risk Q&A grounded in the live governed evidence."""
    try:
        ev = await store.governance_overview(body.get("period"))
        payload = {"question": body.get("question", ""), "evidence": ev}
        return ok(await agents.run("governance", payload, body.get("mode", config.ai_mode()),
                                   question=body.get("question", "")))
    except Exception as e:  # noqa: BLE001
        return fail("governance agent", e)


@app.post("/api/explain")
async def explain(body: dict):
    mode = body.get("mode", config.ai_mode())
    if body.get("scenario_id"):
        d = await store.scenario_detail(body["scenario_id"])
        sc = d.get("scenario", {})
        res = d.get("result") or {}
        # baseline indication for the "up from X" clause = the approved baseline
        # scenario's latest recorded indicated change for this segment.
        base_ind = None
        if sc.get("lob_code"):
            bsid = await store.baseline_scenario_id(sc["lob_code"], sc["territory_code"], int(sc["indication_period"]))
            bdet = await store.scenario_detail(bsid)
            base_ind = (bdet.get("result") or {}).get("indicated_rate_change")
        payload = {"segment": f"{sc.get('lob_code')} / {sc.get('territory_code')}",
                   "period": sc.get("indication_period"), "result": res,
                   "baseline_indicated": base_ind,
                   "decomposition": res.get("decomposition", [])}
    else:
        payload = body.get("payload", body)
    return ok(await agent_client.explain(payload, mode))


@app.get("/api/learn")
async def learn():
    return ok({"cards": LEARN_CARDS})


# Two use-case tracks. UC "On-level earned premium" is the fair-comparison restatement;
# UC "Rate indication" is the full price-change workflow that consumes it. One engine, two lenses.
_UC_ONLEVEL = "On-level earned premium"
_UC_INDICATION = "Rate indication"

LEARN_CARDS = [
    # ---- Use case: On-level earned premium ----
    {"use_case": _UC_ONLEVEL, "n": 1, "group": "What & why", "activity": "Historic premium was charged at historic prices, so I restate it to one reference price level before I judge rate adequacy.",
     "how": "On-level factor = reference rate index / average earned index; applied once to historic earned premium. An analytical adjustment — it never bills customers or changes live prices.",
     "links": [{"label": "segment_rate_state", "kind": "table"}]},
    {"use_case": _UC_ONLEVEL, "n": 2, "group": "What & why", "activity": "I see the raw vs on-level reported loss ratio side by side — same claims, different premium denominator.",
     "how": "Both ratios use identical losses/scope/valuation date; only the premium basis changes. Distinct from the trended projected loss ratio in the indication.",
     "links": [{"label": "indication_experience", "kind": "table"}]},
    {"use_case": _UC_ONLEVEL, "n": 3, "group": "The method", "activity": "I choose how to on-level: the crude annual-index (the spreadsheet way) or the earning-aware method from actual rate-change dates.",
     "how": "The parallelogram method derives the average EARNED index analytically — a mid-year change only earns through the book gradually. Legacy stays available and labelled a simplification.",
     "links": [{"label": "rate_change_history", "kind": "table"}]},
    {"use_case": _UC_ONLEVEL, "n": 4, "group": "The method", "activity": "I can test a historic rate change's size or effective date as a scenario-local what-if.",
     "how": "Edits are scenario-local overrides — they never mutate the master rate history or the approved baseline. Dates are synthetic (assumed Jan 1); needs coverage back to the earliest earning cohort.",
     "links": [{"label": "rate_change_history", "kind": "table"}]},
    {"use_case": _UC_ONLEVEL, "n": 5, "group": "Governed", "activity": "Every saved on-level result reproduces later, exactly.",
     "how": "The result stores the full input snapshot + hash + rate-history version + premium summary; a scenario edited since its last calc can't be submitted until recalculated.",
     "links": [{"label": "indication_results", "kind": "table"}]},
    # ---- Use case: Rate indication ----
    {"use_case": _UC_INDICATION, "n": 1, "group": "Trust the experience", "activity": "I start from the book's earned premium and reported losses by segment and accident year.",
     "how": "A governed Unity Catalog table (indication_experience), ACORD-shaped and mirroring the group loss triangle.",
     "links": [{"label": "indication_experience", "kind": "table"}]},
    {"use_case": _UC_INDICATION, "n": 2, "group": "Work the indication", "activity": "I develop reported losses to ultimate and trend them to the prospective period.",
     "how": "Deterministic loss-ratio method (indication_engine, calc_version pinned); the loss triangle backs the development factor.",
     "links": [{"label": "indication_loss_triangle", "kind": "table"}]},
    {"use_case": _UC_INDICATION, "n": 3, "group": "Work the indication", "activity": "I set assumptions — trend, development, loads, expenses, profit — and see the indication move instantly, and ask why.",
     "how": "Every saved calculation is recorded to indication_results; a marginal decomposition attributes the move to each assumption (and to the premium basis) and sums exactly.",
     "links": [{"label": "indication_results", "kind": "table"}]},
    {"use_case": _UC_INDICATION, "n": 4, "group": "Compound the book", "activity": "I compare scenarios and pick a selected rate that may differ from the indication.",
     "how": "Scenarios persist in indication_scenarios; selected-vs-indicated and commentary are captured per scenario.",
     "links": [{"label": "indication_scenarios", "kind": "table"}]},
    {"use_case": _UC_INDICATION, "n": 5, "group": "Compound the book", "activity": "I submit for review; a colleague approves by role depending on the size of the change — and anyone can reproduce it.",
     "how": "Draft -> Submitted -> Reviewed -> Approved, routed + enforced by approval_role; every step is an append-only audit event tying the number to method + input version + author.",
     "links": [{"label": "indication_audit_log", "kind": "table"}]},
]


# ---- static SPA (built frontend) ----
_DIST = Path(__file__).resolve().parent / "frontend" / "dist"
if _DIST.exists():
    app.mount("/", StaticFiles(directory=str(_DIST), html=True), name="spa")
