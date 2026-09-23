# On-level premium: a presenter's guide

**Audience:** Databricks solution architects. No actuarial background required.
**Application:** Bricksurance Rate Indications Workbench.
**Status (2026-09-23):** the enhanced on-level workflow described here — dated rate-history
editing, earning-aware (parallelogram) factors and the explicit raw-versus-on-level comparison —
is **deployed** in the workbench. All data is synthetic (fictional insurer Bricksurance SE).

This is Use Case 2 of the workbench. Use Case 1 is the full **rate indication**; on-level premium
is the fair-comparison step that feeds it. They share one calculation engine — on-level premium is
the premium-denominator stage of the single indication — but they demo as two clear ideas.

## 1. What is this process for?

An insurer needs to answer: **"Based on our claims experience, do we need to increase or decrease
our prices?"** Before answering it must make a fair comparison. Historical premiums were charged at
historical prices; if prices have risen since, comparing historical claims with the old premium can
make today's prices look less adequate than they really are.

**On-levelling restates historical earned premium at a selected reference price level** — what
premium the same historical business would have earned at that level, under stated assumptions. It
does not change accounting records, bill customers or change live prices; it is an analytical
adjustment for the pricing actuary. The wider **rate indication** then combines this premium with
expected claims and expense assumptions to estimate the price change needed; the actuary can choose
a different commercial recommendation and record why.

## 2. Six terms you need

| Term | Plain-English meaning |
|---|---|
| Premium | The amount charged for insurance. |
| Earned premium | The part of the premium for cover already provided. A £1,200 annual policy earns ~£100/month if cover earns evenly. Payment timing does not determine earning. |
| Reported incurred claims | Claims paid so far plus the insurer's current estimate of amounts still to pay on claims already reported. May not be the final cost. |
| Loss ratio | Claims ÷ premium. 70% = £70 of claims per £100 of premium, before expenses and profit. |
| On-level factor | The multiplier that restates historical earned premium to the reference price level. |
| Indicated / selected rate change | **Indicated:** the model's estimate of the required price change. **Selected:** the change the actuary chooses to recommend. Neither automatically changes live prices. |

## 3. The easiest example to explain

A historical book with **£100m** earned premium, **£70m** reported claims, and a reference price
level **15% above** the level underlying that historical premium:

| Measure | Historical basis | At reference prices |
|---|---:|---:|
| Earned premium | £100m | £115m |
| Reported claims | £70m | £70m |
| Loss ratio | 70.0% | 60.9% |

**Say:** "The claims have not improved. We've changed the premium basis so we can assess the
experience against our reference prices." (This simple case assumes the entire historical premium
was at the earlier level; with rate changes during the year, the factor depends on when policies
started and how premium earned — the application calculates that timing effect. The default demo is
in euros; the pounds here are just an easy teaching example.)

## 4. Why effective dates and earning matter

If prices rise on 1 July, a policy that started in January keeps its agreed price until renewal; a
policy starting in July gets the new price. Both keep earning premium through the second half of the
year, so a July increase does **not** mean all premium earned after July reflects the new price. The
earning-aware method accounts for this gradual transition — its technical name is a
**parallelogram-style calculation**; you needn't explain the geometry: *"we account for the time it
takes a price change to work through the book"* is enough. The demo assumes steady policy starts and
even earning over a fixed term — transparent assumptions, not a claim that every real book behaves so.

## 5. What must be available before running it?

**Business inputs:** product & territory (GL / Germany in the demo); historical experience (earned
premium + reported claims per year, with exposure/claim counts/development for the wider indication);
rate-change history (implemented changes + effective dates, e.g. +5% on 1 Jan then +3% on 1 Jul);
starting rate level (index 1.00 = baseline); reference rate date; policy term & earning assumptions
(365-day policies, steady starts, even earning); and the indication assumptions (development, trend,
expense/profit/credibility). Inputs must share product, territory, currency and premium scope, and
the rate history must start early enough to cover policies still earning in the first experience
year. **Prepare these in advance** — the SA shouldn't assemble a rate history or invent a development
factor live.

**Application/data assets:** the deployed workbench + its SQL warehouse and tables
(`indication_experience`, `rate_change_history`, `segment_rate_state`, plus scenario/assumption/
result/audit tables); a seeded baseline scenario; permission to read inputs and save/calculate a
draft (review permission only if demonstrating approval); and the explanation-model endpoint if using
**Explain Indication** (AI explains, it does not do the arithmetic). No ML training, policy-level
rerating or live-pricing deployment is needed; synthetic data suffices.

## 6. What can the presenter change?

Start from the baseline and change **one thing at a time**.

**On-level step:** Product/territory (start GL/Germany); Method (annual-index simplification vs
earning-aware); Rate-change % (a historical what-if, not a new price instruction); Rate-change
effective date (move it, keep the reference date after it, watch the timing effect); Reference rate
date (usually leave fixed; it differs from the future period being priced); Policy term (usually
keep 365 days; it changes the assumed book, not customer contracts).

**Wider indication:** experience period, frequency/severity trend, selected development, large-loss &
catastrophe loads, credibility (a selected assumption, not an auto-estimated score), expense/
commission/reinsurance/profit provisions, and the selected rate change. For a short demo, change one
rate-history input and optionally severity trend; leave the rest at prepared values.

## 7. What outputs should you expect?

Historical and on-level earned premium; the on-level factor and premium uplift (can be negative after
decreases); raw and on-level reported loss ratios (same claims, different denominator); year-by-year
detail (earning-aware indices and factors); the projected loss ratio (the wider indication's result,
different from the simple reported-claims comparison); the indicated rate change; the explanation/
waterfall; and the saved scenario, result and audit trail (the enhancement adds the premium settings
needed for reproducibility). **A successful run isn't a particular increase — it's one where inputs,
adjustment, indication and saved evidence agree and can be explained.**

## 8. A simple three-minute demonstration

1. Open the prepared segment. "We're deciding whether prices for this group are adequate." Identify the years and baseline.
2. Show original premium and claims; point to the raw reported loss ratio.
3. Show the reference rate date and history; mention the earning assumption.
4. Show on-level premium and the paired loss ratio. "We restate premium so the comparison reflects those prices — the claims in these two ratios are identical."
5. Change one historical rate's effective date in a draft preview (reference date after the event). Show the updated factor, premium and indication; explain the actual result rather than promising a direction.
6. Connect to the wider indication. "The workbench then allows for how claims develop, future claim costs and expenses — an indicated change; an actuary still chooses the recommendation."
7. Save and calculate the scenario; show its saved result and input basis. Add selected rate/review only if time allows.

Rehearse the exact date change and note expected outputs. The earning-aware method may change the
old demo's headline indication (baseline stays +6.6% on the annual method; earning-aware ≈ +5.4%);
don't rely on a previously scripted percentage.

## 9. Common questions and simple answers

**"Why did the loss ratio improve when the claims stayed the same?"** The premium denominator
increased when restated at higher reference prices — an adjusted view of the same experience, not a
reduction in claims.

**"Is the rate increase the same as the on-level factor?"** No. The on-level factor adjusts
historical premium to a reference level; the indicated rate change estimates what further change is
needed from that level.

**"Why not just add up the historical percentage increases?"** Rate changes compound, and each year's
earned premium mixes policy start dates and rates. The calculation accounts for both.

**"Is AI deciding the price?"** No. The calculation is deterministic arithmetic; the AI assistant can
explain results. An actuary selects the recommended change, and this analysis does not deploy it.

**"What does Databricks contribute?"** It hosts the application and the data. The demo shows source
experience, explicit assumptions, a repeatable calculation and recorded results/audit evidence. The
arithmetic is ordinary Python in the current app — it is not claimed to run in a governed UC function
or job (that remains a separate potential enhancement).

**"Can we use this on a real book?"** The approach is relevant, but the inputs and assumptions must
fit that book. The demo uses synthetic data and a simple earning pattern; more complex books may need
different earning assumptions or policy-level rerating.

## Presenter's final check

Confirm the feature version, chosen segment, currency, baseline, one rehearsed input change and its
expected outputs, and that saving works. If history is incomplete, explain the missing input; don't
fill in an arbitrary rate or switch methods without telling the audience.

**The one sentence to remember:** *"We put historical premium onto a consistent price basis, then use
that experience to assess whether a further price change is needed."*
