# Demo — "Getting a rate indication into Databricks" (the journey)

This is **not an app demo**. It's a demo of a *process*: how a real actuarial
workflow moves onto Databricks, one small, low-risk step at a time. You start
exactly where the customer lives today (a spreadsheet) and take four steps. The
app is the **last** step — the packaging of everything already built — not the
opening.

**The spine:** the *same* number — **General Liability / Germany, +6.6%** —
reappears at every step. The spreadsheet, the notebook, the governed tables and
the app all land on +6.6%. That's what earns trust in each move: "look, nothing
was lost — it's the same answer, now with more."

**The message, one line:** *"You don't rip anything out on day one. You lift what
you already do onto the platform, and each step gives you something the
spreadsheet never could."*

Three audiences, in order: the practitioner recognises Step 1; the SA/engineer
owns Step 2; the exec/risk owner cares about Step 3; everyone wants Step 4.

Total ≈ 12–15 min. Keep Steps 1–3 as the story; Step 4 is a short "and here's
where it ends up."

---

## Step 1 — "This is what you do today" (≈2 min)

**Where:** open `data/Indication_GL_DE_2027_v7_FINAL.xlsx` (the workbook), on the
**Indication** tab.
**Show:** the indicated **+6.6%** at the bottom of a formula chain; then the
**Experience** tab (premium pasted from source, LDFs and trend hand-keyed) and the
**Assumptions** tab (yellow cells, a comment reading "we always use 0.75 for GL").
Point at the filename (`_v7_FINAL`) and the "sign-off: pending — see email thread".
**Say:** "This is how a rate indication gets made today — one actuary, one
workbook, a lot of copy-paste, sign-off in an inbox."
**The hook (don't answer yet):** "Two questions. Can you reproduce this exact
number in two years? And who moved the trend assumption last quarter, and why?"
**Why it matters:** everyone nods. This is real. It sets up every gain that follows.

## Step 2 — "Lift it, unchanged, onto Databricks" (≈4 min)

The point of this step: **you add nothing new yet** — same data, same method, same
answer — you just move it in. Lowest-risk step there is.

**Where:** the repo, walked in dependency order (this is the build track a customer
could lift into their own workspace).
**Show:**
- `src/00_setup/00_setup.py` — the experience, the **loss triangle as a real table**
  (not a hidden tab), rate history. "The triangle is now something anyone can query."
- `src/app/indication_engine.py` — the loss-ratio method as plain, readable code:
  on-level → develop → trend → load → credibility → permissible LR → indicated. Same
  steps as the spreadsheet, now transparent and testable.
- `scripts/test_engine.py` — it's **unit-tested**, and the decomposition sums exactly.
- Run the **Full Build job** (`resources/build.yml`) → it reproduces **+6.6%** for
  GL/DE, and seeds the same for the whole book.
**Say:** "Same method. We've moved it onto the platform and changed nothing about
the actuarial answer — but now it's code on governed data: no copy-paste, version-
pinned, reproducible, and it runs for the whole book, not one tab at a time."
**Tie-through:** put the notebook's +6.6% next to the spreadsheet's +6.6%.
**If-asked (do we rewrite everything?):** "No — this *is* your method, lifted. That's
the whole point of the step."

## Step 3 — "Now you get what the spreadsheet couldn't give you" (≈4 min)

Because it's on the platform, governance and customisation come almost for free.

**Show (as tables/records, not the app yet):**
- **Assumptions are versioned governed records** (`indication_assumptions`), not
  cells — every value, who set it, when.
- **Every calculation is recorded** (`indication_results`, with `calc_version` +
  `experience_version`) and **every action is an append-only audit event**
  (`indication_audit_log`). *Now* answer Step 1's questions: reproduce the number →
  one row; who changed the trend → one audit query.
- **Approvals are enforced** — routed by the size of the change; a junior sign-off on
  a big move is *rejected*, and the block is audited. (Governance, not decoration.)
- **Customisation:** flip `book_flavour` from European commercial to **US Retail**
  (Professional Liability / GL / BOP, US states) — same method, different book, no
  rewrite. Retune assumption sets or approval thresholds as config.
- **Ask the book** in Genie ("which segments need the biggest increase?") — governed
  natural-language access over the same tables.
**Say:** "The two questions we couldn't answer in Excel are now one query each. And
the method is yours to configure — a different book, different thresholds — without
rebuilding anything."

## Step 4 — "…and finally, it's an app" (≈2–3 min)

Short and last. The app is just the self-service packaging of Steps 2–3.

**Where:** the deployed Rate Indications Workbench.
**Show, quickly:** Portfolio → GL/DE **+6.6%** → nudge severity trend → live recalc to
~+15% → decomposition → Claude "Explain" → save scenario → selected-vs-indicated +
comment → role-gated approve → audit trail.
**Say:** "For the actuary who just wants to do the job: everything you watched us
build — the tables, the calc, the governance — is now one screen, one click. Same
number, same governance, self-service."
**Close:** "That's the journey — spreadsheet to governed platform capability, one
step at a time, and nothing lost on the way."

---

## Presenter notes
- **The spine is the demo.** If you show only one thing per step, show the +6.6%
  reproduced. Lead every step with "same answer, now with…".
- **Don't open the app first.** It's the destination; opening there skips the story
  and the room won't know how you got there.
- Reset the app to pristine before you start (sidebar → Reset demo).
- The workbook is synthetic and self-contained; keep it open in a separate window so
  Step 1 → Step 2 is a glance, not a reload.
- Deeper "yes, but…" answers (credibility basis, long-tail discounting, on-level
  detail, approval enforcement) live in `DEMO_QA.md`.
