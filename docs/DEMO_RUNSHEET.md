# Demo run-sheet — Rate Indications Workbench (≈4–5 min)

Presenter beats. **SAY** ≤20 words, no platform words. **GO** where to be, **DO** the
click, **IF-ASKED** the answer to the obvious question.

---

**Beat 0 — the business case (Home)**
- GO: Home.
- SAY: "Repricing today is slow, spreadsheet-driven and hard to audit. This decides it in one governed place."
- DO: point at the headline — ~€600m book, +1.5% portfolio indication ≈ ~€9m of rate movement being decided.
- SAY: "The cost of doing it slowly is underpriced segments you don't fix between cycles."
- IF-ASKED (real?): fictional insurer, synthetic data; the method and the governance are the point.
- IF-ASKED (replace our tools?): it layers on them — enrich/wrap — not rip-and-replace.

**Beat 1 — the portfolio (Portfolio)**
- GO: Portfolio, period 2027.
- DO: point at the spread — some segments need increases, some decreases; portfolio indicated ≈ +1.5%.
- SAY: "Across the book, the maths says some lines are underpriced and some overpriced."
- DO: click **General Liability / Germany** (+6.6%).

**Beat 2 — the current indication + its assumptions (Indications)**
- SAY: "German liability indicates +6.6%. Here's the basis behind it."
- DO: show the KPI tiles (current rate level, projected loss ratio, current indication) and the assumptions table (baseline column).

**Beat 3 — change an assumption, recalc instantly**
- DO: raise **Severity trend** 5.5% → 8%; raise **Large-loss load** 4% → 6%.
- SAY: "Latest claims say severity is running hotter. Watch the indication."
- DO: indication updates live to ≈ **+15%**; "Change vs baseline ≈ +9 pts".

**Beat 4 — why did it move? (decomposition)**
- SAY: "Why +15 and not +6.6? The maths shows me."
- DO: point at the waterfall — Severity trend ≈ +8 pts, Large-loss ≈ +0.9 pts (sums exactly to the move).

**Beat 5 — Explain**
- DO: click **Explain indication**.
- SAY: "And in plain English for the committee pack."
- IF-ASKED (does the AI do the maths?): no — it narrates the deterministic result; it never computes.

**Beat 6 — save + select a rate**
- DO: **Save as scenario** "Actuarial Recommended"; then enter **Selected rate = +8%**, comment "Severity up on latest experience; moderated for competitive reasons."
- SAY: "The indicated rate isn't always the filed rate. I record my selection and why."

**Beat 7 — govern it (Scenarios → Review)**
- DO: **Submit**; go to Review; **Approve** (note the role that applies by size of change).
- SAY: "A colleague signs off — routed by how big the change is."

**Beat 8 — reproduce it (Review → Audit)**
- DO: open the Audit trail — Create/Edit/Calculate/Select/Submit/Approve, each with who and when; show `calc_version` + `experience_version` on the recorded result.
- SAY: "Every number reproduces: the exact assumptions, method version and data version, who and when."

**Beat 9 — back to portfolio**
- DO: Portfolio again — the selected rate now sits alongside the other segments.
- SAY: "One governed workflow, from the number to the sign-off, for the whole book."
