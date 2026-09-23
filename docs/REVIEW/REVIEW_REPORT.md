# Rate Indications Workbench — 8-Agent Demo Review

**Date:** 2026-09-23 · **Standard:** bricksurance-playbook BUILD_AND_REVIEW v2.2 (8-agent panel)
**Under review:** `wryszka/rate-indications-workbench` · live on DEV (`lr_dev_aws_us_catalog.rate_indications`),
app RUNNING at https://rate-indications-workbench-7474656169654171.aws.databricksapps.com

## Verdict: **SHIP WITH ROADMAPPED GAPS**

Seven of eight reviewers say ship (with gaps); the Incumbent Champion — the deliberately hostile lens — says HOLD. Its three deal-breakers are either a genuine fix we should make now (server-side approval enforcement) or honest-labelling gaps (credibility basis, long-tail time-value) that the standard allows as *accepted, labelled* cut-corners. The core is strong: the loss-ratio method is sound and reproduces by hand, the decomposition sums exactly, governance/audit is real and immutable, and the UI is clean and on-house-style. The gaps are (a) a handful of cheap correctness/robustness fixes, (b) three demoability/standard affordances (server-side approval, embedded Genie, live/cached toggle + in-app reset), and (c) framing/labelling. **Ready for internal preflight; close the P0/consensus items before a customer room.**

### Panel verdicts
| # | Reviewer | Verdict |
|---|----------|---------|
| 1 | Practitioner (actuary) | SHIP WITH ROADMAPPED GAPS |
| 2 | Decision-maker (CFO/CRO) | SHIP WITH ROADMAPPED GAPS |
| 3 | Databricks SA (demoability) | SHIP WITH ROADMAPPED GAPS (3 room-affordance gaps) |
| 4 | Senior developer | SHIP WITH ROADMAPPED GAPS |
| 5 | Security | SHIP WITH ROADMAPPED GAPS |
| 6 | Current-Databricks expert | SHIP WITH ROADMAPPED GAPS |
| 7 | Incumbent champion | **HOLD** (3 deal-breakers) |
| 8 | UI/UX expert | **SHIP** |

## Deal-breakers (incumbent + practitioner + decision-maker)
1. **Approval workflow not enforced server-side** — `approval_role` is seeded and shown in the UI, but `store.set_status()` never checks the reviewer's role against the change magnitude; anyone can approve any size. Flagged independently by the Practitioner (#1) and Incumbent (#7); contradicts the app's own governance claim and the standard's Principle 8 ("policy enforced server-side"). **→ FIX now (consensus).**
2. **Credibility `Z` is an unjustified knob** — no Bühlmann / limited-fluctuation basis; swings the indication several points. **→ LABEL** as an expert-override-with-justification + add a Q&A answer (or compute a defensible complement) — currently *not* in DEMO_QA.
3. **No time-value / discounting for long-tail (GL/PL)** — nominal-cost trending only; incumbent estimates ~8–15% overstatement on a 10-year tail. **→ LABEL** as an accepted cut-corner in DEMO_QA + DECISIONS (or scope the shipped book to shorter tails), rather than leave it silent.
4. **Business case / ROI / incumbent positioning is thin** (Decision-maker) — the demo shows the *process*, not the *why-fund-it* (speed, margin at risk, cost of inaction). **→ ADD** a business-case beat + Q&A.

## Can't-show-live → must be answered in DEMO_QA
- Why a +2.5pt severity-trend change moves the indication ~+8pts (long-tail compounding) — *reinforce by showing the decomposition + year detail unprompted*.
- Credibility basis; long-tail time-value; approval enforcement (until fixed); ROI vs incumbent.

## Scorecard tally (themes A–J, P0/P1)
- **A Story:** P0 opens-on-pain **partial** (process-led, ROI thin); no vendor-attack ✅. P1 three-beat **partial**.
- **B Data:** consumes/extends ACORD-shaped layer ✅; single schema, portable `${var.catalog}` ✅. Reserving-triangle seam *documented but not implemented* (P1).
- **C Real & governed:** method credible + reproducible ✅; append-only audit + versioned results ✅; **Genie embedded — MISSING (P0)**; calc in-app not UC function (P1, labelled).
- **D Agents:** advise-not-decide ✅; **deployment/approval authority server-side — NOT enforced (P0/consensus)**; Agent Framework / AI Gateway / MCP — not used (P1, roadmap).
- **E Loop/ops:** Full Build idempotent + seeded ✅; serverless/scale-to-zero ✅; **in-app reset + roll-to-today — MISSING (P1)**; compatibility tier **undeclared** (fix).
- **F Design/UX:** house palette/components ✅; explainers + disclaimer ✅; per-number why ✅; **live/cached "yellow button" — MISSING (P1)**; Learn deep-links not href-wired (nit).
- **G Walkthrough:** beats + one-surface-per-beat ✅; red-team answers partially pre-built (trend ✅; credibility/time-value ✗).
- **H Docs:** runsheet GO/DO/SAY ✅; DEMO_QA ✅ (needs credibility/time-value/ROI additions); DECISIONS ✅.
- **I Three audiences:** practitioner ✅, SA ✅, **decision-maker partial** (ROI).
- **J Panel:** 8-agent panel run ✅ (this report); security clean ✅.

---

## Findings by reviewer (condensed)

### 1 · Practitioner — SHIP WITH ROADMAPPED GAPS
Method sound and defensible (on-level, permissible LR, credibility blend, decomposition all correct; verified sums exactly). **MAJOR:** approval routing shown but not enforced server-side. Trend leverage (+8pts from +2.5pts) realistic for long-tail but *must* show the decomposition + year detail unprompted (Principle 7). On-level assumes no rate change 2025→2027 — disclose. Single-LDF is a labelled V1 limit.

### 2 · Decision-maker — SHIP WITH ROADMAPPED GAPS
Governance/method excellent, but weak on the money story. **Top issue:** no ROI / risk-of-inaction / incumbent framing — a CFO finishes asking "how is this faster/cheaper/safer than today?" and the demo is silent. Portfolio value (~€9m at stake on ~€600m GWP) is present but latent (a tile, not the opening story). Approval thresholds look like placeholders. Recommends: lead on economic risk, quantify speed/cost, add incumbent context, make thresholds defensible, add a portfolio-level what-if.

### 3 · Databricks SA — SHIP WITH ROADMAPPED GAPS
Runsheet/QA excellent; deterministic seeded rebuild ✅; Explain fallback removes stall risk ✅. Three room-affordance gaps vs standard: **(a) no in-app reset** to pristine + roll-to-today (data accumulates on a second run); **(b) no visible live/cached toggle** and it never calls Claude live (always cached fallback); **(c) Genie not embedded**. Warehouse cold-start on first query — warm it pre-demo. Declare the compatibility tier.

### 4 · Senior developer — SHIP WITH ROADMAPPED GAPS (~1h of fixes)
**MAJOR:** (a) float values interpolated into SQL via f-strings (safe today via `float()` but fragile; NaN/Inf would malform SQL) — parameterize; (b) zero on-level premium silently returns 0% indication (`indication_engine.py:171`) — raise instead; (c) bare `except` returns raw `str(e)` to the client (`app.py`) — log + generic message; (d) hardcoded default user (deferred/SSO). **MINOR:** `_effective_ldf` guard 1e-9→1e-6; convoluted status ternary; no Pydantic body validation; thin edge-case tests. Engine + decomposition + determinism + audit pattern all praised.

### 5 · Security — SHIP WITH ROADMAPPED GAPS (no exploitable vulns)
User-controlled values (scenario_id, lob, territory, period, floats) are bound/coerced ✅; no secrets in code or history ✅; egress is synthetic data to an in-workspace FM endpoint ✅; append-only audit ✅. **MAJOR (both deferred/consensus):** identity fallback to a hardcoded email (SSO/OBO in prod); inconsistent parameterization (hardcoded names/units/status/floats interpolated — safe now, tighten). **MINOR:** schema-wide MODIFY grant is broad (mitigated by append-only audit).

### 6 · Current-Databricks expert — SHIP WITH ROADMAPPED GAPS
**BLOCKER (trivial):** `databricks-sdk>=0.30.0` pin is stale — widen/upgrade. **MAJOR (P1/roadmap):** engine not a UC function (lineage/reuse), no Agent Framework + UC AI Gateway for Explain, **Genie not embedded (P0)**. **MINOR:** prefer OpenAI-SDK call pattern for the FM endpoint; use `valueFrom`/resource bindings in app.yaml instead of hardcoded env; consider Liquid Clustering; state the serverless tier. Highest-value quick win: embed Genie ("Ask the book").

### 7 · Incumbent champion — HOLD (3 deal-breakers)
Concedes the calc engine, audit trail and honest roadmap are real. Deal-breakers: **(1)** unjustified credibility Z; **(2)** approval workflow not enforced server-side ("decoration"); **(3)** no time-value on long-tail (material for GL/PL, unlabelled). Plus majors: single-LDF (labelled), on-level scalar (unlabelled), loads-as-% not models, no ULAE/ALAE split, synthetic-only (reserving seam not implemented), no indication confidence range, tier unfilled. Core critique: the demo *claims* governance/credibility that isn't fully enforced/justified — close or label it, don't assert it.

### 8 · UI/UX expert — SHIP
No blockers or majors. House palette/typography/named components throughout; explainers + disclaimer on every page; KPIs lead; one primary CTA; ▲/▼ paired with colour; loading states; responsive; unsaved-preview-vs-recorded distinction is unambiguous; hero selectors→recalc→waterfall flow is obvious. Nits: Learn deep-links not href-wired; one custom `.aigrp` class; Learn nodes non-interactive.

---

## Prioritised remediation

**Fix now (cheap, high-consensus, correctness/governance):**
1. **Enforce approval routing server-side** in `store.set_status`/`review` — reject an approve whose reviewer role doesn't match the change magnitude (Practitioner #1 + Incumbent #7 + Principle 8).
2. **Raise on zero on-level premium** (`indication_engine.py:171`) instead of silent 0%.
3. **Stop leaking raw exceptions** — log server-side, return a generic message (`app.py`).
4. **Parameterize the interpolated SQL floats/names** (Security #5 + Senior dev #4).
5. **Declare the compatibility tier** (Tier 2 — serverless) in STANDARDS.md/DECISIONS.md.
6. **Widen the databricks-sdk pin.**
7. **Label the honest gaps in DEMO_QA + DECISIONS**: credibility basis, long-tail time-value/discounting, on-level scalar — each with a "here's how you'd really do it."

**Fix before a customer room (P0/P1 affordances):**
8. **Embed Genie** ("Ask the book" tab, space created via API) — P0 per standard (SA #3 + Current-DBX #6).
9. **In-app reset** to pristine + roll indication period to current (SA #3, Scorecard E).
10. **Visible live/cached "yellow button"** + actually call Claude live once (SA #3, Scorecard F).
11. **Add the business-case/ROI beat** + incumbent framing to runsheet + DEMO_QA (Decision-maker #2).

**Roadmap (labelled, next phases):**
12. Move calc mechanics into a governed **UC function/job** (already the stated revisit).
13. **Agent Framework + UC AI Gateway + MCP** surface for Explain.
14. **Per-maturity LDF selection** + alt methods (chain-ladder/BF/Cape Cod) via the reserving seam (implement the documented seam).
15. Indication confidence range; ULAE/ALAE split; portfolio-level what-if; app.yaml `valueFrom`; Learn deep-link hrefs.
