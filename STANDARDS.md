# Standards

This demo is built and reviewed against the **Bricksurance demo standard**, which lives in one canonical place — this repo does **not** copy it.

- **Standard:** https://github.com/wryszka/bricksurance-playbook
  - `BUILD_AND_REVIEW.md` — the build method + the review scorecard (the bar)
  - `DESIGN_LANGUAGE.md` — the house visual style (canonical tokens)
  - `MANIFESTO.md` — the why
- **Reviewed against standard version:** `2.3` (re-reviewed 2026-09-23). Known gap vs v2.3: the new **platform-native P0 gate** (agents/tools/decision-gates as Databricks-native objects — Agent Framework via UC AI Gateway, MCP-first, calc as UC functions; app a thin client) is **not met yet** — agents are app-hosted Foundation-Model calls and the calc runs in-process. Labelled roadmap in `docs/DECISIONS.md`, not claimed as done.
- **This demo's compatibility tier:** **Tier 2 — Serverless-only.** Serverless SQL warehouse + serverless jobs + Databricks Apps + a Foundation Model endpoint (Claude). No classic compute. Not Free-Edition (needs serverless quota + FM access).

New here? Two entry points: **bringing this demo to Bricksurance** → it goes through the standard's review; **extending/building** → start from the standard. Copy only *this* pointer file into a demo repo — never the standard itself.
