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

## 2026-09-23 — On-level earned premium (Phase 1A + 1B)

Added dated/earning-aware on-levelling as an extension of the existing engine (calc_version
1.1.0). Answers "what would this historical earned premium have been at the reference rate
level?" — a standard actuarial adjustment, not a forecast and not loss dev/trend/mix.
- **Two methods.** `legacy_annual_index` (the existing simplification — reference index ÷ the
  year's annual index; what a spreadsheet does) and `parallelogram_fixed_term` (earning-aware:
  average EARNED index derived analytically from dated rate changes under uniform writing +
  straight-line earning of a 365-day term). Math in `src/app/on_level.py` (stdlib), validated
  against the brief's worked examples to 1e-10 / a penny (`scripts/test_on_level.py`).
- **The demo spine is preserved (user decision).** The seeded **approved baseline stays on
  legacy annual-index**, so GL/Germany holds at **+6.6%** through Steps 1–2 and the Act-1
  spreadsheet still ties. The parallelogram method is the **Step-3 upgrade**: switching it on
  moves GL/DE to **+5.4%** (−1.15 pts) — the "what the platform gives you that Excel couldn't"
  beat. Re-baselining the whole book on parallelogram was rejected (would break the spine).
- **Raw vs on-level reported LR** surfaced (same losses, different denominator) — distinct from
  the trended `projected_loss_ratio`. The engine's `detail_years.loss_ratio` keeps its contract
  (trended-ultimate / OLEP); new `raw_reported_lr` / `on_level_reported_lr` fields added, not
  relabelled. `experience_loss_ratio` documented as the *loaded* LR (not the credibility Z).
- **On-level factors are pluggable** into `calc_segment` (legacy = None → inline, bit-identical
  to before; parallelogram = per-year factors). Only the premium denominator changes; loss
  develop/trend/loads/credibility are untouched. Invalid permissible LR now *rejects* for new
  calcs (no silent floor).
- **Governance / reproducibility.** Every recorded result carries `input_snapshot_json` +
  `input_hash` + `rate_history_version` + `premium_summary_json`, so it reproduces even after the
  source tables are regenerated; a `last_calculated_input_hash` on the scenario is the **stale-
  input guard** (a scenario edited since its last calculation cannot be submitted — 409). The
  result's `selected_rate_change` is no longer auto-set to the indication (selected ≠ indicated).
- **Migration is additive + idempotent** (`ALTER ADD COLUMNS`, introspected — never drops or
  rewrites rows); existing saved scenarios/results survive, old rows read legacy. `Reset demo`
  stays the one explicit wipe.
- **Data**: synthetic rate history seeded with Jan-1 effective dates (`date_source=
  assumed_from_year`), a baseline index 1.0 from 2018-01-01 (covers the earliest earning cohort),
  reference date 2026-01-01, 365-day term. Losses unchanged (still annual-index-constructed) so
  the legacy baseline is stable and the method comparison is honest.
- **Deferred (labelled): Phase 2** monthly/quarterly + term mixtures + supplied-average-index;
  **Phase 3** policy-level rerating. And still: calc→governed UC function/job (unchanged — the
  app still computes in-process; NOT claimed migrated).

### Gotchas hit
- `ALTER TABLE … ADD COLUMNS IF NOT EXISTS` is not accepted here — introspect existing columns
  and add only the missing ones.
- A Databricks notebook cell that **starts with `# MAGIC %md`** is treated as an all-
  markdown cell — `spark.sql(...)` lines below it in the same cell silently don't run.
  Keep section headers as plain `# ---- x ----` comments in code cells.
- Workspace-files import in a job needs the `/Workspace` FUSE prefix; `notebookPath()`
  can return the path without it — prepend `/Workspace` before adding to `sys.path`.
- Serverless Spark Connect can't infer a schema for all-`None` columns; build DataFrames
  against the existing DDL schema (`spark.table(t).schema`).
