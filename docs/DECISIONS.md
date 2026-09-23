# Decisions & gotchas — Rate Indications Workbench

Reverse-chronological. Each entry: what was decided and why.

## 2026-09-22 — initial build

- **Standalone workbench + hub tile, not a section inside Pricing Workbench** (user
  decision). The Bricksurance estate is a federation of per-capability workbench apps on
  a shared data core + hub; a standalone is the estate-native, repeatable pattern and
  keeps the Pricing Workbench's recorded demo clean. This is the "strong architectural
  reason" the original brief allowed for not extending Pricing.
- **Default book = European commercial P&C**, built config-driven (`book_flavour`) so US
  Retail (the brief's Prof Liability / GL / BOP) swaps in. User steer: a repeatable demo,
  not a one-off for a single client.
- **All calculations recorded and audited; mechanics not (permanently) in the app** (user
  steer). Every committed calc writes an immutable `indication_results` row + append-only
  `indication_audit_log` event with `calc_version` + `experience_version`, attributed to
  the real user. The pure-Python engine stays for instant slider what-ifs (clearly
  labelled "unsaved preview — not recorded"); **REVISIT: move the mechanics into a
  governed UC function / job** so the app computes nothing load-bearing itself.
- **Method = classic loss-ratio indication** (on-level → develop → trend → loads →
  credibility → permissible LR → indicated). Deterministic, closed-form, explainable; no
  ML in the calculation. Decomposition is sequential/marginal so contributions sum
  exactly to the total move (no unexplained residual).
- **Data**: own schema `rate_indications`, self-contained like every other DEV workbench,
  but shaped to mirror the data-core / reserving ACORD semantics (earned premium, loss
  triangle, loss/expense/combined ratio). Documented seam to consume
  `reserving_workbench.loss_development` directly when present (the connected-book story).
- **Book is seeded (fixed RNG seed, separate from the version label)** so the demo shows
  the same numbers on every rebuild; the version label is a build timestamp for lineage.
- **Reuse of estate governance patterns**: assumption/scenario registry + approval
  workflow modelled on lifecast (`asm_*`) and solvency-ii-qrt-demo (approval routing).

## 2026-09-23 — post-review remediation (8-agent panel)

Verdict was SHIP WITH ROADMAPPED GAPS (7/8; incumbent champion HOLD). Applied:
- **Compatibility tier: Tier 2 — serverless.** Jobs run on Databricks serverless compute;
  the app runs on Databricks Apps; SQL on a serverless warehouse. Not Free-Edition (needs
  serverless quota + a Foundation Model endpoint).
- **Server-side approval enforcement.** The consensus deal-breaker (practitioner + incumbent):
  `approval_role` was displayed but not enforced. `store.set_status` now rejects an approval
  whose asserted role rank is below the role required for the change magnitude, and audits the
  blocked attempt (`APPROVE_DENIED`). Aligns with playbook Principle 8 (authority enforced
  server-side). Real IdP/UC-group role binding is the production step.
- **Correctness/robustness fixes.** Raise on zero on-level premium (was a silent 0%); generic
  client errors + server-side logging (no raw exception leakage); all SQL writes fully
  parameterised (no float/name f-string interpolation); safer identity fallback ("unknown" in
  the Apps runtime, dev user only locally); `_effective_ldf` guard 1e-9→1e-6; widened SDK pin.
- **Demoability affordances.** In-app **reset** to pristine baselines (audited, `/api/admin/reset`);
  live/cached **AI toggle** (the "yellow button", `/api/ai-mode`) that actually calls Claude live;
  **embedded Genie** ("Ask the book", Conversation API) when a space id is set.
- **Honest labelling** (DEMO_QA + here) of accepted V1 simplifications rather than leaving them
  silent: **credibility Z is an expert-set governed override, not a computed Bühlmann/limited-
  fluctuation Z**; **no discounting / time-value on long-tail** (nominal trending — overstates a
  discounted GL/PL basis); **on-level is a single cumulative index** (no mid-term-change handling).
- **Business-case framing** added to the runsheet + Home + DEMO_QA (ROI / risk-of-inaction).

### Still roadmap (labelled, NOT done)
- Move the calc mechanics into a **governed UC function/job** (the standing revisit — the app
  still computes previews and records committed results in-process today).
- **Agent Framework + UC AI Gateway + MCP** surface for the Explain assistant.
- **Per-maturity LDF selection** + alternative methods (chain-ladder/BF/Cape Cod) via a real
  seam to `reserving_workbench.loss_development` (the seam is documented, not yet implemented).
- Indication **confidence range**; ULAE/ALAE split; large-loss/cat as fitted models; discounted
  basis; portfolio-level what-if; app.yaml `valueFrom` resource bindings; Liquid Clustering.

### Gotchas hit
- A Databricks notebook cell that **starts with `# MAGIC %md`** is treated as an all-
  markdown cell — `spark.sql(...)` lines below it in the same cell silently don't run.
  Keep section headers as plain `# ---- x ----` comments in code cells.
- Workspace-files import in a job needs the `/Workspace` FUSE prefix; `notebookPath()`
  can return the path without it — prepend `/Workspace` before adding to `sys.path`.
- Serverless Spark Connect can't infer a schema for all-`None` columns; build DataFrames
  against the existing DDL schema (`spark.table(t).schema`).
