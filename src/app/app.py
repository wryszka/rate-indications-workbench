"""Rate Indications Workbench — FastAPI backend."""
from __future__ import annotations
import logging
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

import config
import store
import agent_client
import genie

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
    return ok({"baseline": detail, "scenarios": scns})


@app.post("/api/preview")
async def post_preview(body: dict):
    try:
        return ok(await store.run_preview(body["lob"], body["territory"], int(body["period"]), body["assumptions"]))
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
    await store.set_status(sid, "submit", note="submitted for review")
    return ok({"status": "SUBMITTED"})


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


LEARN_CARDS = [
    {"n": 1, "group": "Trust the experience", "activity": "I start from the book's earned premium and reported losses by segment and accident year.",
     "how": "A governed Unity Catalog table (indication_experience), ACORD-shaped and mirroring the group loss triangle.",
     "links": [{"label": "indication_experience", "kind": "table"}]},
    {"n": 2, "group": "Trust the experience", "activity": "I restate old premium at today's rate level so premium and losses are comparable.",
     "how": "On-levelling uses the taken rate-change history (rate_change_history) as a cumulative index.",
     "links": [{"label": "rate_change_history", "kind": "table"}]},
    {"n": 3, "group": "Work the indication", "activity": "I develop reported losses to ultimate and trend them to the prospective period.",
     "how": "Deterministic loss-ratio method (indication_engine, calc_version pinned); the loss triangle backs the development factor.",
     "links": [{"label": "indication_loss_triangle", "kind": "table"}]},
    {"n": 4, "group": "Work the indication", "activity": "I set assumptions — trend, development, loads, expenses, profit — and see the indication move instantly.",
     "how": "Every saved calculation is recorded to indication_results with its assumption vector, calc_version and experience_version.",
     "links": [{"label": "indication_results", "kind": "table"}]},
    {"n": 5, "group": "Work the indication", "activity": "I ask why it moved.",
     "how": "A marginal decomposition attributes the change to each assumption; contributions sum exactly to the total move.",
     "links": []},
    {"n": 6, "group": "Compound the book", "activity": "I compare scenarios and pick a selected rate that may differ from the indication.",
     "how": "Scenarios persist in indication_scenarios; selected-vs-indicated and commentary are captured per scenario.",
     "links": [{"label": "indication_scenarios", "kind": "table"}]},
    {"n": 7, "group": "Compound the book", "activity": "I submit for review; a colleague approves by role depending on the size of the change.",
     "how": "Draft -> Submitted -> Reviewed -> Approved, routed by approval_role; every step is an append-only audit event.",
     "links": [{"label": "indication_audit_log", "kind": "table"}]},
    {"n": 8, "group": "Compound the book", "activity": "Anyone can reproduce a number later.",
     "how": "The result row carries the exact assumptions, calc_version, experience_version, author and timestamp.",
     "links": [{"label": "indication_results", "kind": "table"}]},
]


# ---- static SPA (built frontend) ----
_DIST = Path(__file__).resolve().parent / "frontend" / "dist"
if _DIST.exists():
    app.mount("/", StaticFiles(directory=str(_DIST), html=True), name="spa")
