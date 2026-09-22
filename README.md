# Rate Indications Workbench — Bricksurance

An interactive **P&C rate-indication / assumption-setting & review** capability for a
pricing actuary. Review the current indication, inspect and change the assumptions
driving it, watch the indicated rate change recalculate, see *why* it moved, compare
scenarios, record a **selected** rate versus the **indicated** rate, and run a
lightweight Draft → Submitted → Reviewed → Approved workflow — all with a full,
reproducible audit trail.

Part of the Bricksurance actuarial-workbench estate. Fictional insurer, **synthetic
data**. Built to be **repeatable**: the default book is European commercial P&C
(Property / General Liability / Commercial Motor across DE/FR/IT/ES/NL); a US Retail
flavour (Professional Liability / GL / BOP across TX/CA/NY/FL/IL) ships as an alternate
`book_flavour` — the workbench itself is book-agnostic.

## The method (transparent, no ML)

The classic **loss-ratio rate-indication method**, computed as closed-form arithmetic
so any number reproduces by hand:

```
experience → on-level premium → develop losses to ultimate → trend to prospective
→ large-loss / cat loads → credibility blend → permissible loss ratio → indicated rate
```

`indicated change = projected loss ratio ÷ permissible loss ratio − 1`, where
`permissible = 1 − (expenses + commission + reinsurance + profit)`. Eleven editable
assumptions drive it (severity/frequency trend, selected development, large-loss & cat
loads, credibility, experience period, expense/commission/reinsurance/profit). A
**marginal decomposition** attributes every point of movement to a specific assumption,
and the contributions sum exactly to the total move.

The arithmetic lives in `src/app/indication_engine.py` (single source of truth, unit
tested offline). **Every committed calculation is recorded** to `indication_results`
and every action to the append-only `indication_audit_log`, attributed to the real
user, with `calc_version` + `experience_version` — reproducible, never ephemeral.
(Roadmap: move the mechanics into a governed UC function / job so the app computes
nothing itself — see `docs/DECISIONS.md`.)

## Layout

```
databricks.yml              DAB bundle (DEV target; portable ${var.catalog})
resources/build.yml         "Full Build" job: setup → generate book + seed baselines
src/00_setup/00_setup.py    schema + all tables (governance tables append-only)
src/01_data/01_generate_book.py  deterministic synthetic book + audited baseline seeding
src/common/gen_book.py      shared, seeded book generator (both flavours)
src/app/                    Databricks App — FastAPI + React (Vite, tokens.css)
  indication_engine.py      the deterministic calc (shared with the build)
  store.py                  data access + governed recording
  agent_client.py           "Explain Indication" (Claude via Foundation Model API)
scripts/                    offline engine test + data calibration harness
docs/                       run-sheet, Q&A, decisions, data dictionary
```

## Build & run

```bash
# 1. data + audited baselines (idempotent)
databricks bundle deploy -t dev -p DEV
databricks bundle run rate_indications_full_build -t dev -p DEV

# 2. app (first deploy is two-phase — app must be created so its SP exists, then grant it)
databricks apps create rate-indications-workbench -p DEV      # once
#   grant the app SP: CAN_USE on the warehouse; USE CATALOG / USE SCHEMA / SELECT / MODIFY on the schema
./deploy.sh

# offline: validate the math and calibrate the book without Databricks
python3 scripts/test_engine.py
python3 scripts/calibrate.py eu_commercial
```

App: https://rate-indications-workbench-7474656169654171.aws.databricksapps.com

## Demo (≈4 min)

Portfolio → open **General Liability / Germany** (baseline **+6.6%**) → raise severity
trend 5.5% → 8% (and large-loss load) → indication recalculates to **≈+15%** → the
decomposition shows severity trend as the driver (~+8 pts) → **Explain** narrates it →
save as *Actuarial Recommended*, enter a **selected** rate of +8% with a comment →
submit → approve → the audit trail shows every step, reproducible. See
`docs/DEMO_RUNSHEET.md`.
