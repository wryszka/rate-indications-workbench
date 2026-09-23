"""
Thin client to the platform-native agent — the Mosaic AI Agent-Framework
`ResponsesAgent` served at the `rate-indications-agent` endpoint (UC AI Gateway),
whose tools are the governed UC functions. This is the "app-hosted → platform-
native" path: the app holds no agent logic, it just calls the served endpoint.
Falls back to the in-process agents (agents.py) if the endpoint is unavailable.
"""
from __future__ import annotations
import asyncio
import os
from typing import Any

AGENT_ENDPOINT = os.getenv("AGENT_ENDPOINT", "rate-indications-agent")


def _client():
    from databricks.sdk import WorkspaceClient
    if os.getenv("DATABRICKS_APP_NAME") or os.getenv("DATABRICKS_CLIENT_ID"):
        return WorkspaceClient()
    return WorkspaceClient(profile=os.getenv("DATABRICKS_PROFILE", "DEV"))


def _extract_text(resp: Any) -> str:
    """Pull assistant text out of whatever shape the endpoint returns (ResponsesAgent
    {output:[...]} or OpenAI {choices:[...]})."""
    d = resp if isinstance(resp, dict) else getattr(resp, "as_dict", lambda: {})()
    parts: list[str] = []
    for item in (d.get("output") or []):
        if isinstance(item, dict):
            for c in (item.get("content") or []):
                if isinstance(c, dict) and c.get("text"):
                    parts.append(c["text"])
            if not item.get("content") and item.get("text"):
                parts.append(item["text"])
    if parts:
        return "\n".join(parts).strip()
    ch = d.get("choices") or []
    if ch and isinstance(ch[0], dict):
        return ((ch[0].get("message") or {}).get("content") or "").strip()
    return ""


def _ask_sync(question: str) -> dict[str, Any]:
    w = _client()
    # ResponsesAgent native input schema; raw invocations so we don't depend on SDK helpers.
    path = f"/serving-endpoints/{AGENT_ENDPOINT}/invocations"
    resp = w.api_client.do("POST", path, body={"input": [{"role": "user", "content": question}]})
    text = _extract_text(resp)
    if not text:
        raise RuntimeError("empty agent response")
    return {"ok": True, "answer": text, "source": "platform"}


async def ask(question: str) -> dict[str, Any]:
    """Query the served agent; raises on failure so the caller can fall back."""
    return await asyncio.to_thread(_ask_sync, question)
