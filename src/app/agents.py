"""
Advise-only actuarial agents (Foundation Model / Claude). Each one EXPLAINS,
REVIEWS, INTERROGATES or DRAFTS around the deterministic engine's results — none
of them computes the indication. Same live/cached discipline and graceful
deterministic fallback as agent_client.explain, so a demo never stalls.

Personas:
  review          — pre-submission peer review of a scenario (flags concerns)
  recommend       — proposes a starting assumption set (a draft the actuary edits)
  interrogate     — natural-language Q&A over the rate history / on-level detail
  committee_paper — drafts the plain-English committee paper from a recorded result
"""
from __future__ import annotations
import asyncio
import json
import os
from typing import Any

from config import LLM_ENDPOINT

_SYSTEMS = {
    "review": (
        "You are a senior reviewing actuary doing a quick pre-submission peer review of a P&C "
        "rate indication. You are given the scenario's assumptions, the on-level basis and the "
        "deterministic result (with its decomposition). In 3-6 short bullets, flag anything worth "
        "a second look before sign-off: a trend out of step with the experience, low credibility, "
        "an on-level method that looks too crude for the book, a large gap between the indicated "
        "and selected rate, or provisions that look off. If it looks sound, say so briefly. "
        "Do NOT recompute anything or invent numbers; you are advising, the engine decides."),
    "recommend": (
        "You are a pricing actuary proposing a STARTING assumption set for a colleague to review "
        "and edit — not a final answer. Given the segment's experience summary and the current "
        "baseline assumptions, suggest values for the assumptions and explain your reasoning in "
        "2-4 sentences. End with a single line of strict JSON: {\"suggested\": {name: value, ...}} "
        "using decimals (0.08 = 8%) for the assumption names given. The engine will compute the "
        "indication from whatever the actuary finally chooses; never state an indicated rate yourself."),
    "interrogate": (
        "You are explaining a P&C on-level earned premium calculation to a colleague. You are given "
        "the dated rate-change history, the earning-aware per-year indices and factors, and the raw "
        "vs on-level reported loss ratios. Answer the question clearly in 2-5 sentences using ONLY "
        "the supplied numbers. Do not recompute or invent figures; if the answer isn't in the data, "
        "say what's missing."),
    "committee_paper": (
        "You are drafting a concise rate-indication committee paper (filing memo) from a recorded "
        "result. Cover: the segment and period; the on-level method used; the indicated rate change "
        "vs the actuary's selected rate and the stated reason; the main drivers from the "
        "decomposition; and the governance footprint (calc version, data version, who/when). "
        "Professional, neutral memo tone, ~150-220 words. Narrate the supplied numbers exactly; "
        "invent nothing; do not recommend a different rate."),
}


def _fallback(persona: str, payload: dict[str, Any]) -> str:
    seg = payload.get("segment", "this segment")
    r = payload.get("result") or {}
    if persona == "review":
        bits = [f"- {seg}: indicated {r.get('indicated_rate_change', 0) * 100:+.1f}% on a "
                f"{r.get('on_level_method', 'legacy')} on-level basis."]
        if payload.get("selected_rate_change") is not None:
            bits.append(f"- Selected {payload['selected_rate_change'] * 100:+.1f}% vs indicated — confirm the rationale is recorded.")
        bits.append("- Check the severity/frequency trend against the segment's own experience and the credibility weight.")
        return "\n".join(bits)
    if persona == "recommend":
        return ("Starting point: keep the approved baseline assumptions and adjust severity trend to "
                "the segment's recent experience before recalculating.\n{\"suggested\": {}}")
    if persona == "interrogate":
        return "On-level restates historic premium to the reference rate level; the factor is the reference index divided by each year's average earned index."
    return (f"Rate indication — {seg}. Indicated {r.get('indicated_rate_change', 0) * 100:+.1f}% "
            f"(method: {r.get('on_level_method', 'legacy')}). Recorded with calc version "
            f"{r.get('calc_version', '')}. See the scenario's audit trail for who and when.")


def _invoke_sync(persona: str, payload: dict[str, Any], question: str | None) -> dict[str, Any]:
    try:
        from databricks.sdk import WorkspaceClient
        w = WorkspaceClient() if (os.getenv("DATABRICKS_APP_NAME") or os.getenv("DATABRICKS_CLIENT_ID")) \
            else WorkspaceClient(profile=os.getenv("DATABRICKS_PROFILE", "DEV"))
        from databricks.sdk.service.serving import ChatMessage, ChatMessageRole
        user = json.dumps(payload, default=str)
        if question:
            user = f"Question: {question}\n\nData:\n{user}"
        resp = w.serving_endpoints.query(
            name=LLM_ENDPOINT,
            messages=[ChatMessage(role=ChatMessageRole.SYSTEM, content=_SYSTEMS[persona]),
                      ChatMessage(role=ChatMessageRole.USER, content=user)],
            max_tokens=600)
        text = resp.choices[0].message.content
        out: dict[str, Any] = {"ok": True, "answer": text, "source": "live", "persona": persona}
        if persona == "recommend":
            out["suggested"] = _parse_suggested(text)
        return out
    except Exception as e:  # noqa: BLE001
        out = {"ok": True, "answer": _fallback(persona, payload), "source": "fallback", "persona": persona, "error": str(e)[:200]}
        if persona == "recommend":
            out["suggested"] = {}
        return out


def _parse_suggested(text: str) -> dict[str, float]:
    """Best-effort parse of the trailing {"suggested": {...}} JSON; empty on failure."""
    try:
        i = text.rindex("{\"suggested\"")
        obj = json.loads(text[i:text.rindex("}") + 1])
        return {k: float(v) for k, v in (obj.get("suggested") or {}).items()}
    except Exception:  # noqa: BLE001
        return {}


async def run(persona: str, payload: dict[str, Any], mode: str = "live", question: str | None = None) -> dict[str, Any]:
    if persona not in _SYSTEMS:
        return {"ok": False, "error": f"unknown persona {persona}"}
    if mode == "cached":
        out = {"ok": True, "answer": _fallback(persona, payload), "source": "cached", "persona": persona}
        if persona == "recommend":
            out["suggested"] = {}
        return out
    return await asyncio.to_thread(_invoke_sync, persona, payload, question)
