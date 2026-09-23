"""
"Explain Indication" — a Foundation Model (Claude) narration of the deterministic
results. The model EXPLAINS numbers it is given; it never calculates them. If the
endpoint is unreachable we fall back to a deterministic template so the demo never
stalls (and we say which one produced the text).
"""
from __future__ import annotations
import asyncio
from typing import Any

from config import LLM_ENDPOINT

SYSTEM = (
    "You are a P&C pricing actuary explaining a rate indication to a colleague. "
    "You are given the deterministic results of a loss-ratio rate-indication calculation "
    "and a decomposition of what moved the indication. Explain clearly and concisely "
    "(3-5 sentences) WHY the indication is what it is, quoting the largest contributors "
    "with their point impacts. Do NOT recompute anything, do NOT invent numbers, and do "
    "NOT give advice on what rate to file. Plain business English, no jargon dumps."
)


def _fallback(payload: dict[str, Any]) -> str:
    r = payload["result"]
    seg = payload.get("segment", "this segment")
    ind = r["indicated_rate_change"] * 100
    base = payload.get("baseline_indicated")
    steps = sorted(payload.get("decomposition", []), key=lambda s: -abs(s.get("contribution_pts", 0)))
    lead = f"The {seg} indication is {ind:+.1f}%"
    if base is not None:
        lead += f", up from {base * 100:+.1f}% on the approved baseline" if ind > base * 100 else f", versus {base * 100:+.1f}% on the approved baseline"
    lead += f", against a permissible loss ratio of {r['permissible_loss_ratio'] * 100:.0f}% and a projected loss ratio of {r['projected_loss_ratio'] * 100:.0f}%."
    if steps:
        top = steps[0]
        drivers = f" The largest driver is {top['label'].lower()} ({top['contribution_pts']:+.1f} pts)"
        if len(steps) > 1:
            drivers += f", then {steps[1]['label'].lower()} ({steps[1]['contribution_pts']:+.1f} pts)"
        lead += drivers + "."
    return lead


def _invoke_sync(payload: dict[str, Any]) -> dict[str, Any]:
    try:
        from databricks.sdk import WorkspaceClient
        import os
        w = WorkspaceClient() if (os.getenv("DATABRICKS_APP_NAME") or os.getenv("DATABRICKS_CLIENT_ID")) \
            else WorkspaceClient(profile=os.getenv("DATABRICKS_PROFILE", "DEV"))
        user = (
            f"Segment: {payload.get('segment')}. Indication period: {payload.get('period')}.\n"
            f"Results: {payload['result']}\n"
            f"Baseline indicated: {payload.get('baseline_indicated')}\n"
            f"Decomposition (assumption -> point impact): {payload.get('decomposition')}"
        )
        from databricks.sdk.service.serving import ChatMessage, ChatMessageRole
        resp = w.serving_endpoints.query(
            name=LLM_ENDPOINT,
            messages=[
                ChatMessage(role=ChatMessageRole.SYSTEM, content=SYSTEM),
                ChatMessage(role=ChatMessageRole.USER, content=user),
            ],
            max_tokens=350,
        )
        text = resp.choices[0].message.content
        return {"ok": True, "answer": text, "source": "live", "model": LLM_ENDPOINT}
    except Exception as e:  # noqa: BLE001 — any failure => graceful fallback
        return {"ok": True, "answer": _fallback(payload), "source": "fallback", "error": str(e)[:200]}


async def explain(payload: dict[str, Any], mode: str = "live") -> dict[str, Any]:
    if mode == "cached":
        return {"ok": True, "answer": _fallback(payload), "source": "cached"}
    return await asyncio.to_thread(_invoke_sync, payload)
