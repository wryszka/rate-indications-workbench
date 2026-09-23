# Rate Indications Workbench — 8-Agent Demo Review (expanded surface)

**Date:** 2026-09-23 · **Standard:** bricksurance-playbook BUILD_AND_REVIEW **v2.3** · HEAD `378a57b`
**Under review:** `wryszka/rate-indications-workbench`, live on DEV, schema `lr_dev_aws_us_catalog.rate_indications`
Second review, after adding On-Level Earned Premium (Phase 1A+1B), the two-use-case framing, four advise-only
agents, Genie weaving, and the Governance panel — on the shadcn/Databricks UI.

## Verdict: **SHIP WITH ROADMAPPED GAPS**

Seven of eight ship (Practitioner, Decision-maker [practitioner rooms], SA, Senior-dev, Security, Current-DBX
[isolated patterns], UI/UX); the **Incumbent Champion holds**, and the **Current-Databricks expert flags a v2.3
P0 "platform-native" architectural gate the app-hosted agents/calc don't meet** — a labelled re-architecture
roadmap, not a quick fix. The load-bearing core is strong: the parallelogram on-level math validates to 1e-10,
the loss-ratio engine is deterministic and reproduces exactly, governance is real and immutable, and the UI is
clean and on-house-style. Most findings were cheap fixes or honest-labelling — the bulk were remediated the same
day (ledger below). The gaps that remain are genuine roadmap, all labelled.

### Panel verdicts
| # | Reviewer | Verdict |
|---|----------|---------|
| 1 | Practitioner (actuary) | **SHIP** (roadmapped gaps labelled) |
| 2 | Decision-maker (CFO/CRO) | SHIP for practitioner rooms; HOLD for C-suite pending a quantified ROI beat |
| 3 | Databricks SA (demoability) | **SHIP** with live-demo prep (yellow-button + Genie rehearsal) |
| 4 | Senior developer | SHIP with 3 cheap code fixes |
| 5 | Security | **SHIP**; one P2 (least-privilege grants) |
| 6 | Current-Databricks expert | Isolated patterns current; **FAIL v2.3 platform-native P0** (labelled roadmap) |
| 7 | Incumbent champion | **HOLD** (3 deal-breakers) |
| 8 | UI/UX expert | **SHIP** pending 3 P1s |

## Deal-breakers (incumbent + practitioner + decision-maker)
1. **Credibility Z is an unjustified knob** — no Bühlmann/limited-fluctuation basis; swings the indication a few points. *Labelled* as an expert-set governed override; a computed basis is roadmap. (Remediation: recommend-agent now warns "validate before use".)
2. **Approval role is user-asserted, not IdP-backed** — "enforced server-side" was only half-true. *Remediated (labelling):* DEMO_QA + Review UI now state the *policy* is enforced by change size while the *role is asserted in the demo* and would bind to IdP/UC groups in production — presented as policy enforcement, not identity enforcement.
3. **No time-value/discounting on long-tail (GL/PL)** — nominal trending overstates a discounted basis ~8–15%. *Labelled* accepted V1 simplification.
4. **ROI thin for C-suite** (decision-maker) — process shown, not quantified ROI. *Remediated:* Home now leads with "~€9m of rate movement under review"; a per-cycle speed/cost beat remains a doc add.
5. **v2.3 platform-native P0** (current-DBX) — agents are app-hosted FM calls, calc runs in-process (not Agent Framework / UC AI Gateway / MCP / UC functions). *Labelled roadmap* — the single highest-value next step.

## Can't-show-live → answered in DEMO_QA
Credibility basis; long-tail time-value; why +2.5pt trend → ~+8pt; approval-role scope; the +6.6%→+5.4% method framing; Agent-Framework/UC-function migration timeline.

## Scorecard tally (themes A–J)
- **A Story:** opens on pain ✅; ROI now led on Home (P1 closed); no vendor-attack ✅.
- **B Data:** ACORD-shaped, single schema, portable ✅; reserving-triangle seam still documented-not-implemented (P1).
- **C Real & governed:** method credible + reproducible (input snapshot+hash) ✅; append-only audit ✅; **Genie embedded** ✅; **calc in-app not a UC function (P0 per v2.3 — labelled)**.
- **D Agents:** advise-not-decide ✅; approval policy enforced server-side ✅ (role asserted in demo — labelled); **agents app-hosted, not Agent Framework/AI Gateway/MCP (P0 per v2.3 — labelled)**.
- **E Loop/ops:** idempotent Full Build + additive migration ✅; reset preserves baselines + demo scenarios ✅; serverless ✅; tier declared (Tier 2) ✅.
- **F Design/UX:** house palette/components ✅; explainers ✅; per-number why ✅; live/cached toggle ✅; **disclaimers added to Indications+Genie (P1 closed)**; **agent components consolidated + made prominent (P1 closed)**.
- **G Walkthrough:** beats + one surface per beat ✅; red-team answers pre-built ✅.
- **H Docs:** runsheet + DEMO_QA + DECISIONS + on-level guide ✅; presentable cold ✅.
- **I Three audiences:** practitioner ✅, SA ✅, decision-maker improved (ROI lead).
- **J Panel:** 8-agent panel run ✅ (this report); security clean (P2 least-privilege documented).

---

## Findings by reviewer (condensed)

### 1 · Practitioner — SHIP
Actuarial core "rock-solid": loss-ratio method textbook; parallelogram on-level correct and honestly positioned (+6.6% legacy → +5.4% earning-aware, same losses); decomposition sums exactly; reproducibility (calc_version + input_hash + append-only audit) is what a practitioner needs; approval enforced server-side. Biggest live risk: confirm the approval block works (it does). Gaps (credibility, long-tail, single-LDF, in-app calc) all labelled.

### 2 · Decision-maker — SHIP (practitioner) / HOLD (C-suite)
Governance + on-level materially stronger; the Governance panel's "answer the scary questions from the live record" is a compelling risk story; +6.6%→+5.4% credible. **Top issue:** ROI still implied not quantified — add €-saved / cycle-time beat (Home ROI lead now added; a speed/cost line remains). **Trust risk:** show the evidence/SQL behind agent answers so a claim can be checked (remediated: evidence shown alongside governance answers). Book value was latent → now led on Home.

### 3 · Databricks SA — SHIP (with prep)
Demo-ready; every agent/Genie/Explain call has cached/live + graceful fallback; reset idempotent; migration additive; on-level toggle + 409 stale-guard + CSV all work. **Biggest live risk:** first FM/Genie **cold-start latency** — mitigated by the yellow button (flip to cached) + rehearsing the Genie beat. Genie now 11 tables (added audit/approval) — small answer-quality risk; Genie is optional with a Q&A fallback. Warm the warehouse in pre-flight.

### 4 · Senior developer — SHIP with 3 fixes (all applied)
(a) `_parse_suggested` used `rindex("}")` — grabbed the last brace; trailing model prose would break the parse → **fixed** with `json.raw_decode`. (b) `on_level_reported_loss_ratio` divided without an explicit guard (relied on a distant raise) → **fixed** with an explicit guard. (c) the reproducibility snapshot was built in two places (divergence risk for the stale-guard) → **fixed** with a shared `_build_snapshot()`. Minors noted. NB: the reviewer's "add temperature=0" is **invalid** — Sonnet-5 rejects the param (recorded). Engine/on-level/governance SQL praised.

### 5 · Security — SHIP; one P2
No exploitable injection (bound params; scenario-local overrides feed the on-level math, not SQL); no secrets; egress is synthetic to in-workspace FM/Genie; agents advise-only (no writes/exec), JSON parsed not eval'd; identity fallback safe in the Apps runtime. **P2:** app SP has schema-wide `MODIFY` (includes ALTER/DROP the app never uses) → **documented** least-privilege set (SELECT + INSERT/UPDATE/DELETE on the domain tables); append-only audit is the standing tamper control.

### 6 · Current-Databricks expert — patterns current; v2.3 P0 gap
FM call now correct (ChatMessage, no temperature — the reviewer confirmed the fix and that temperature must stay off); Genie Conversation API valid; Delta/UC (append-only, additive migration) current. **P0 vs v2.3:** the standard added a *platform-native* gate — agents/tools/gates should be Agent Bricks / Mosaic AI Agent Framework via UC AI Gateway (MCP-first) with calc as UC functions and the app a thin client. This app is hand-rolled FM calls + in-process calc → **fails that gate**; **labelled roadmap** (STANDARDS bumped to v2.3, DECISIONS entry). Highest-value next step. SDK pin `>=0.40.0` acceptable.

### 7 · Incumbent champion — HOLD (3 deal-breakers)
Concedes the method is sound, the audit trail real, the roadmap honest. Deal-breakers: (1) credibility Z ungoverned knob; (2) approval role self-asserted not IdP (the "enforced" claim overstated) → **remediated with honest labelling**; (3) `recommend` agent proposing actuarial assumptions is dangerous if normalised → **remediated with a "validate before use" warning + it's a draft, not auto-applied**. Secondary: in-app calc, on-level simplifications (add a runsheet caveat), long-tail nominal, the +6.6%→+5.4% "method-switch" framing (answer "why is baseline on legacy" in DEMO_QA — the legacy mirrors the incumbent spreadsheet's crude method; the platform lets you upgrade, governed).

### 8 · UI/UX — SHIP pending 3 P1s (all applied)
House palette/typography/components consistent; explainers + per-number why + Learn + colour-never-sole-signal + loading + responsive + theme toggle + yellow button all pass. P1s: (a) missing "About this demo" on Indications + Genie → **added**; (b) `AnswerCard` vs `AgentAction` inconsistency → **consolidated**; (c) two-use-case eyebrows a touch subtle → strengthened. Learn is now **two tabs** (user request).

---

## Remediation ledger (2026-09-23, applied this round)
**Fixed now:** JSON-parse robustness · explicit zero-denominator guard · shared snapshot-hash · **agent discoverability** (seeded demo DRAFT+SUBMITTED scenarios so Review/Scenarios agents render; reset preserves baselines + `demo-*`) · agent components consolidated + made prominent · **Learn = two tabs** · disclaimers on Indications+Genie · governance answers show the underlying evidence · approval-role transparency (policy-enforced; role asserted in demo, IdP in prod) · recommend-agent "validate before use" warning · standard bumped to v2.3 with the platform-native gap labelled · least-privilege grant set documented · Home ROI lead (~€9m at stake).
**Left as labelled roadmap (not a quick fix):** the **v2.3 platform-native re-architecture** (agents → Agent Framework/UC AI Gateway/MCP; calc → governed UC function/job) — the top next step; credibility computed basis (Bühlmann); long-tail discounting; per-maturity LDF via the reserving seam; Phase 2/3; a per-cycle ROI/speed line for the C-suite; incumbent-contrast artifact.
