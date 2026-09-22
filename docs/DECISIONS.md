# Decisions & gotchas — Rate Indications Workbench

Reverse-chronological. Each entry: what was decided and why.

## 2026-09-22 — initial build

- **Standalone workbench + hub tile, not a section inside Pricing Workbench** (user
  decision). The Bricksurance estate is a federation of per-capability workbench apps on
  a shared data core + hub; a standalone is the estate-native, repeatable pattern and
  keeps the Pricing Workbench's recorded demo clean. This is the "strong architectural
  reason" the original brief allowed for not extending Pricing.
- **Default book = European commercial P&C**, built config-driven (`book_flavour`) so US
  Retail (the brief's Prof Liability / GL / BOP) swaps in. User steer: "repeatable demo,
  not a one-off Hiscox US thing."
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

### Gotchas hit
- A Databricks notebook cell that **starts with `# MAGIC %md`** is treated as an all-
  markdown cell — `spark.sql(...)` lines below it in the same cell silently don't run.
  Keep section headers as plain `# ---- x ----` comments in code cells.
- Workspace-files import in a job needs the `/Workspace` FUSE prefix; `notebookPath()`
  can return the path without it — prepend `/Workspace` before adding to `sys.path`.
- Serverless Spark Connect can't infer a schema for all-`None` columns; build DataFrames
  against the existing DDL schema (`spark.table(t).schema`).
