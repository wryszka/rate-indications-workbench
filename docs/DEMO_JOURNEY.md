# Demo run-sheet — "Getting a rate indication into Databricks"

A demo of a **process**, not an app: how a real actuarial workflow moves onto
Databricks one small, low-risk step at a time. You start in the customer's world
(a spreadsheet) and take four steps; the **app is the last step**, not the opening.
Written so a colleague who has never seen it can present it cold.

**The spine:** the same number — **General Liability / Germany, +6.6%** — is
reproduced at every step (spreadsheet → notebook → governed tables → app). Lead each
step with *"same answer, now with more."*

**One-line message:** *"You don't rip anything out on day one. You lift what you
already do onto the platform, and each step gives you something the spreadsheet
never could."*

**Audiences, in order:** practitioner (Step 1) → SA/engineer (Step 2) → exec / risk
owner (Step 3) → everyone (Step 4). **Total ≈ 12–15 min.** All data is synthetic
(fictional insurer Bricksurance SE).

---

## Expected numbers (memorise — so you spot an anomaly)
| Figure | Value |
|---|---|
| GL / Germany baseline indication (legacy annual-index) | **+6.6%** (0.0658) |
| GL / Germany with earning-aware (parallelogram) on-level | **+5.4%** (−1.1 pts — same losses, proper premium denominator) |
| GL / Germany after severity 5.5%→8% + large-loss 4%→6% | **≈ +15.4%** |
| Decomposition of that move | severity trend **≈ +8.0 pts**, large-loss **≈ +0.85 pts** (sums to the total) |
| Portfolio (all 15 segments) | GWP **≈ €605.7m**, portfolio indication **+1.51%** ⇒ **≈ €9.1m** of rate movement |
| Highest segment | **GL / France +7.3%**, then GL / Germany +6.6%, Property / Germany +6.5% |
| Recorded with every result | `calc_version 1.0.0`, an `experience_version` stamp, author, timestamp |

## Pre-flight (T-10 min) — do this before the room
1. **Warehouse warm:** run any quick query on the *Serverless Starter Warehouse*
   (`a3b61648ea4809e3`) so the first live query isn't a cold start.
2. **Data present:** confirm the book + baselines exist (should return 15):
   `SELECT count(*) FROM lr_dev_aws_us_catalog.rate_indications.indication_scenarios WHERE is_baseline;`
   If empty or you want a clean slate, run the build (≈2–3 min, do it now, not live):
   `databricks bundle run rate_indications_full_build -t dev -p DEV`
3. **App reset:** open the app → sidebar → **Reset demo** (clears any leftover
   scenarios back to the approved baselines).
4. **Tabs open, in this order** (so you never open the app first by accident):
   - the workbook `data/Indication_GL_DE_2027_v7_FINAL.xlsx` (from the repo) in Excel / Sheets
   - GitHub: https://github.com/wryszka/rate-indications-workbench (for the code walk)
   - Databricks **SQL editor** (for Step 3 queries), pointed at the serverless warehouse
   - the **Full Build job** run page (Jobs → search *"Rate Indications — Full Build"* → latest successful run)
   - the **Genie** room: https://fevm-lr-dev-aws-us.cloud.databricks.com/genie/rooms/01f1b74bccf71a3599d56e67452bb182
   - the **app**, already reset: https://rate-indications-workbench-7474656169654171.aws.databricksapps.com  (leave on the Portfolio page)
5. Skim **`DEMO_QA.md`** — that's where every "yes, but…" answer lives.

---

## Step 1 — "This is what you do today" (≈2 min)
- **GO:** the workbook, **Indication** tab.
- **DO:** point at the indicated **+6.6%** at the foot of the formula chain. Switch to
  the **Experience** tab (premium pasted in, LDFs and trend hand-keyed) and the
  **Assumptions** tab (yellow cells; hover the comment on Credibility — "we always use
  0.75 for GL"). Point at the filename `…_v7_FINAL` and, on the Indication tab,
  "Sign-off: (pending — see email thread)".
- **SAY:** "This is how a rate indication gets made today — one actuary, one workbook,
  a lot of copy-paste, sign-off in an inbox."
- **THE HOOK (ask, don't answer):** "Two questions to hold onto. Could you reproduce
  this exact number in two years? And who moved the trend assumption last quarter, and
  why?"
- **IF-ASKED (is this real data?):** synthetic and illustrative — the *method* and the
  *pain* are the point.

## Step 2 — "Lift it, unchanged, onto Databricks" (≈4 min)
*The point: you add nothing new yet — same data, same method, same answer — you just
move it in. Lowest-risk step there is.*
- **GO:** GitHub repo (or the workspace files), walked in dependency order.
- **DO:**
  1. `src/00_setup/00_setup.py` — the experience, the **loss triangle as a real table**
     (`indication_loss_triangle`), rate history. "The triangle is a table anyone can
     query, not a hidden tab."
  2. `src/app/indication_engine.py` — the loss-ratio method as plain code:
     on-level → develop → trend → load → credibility → permissible LR → indicated. Same
     steps as the spreadsheet.
  3. `scripts/test_engine.py` — "it's unit-tested, and the decomposition sums exactly."
  4. Switch to the **Full Build job** run page (pre-run in pre-flight — *don't* run it
     live; it takes 2–3 min). Show the task graph: setup → generate + seed baselines.
  5. Switch to the **SQL editor** and show it landed the same number:
     ```sql
     SELECT r.indicated_rate_change            -- 0.0658 = +6.6%
     FROM lr_dev_aws_us_catalog.rate_indications.indication_results r
     JOIN lr_dev_aws_us_catalog.rate_indications.indication_scenarios s USING (scenario_id)
     WHERE s.is_baseline AND s.lob_code='GENERAL_LIABILITY' AND s.territory_code='DE';
     ```
- **TIE-THROUGH:** put that **+6.6%** next to the spreadsheet's +6.6%.
- **SAY:** "Same method, moved onto the platform — nothing changed about the actuarial
  answer. But now it's code on governed data: no copy-paste, version-pinned,
  reproducible, and it runs for the whole book, not one tab at a time."
- **IF-ASKED (do we rewrite everything?):** "No — this *is* your method, lifted. That's
  the whole point of the step."

## Step 3 — "Now you get what the spreadsheet couldn't" (≈5 min)
*Still no app. Governance, a better method, and customisation come because it's on the
platform. Use the SQL editor + Genie (the earning-aware method is then shown live in the
app in Step 4, where the toggle lives).*
- **THE UPGRADE — earning-aware on-levelling (the headline of this step):**
  - SAY: "Your spreadsheet on-levels premium with a crude annual index. The platform can
    do it properly — the parallelogram method, from the actual rate-change dates."
  - DO: open `src/app/on_level.py` (the analytic earning-share method) and note the
    baseline stays the honest annual-index answer (**+6.6%**); the earning-aware method,
    which you'll flip on in the app next, gives **+5.4%** for GL/Germany.
  - SAY: "Same losses, same rates — the annual shortcut was over-stating the rate need by
    ignoring that a mid-year change only earns gradually. −1.1 points, defensibly."
- **DO — answer Step 1's two questions, live:**
  1. **Reproduce any number** (one row carries the whole basis):
     ```sql
     SELECT indicated_rate_change, calc_version, experience_version, calculated_by, calculation_timestamp
     FROM lr_dev_aws_us_catalog.rate_indications.indication_results r
     JOIN lr_dev_aws_us_catalog.rate_indications.indication_scenarios s USING (scenario_id)
     WHERE s.is_baseline AND s.lob_code='GENERAL_LIABILITY' AND s.territory_code='DE';
     ```
     "There's your reproducibility — the exact method version and data version behind the number."
  2. **Who changed what, when** (append-only audit — this is the governance record):
     ```sql
     SELECT log_ts, action, actor, from_status, to_status, note
     FROM lr_dev_aws_us_catalog.rate_indications.indication_audit_log
     ORDER BY log_ts DESC LIMIT 15;
     ```
     Point out an `APPROVE_DENIED` row if present: "the platform *blocked* an
     under-authorised approval and recorded it — governance, not decoration. You'll see
     that enforced live in a moment."
  3. **Assumptions are governed records, not cells:**
     ```sql
     SELECT assumption_name, assumption_value FROM lr_dev_aws_us_catalog.rate_indications.indication_assumptions
     WHERE scenario_id='baseline-GENERAL_LIABILITY-DE-2027' ORDER BY assumption_name;
     ```
- **DO — customisation (describe, don't flip live):** open `databricks.yml`, show the
  `book_flavour` variable (`eu_commercial`, with `us_retail` documented). "It's one
  variable and a rebuild — same method, a US book (Professional Liability / GL / BOP,
  US states). Config, not code." *(Do not toggle it in the room — it's a rebuild, not a
  switch.)*
- **DO — Ask the book (Genie):** in the Genie room, ask **"Which segments have the
  highest indicated rate change?"** → expect **GL / France (+7.3%)** top. Optionally:
  "show earned premium and projected loss ratio by product and territory."
- **SAY:** "The two questions we couldn't answer in Excel are now one query each — and
  the method is yours to configure without rebuilding anything."

## Step 4 — "…and finally, it's an app" (≈3 min)
*Short, and last. The app just packages Steps 2–3 for self-service.*
- **GO:** the app, **Portfolio** page.
- **DO:**
  1. Portfolio: ~€605.7m book, **+1.51%** overall — "≈ €9m of rate movement, some
     segments up, some down." Click **General Liability / Germany** (**+6.6%** — same
     number).
  0. **(the on-level upgrade, live)** In the On-level premium panel, switch the method from
     **Legacy annual-index → Earning-aware (parallelogram)**. The indication recalculates to
     **≈ +5.4%**, the raw vs on-level reported LR both show, and the decomposition leads with a
     **"Earning-aware on-level"** step (≈ −1.1 pts). SAY: "The proper method, one toggle — the
     spreadsheet couldn't do this." (Switch back to legacy for the rest, or keep it.)
  2. On Indications, raise **Severity trend** 5.5% → 8% and **Large-loss load** 4% → 6%;
     the indication recalculates live to **≈ +15.4%**. Point at the **decomposition**
     (severity ≈ +8 pts). Click **Explain** (Claude narrates it; note the live/cached
     "yellow button" in the sidebar).
  3. **Save as scenario** "Actuarial Recommended"; enter **Selected rate +8%** with a
     comment; **Submit**.
  4. Go to **Review**: try to **Approve as "Pricing Manager"** → it's **blocked**
     ("requires Pricing Committee") — the live governance gate. Approve as **Pricing
     Committee** → done. Open the **Audit trail** — every step, attributed.
- **SAY:** "For the actuary who just wants the job done: everything we built — the
  tables, the calc, the governance — is one screen, one click. Same number, same
  governance, self-service."
- **CLOSE:** "That's the journey — spreadsheet to governed platform capability, one step
  at a time, nothing lost on the way."

---

## Fallbacks — if something misbehaves
- **First query is slow / spins:** the warehouse went cold — you skipped pre-flight #1.
  Re-run; it's warm after the first hit.
- **Genie is slow or returns nothing:** rephrase once ("highest indicated rate change by
  segment"); if it stalls, fall back to the Step-3 SQL — same answer. Don't wait on it.
- **Explain is slow (live mode):** flip the sidebar toggle to **cached** — the
  deterministic narrative is instant. (Live vs cached is the "yellow button".)
- **A number looks off:** you're probably on stale data — re-run the Full Build
  (pre-flight #2) and **Reset demo**; the book is seeded, so the numbers above are exact.
- **Approval didn't block:** you approved as Pricing Committee (senior enough). Pick
  **Pricing Manager** to show the block.

## Q&A
Every "yes, but…" the room throws — credibility basis, long-tail discounting, on-level
detail, why +2.5pts of trend moves it ~8pts, approval enforcement, the business case —
is answered in **`DEMO_QA.md`** (persona-labelled, sourced from the live schema).
