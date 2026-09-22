"""App configuration and per-request user identity (env-driven, portable)."""
from __future__ import annotations
import os
from contextvars import ContextVar

CATALOG = os.getenv("CATALOG_NAME", "lr_dev_aws_us_catalog")
SCHEMA = os.getenv("SCHEMA_NAME", "rate_indications")
WAREHOUSE_ID = os.getenv("WAREHOUSE_ID", "a3b61648ea4809e3")
LLM_ENDPOINT = os.getenv("LLM_ENDPOINT", "databricks-claude-sonnet-5")
ENTITY_NAME = os.getenv("ENTITY_NAME", "Bricksurance SE")
BOOK_FLAVOUR = os.getenv("BOOK_FLAVOUR", "eu_commercial")
# "cached" serves canned answers first (fast, no beat stalls); "live" always calls the model.
AI_RESPONSE_MODE = os.getenv("AI_RESPONSE_MODE", "cached")
GENIE_SPACE_ID = os.getenv("GENIE_SPACE_ID", "")

# Set by middleware from the Databricks Apps forwarded headers; used to attribute
# every governed write to the real end user, never the app service principal.
_current_user: ContextVar[str] = ContextVar("current_user", default="unknown")


def set_current_user(user: str) -> None:
    _current_user.set(user or "unknown")


def current_user() -> str:
    return _current_user.get()


def fqn(table: str) -> str:
    return f"`{CATALOG}`.`{SCHEMA}`.{table}"
