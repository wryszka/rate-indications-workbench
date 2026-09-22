"""Async Databricks SQL execution with bound parameters (injection-safe)."""
from __future__ import annotations
import asyncio
import os
from typing import Any

from databricks.sdk import WorkspaceClient
from databricks.sdk.service.sql import StatementParameterListItem, StatementState

from config import WAREHOUSE_ID

_wc: WorkspaceClient | None = None


def _client() -> WorkspaceClient:
    global _wc
    if _wc is None:
        # In the Apps runtime the SP creds are injected; locally fall back to a profile.
        if os.getenv("DATABRICKS_APP_NAME") or os.getenv("DATABRICKS_CLIENT_ID"):
            _wc = WorkspaceClient()
        else:
            _wc = WorkspaceClient(profile=os.getenv("DATABRICKS_PROFILE", "DEV"))
    return _wc


def _params(params: dict[str, Any] | None) -> list[StatementParameterListItem] | None:
    if not params:
        return None
    out = []
    for k, v in params.items():
        if isinstance(v, bool):
            out.append(StatementParameterListItem(name=k, value=str(v).lower(), type="BOOLEAN"))
        elif isinstance(v, int):
            out.append(StatementParameterListItem(name=k, value=str(v), type="BIGINT"))
        elif isinstance(v, float):
            out.append(StatementParameterListItem(name=k, value=repr(v), type="DOUBLE"))
        elif v is None:
            out.append(StatementParameterListItem(name=k, value=None))
        else:
            out.append(StatementParameterListItem(name=k, value=str(v)))
    return out


def _execute_sync(sql: str, params: dict[str, Any] | None) -> list[dict[str, Any]]:
    r = _client().statement_execution.execute_statement(
        statement=sql, warehouse_id=WAREHOUSE_ID, wait_timeout="50s",
        parameters=_params(params),
    )
    if r.status and r.status.state in (StatementState.FAILED, StatementState.CANCELED, StatementState.CLOSED):
        msg = r.status.error.message if r.status.error else str(r.status.state)
        raise RuntimeError(f"SQL failed: {msg}")
    if not r.manifest or not r.manifest.schema or not r.manifest.schema.columns:
        return []
    cols = [c.name for c in r.manifest.schema.columns]
    rows: list[dict[str, Any]] = []
    chunk = r.result
    while chunk:
        for row in (chunk.data_array or []):
            rows.append(dict(zip(cols, row)))
        nxt = chunk.next_chunk_index
        if nxt is None:
            break
        chunk = _client().statement_execution.get_statement_result_chunk_n(r.statement_id, nxt)
    return rows


async def execute_query(sql: str, params: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    return await asyncio.to_thread(_execute_sync, sql, params)
