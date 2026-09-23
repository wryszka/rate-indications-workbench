"""
"Ask the book" — embedded Genie over the rate_indications tables via the Genie
Conversation API. Raw REST through the SDK's api_client so it's robust across SDK
versions. Disabled gracefully when no GENIE_SPACE_ID is configured.
"""
from __future__ import annotations
import asyncio
import os
import time
from typing import Any

from config import GENIE_SPACE_ID


def _client():
    from databricks.sdk import WorkspaceClient
    if os.getenv("DATABRICKS_APP_NAME") or os.getenv("DATABRICKS_CLIENT_ID"):
        return WorkspaceClient()
    return WorkspaceClient(profile=os.getenv("DATABRICKS_PROFILE", "DEV"))


def _do(w, method: str, path: str, body: dict | None = None) -> dict:
    return w.api_client.do(method, path, body=body) or {}


def _ask_sync(question: str, conversation_id: str | None) -> dict[str, Any]:
    if not GENIE_SPACE_ID:
        return {"enabled": False}
    w = _client()
    base = f"/api/2.0/genie/spaces/{GENIE_SPACE_ID}"
    if conversation_id:
        r = _do(w, "POST", f"{base}/conversations/{conversation_id}/messages", {"content": question})
        message_id = r.get("message_id") or r.get("id")
    else:
        r = _do(w, "POST", f"{base}/start-conversation", {"content": question})
        conv = r.get("conversation") or {}
        msg = r.get("message") or {}
        conversation_id = r.get("conversation_id") or conv.get("id")
        message_id = r.get("message_id") or msg.get("id")

    # poll the message to completion
    msg = {}
    deadline = time.time() + 90
    while time.time() < deadline:
        msg = _do(w, "GET", f"{base}/conversations/{conversation_id}/messages/{message_id}")
        status = msg.get("status")
        if status in ("COMPLETED", "FAILED", "CANCELLED", "QUERY_RESULT_EXPIRED"):
            break
        time.sleep(2)

    if msg.get("status") != "COMPLETED":
        return {"enabled": True, "conversation_id": conversation_id,
                "answer": "Genie could not answer that one — try rephrasing.", "status": msg.get("status")}

    answer, sql, columns, rows = None, None, None, None
    for att in (msg.get("attachments") or []):
        if att.get("text"):
            answer = att["text"].get("content")
        if att.get("query"):
            q = att["query"]
            sql = q.get("query")
            aid = att.get("attachment_id") or att.get("id")
            try:
                qr = _do(w, "GET", f"{base}/conversations/{conversation_id}/messages/{message_id}/attachments/{aid}/query-result")
                sr = (qr.get("statement_response") or {})
                cols = [c["name"] for c in (sr.get("manifest", {}).get("schema", {}).get("columns", []))]
                data = (sr.get("result", {}).get("data_array") or [])[:50]
                columns, rows = cols, data
                if not answer and q.get("description"):
                    answer = q["description"]
            except Exception:  # noqa: BLE001 — text answer still useful without the grid
                pass
    return {"enabled": True, "conversation_id": conversation_id,
            "answer": answer or "(no text answer)", "sql": sql, "columns": columns, "rows": rows}


async def ask(question: str, conversation_id: str | None = None) -> dict[str, Any]:
    if not question.strip():
        return {"enabled": bool(GENIE_SPACE_ID), "answer": "Ask a question about the book."}
    return await asyncio.to_thread(_ask_sync, question, conversation_id)
