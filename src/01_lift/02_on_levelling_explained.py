# Databricks notebook source
# MAGIC %md
# MAGIC # On-levelling, explained — the same method as the R script, on the platform
# MAGIC
# MAGIC **On-levelling** restates premium from past years to **today's price level**, so different years
# MAGIC can be compared fairly. Prices changed over time, so premium collected years ago was charged at
# MAGIC lower rates — the **on-level factor** scales it up to what it would be at today's rates.
# MAGIC
# MAGIC This notebook shows on-levelling on Databricks for **General Liability / Germany**, both ways:
# MAGIC the simple **annual-index** method (what a spreadsheet does) and the more accurate **earning-aware
# MAGIC (parallelogram)** method. It is the same calculation the R notebook performs — here it reconciles
# MAGIC on the platform. _Synthetic data, fictional insurer Bricksurance SE._

# COMMAND ----------
CATALOG, SCHEMA = "lr_dev_aws_us_catalog", "rate_indications"
LOB, TERR = "GENERAL_LIABILITY", "DE"
FQ = f"{CATALOG}.{SCHEMA}"
spark.sql(f"USE CATALOG {CATALOG}"); spark.sql(f"USE SCHEMA {SCHEMA}")

# COMMAND ----------
# MAGIC %md
# MAGIC ## 1) The rate history — what drives on-levelling
# MAGIC
# MAGIC Every taken rate change builds a cumulative **rate-level index**. On-levelling uses this index to
# MAGIC bring each past year up to today's level. This is a governed table (`rate_change_history`).

# COMMAND ----------
display(spark.sql(f"""
  SELECT effective_date, rate_change_pct, rate_level_index, status
  FROM {FQ}.rate_change_history
  WHERE lob_code = '{LOB}' AND territory_code = '{TERR}'
  ORDER BY effective_date
"""))

# COMMAND ----------
# MAGIC %md
# MAGIC ## 2) Method A — the annual index (what the spreadsheet does)
# MAGIC
# MAGIC The simple method: **on-level factor = today's rate level ÷ the rate level when that year was earned.**
# MAGIC Multiply each year's premium by its factor and you get **on-level premium** — the same premium, stated
# MAGIC in today's money. Here it is straight from the tables:

# COMMAND ----------
display(spark.sql(f"""
  SELECT e.accident_year,
         e.earned_premium,
         e.rate_level_index                                   AS rate_level_when_earned,
         s.current_rate_level                                 AS rate_level_today,
         round(s.current_rate_level / e.rate_level_index, 4)  AS on_level_factor,
         round(e.earned_premium * s.current_rate_level / e.rate_level_index, 0) AS on_level_premium
  FROM {FQ}.indication_experience e
  JOIN {FQ}.segment_rate_state s
    ON e.lob_code = s.lob_code AND e.territory_code = s.territory_code
  WHERE e.lob_code = '{LOB}' AND e.territory_code = '{TERR}'
  ORDER BY e.accident_year
"""))

# COMMAND ----------
# MAGIC %md
# MAGIC ## 3) Method B — earning-aware (the parallelogram)
# MAGIC
# MAGIC The annual index is a simplification: a rate change part-way through a year only **earns in
# MAGIC gradually** as policies renew, so the *average earned* rate level for a year is not the same as the
# MAGIC year-end index. The **parallelogram** method works out that average earned level properly. This is the
# MAGIC method `on_level.py` implements — and the one the R notebook reproduces. We call it here on the same data:

# COMMAND ----------
import sys
from datetime import date
sys.path.append("/Workspace/Shared/rate-indications-workbench")
import on_level

exp = spark.sql(f"""
  SELECT accident_year, earned_premium, reported_incurred
  FROM {FQ}.indication_experience
  WHERE lob_code = '{LOB}' AND territory_code = '{TERR}' ORDER BY accident_year
""").collect()
periods = [on_level.Period(r["accident_year"], date(r["accident_year"], 1, 1),
                           date(r["accident_year"] + 1, 1, 1), r["earned_premium"], r["reported_incurred"])
           for r in exp]

ev = spark.sql(f"""
  SELECT effective_date, rate_change_pct, event_id
  FROM {FQ}.rate_change_history
  WHERE lob_code = '{LOB}' AND territory_code = '{TERR}' AND status = 'implemented' AND effective_date IS NOT NULL
  ORDER BY effective_date
""").collect()
events = [on_level.RateEvent(effective_date=r["effective_date"], change=r["rate_change_pct"],
                             status="implemented", event_id=r["event_id"], date_source="observed") for r in ev]
hist = on_level.RateHistory(baseline_index=1.0, baseline_date=date(2018, 1, 1),
                            events=sorted(events, key=lambda e: e.effective_date), complete_from=date(2018, 1, 1))

ol = on_level.calculate_on_level(periods, hist, date(2026, 1, 1), 365, on_level.PARALLELOGRAM)
para = {row["key"]: row["on_level_factor"] for row in ol["periods"]}

import pandas as pd
legacy = {r["accident_year"]: (r["earned_premium"], r["reported_incurred"]) for r in exp}
cur = spark.sql(f"SELECT current_rate_level cur FROM {FQ}.segment_rate_state WHERE lob_code='{LOB}' AND territory_code='{TERR}'").first()["cur"]
rli = {r["accident_year"]: r["rate_level_index"] for r in spark.sql(f"SELECT accident_year, rate_level_index FROM {FQ}.indication_experience WHERE lob_code='{LOB}' AND territory_code='{TERR}'").collect()}
rows = [{"accident_year": y,
         "annual_index_factor": round(cur / rli[y], 4),
         "earning_aware_factor": round(para[y], 4),
         "earned_premium": round(legacy[y][0], 0)} for y in sorted(legacy)]
display(pd.DataFrame(rows))

# COMMAND ----------
# MAGIC %md
# MAGIC ## 4) Same losses, a fairer premium basis
# MAGIC
# MAGIC A mid-year rate change only **earns in gradually**, so the *average earned* rate level for a year sits
# MAGIC a little **below** the year-end index the annual method uses. That makes the earning-aware on-level
# MAGIC factor slightly **higher**, so the on-level premium is a touch higher overall (see the totals below) —
# MAGIC a larger, fairer premium denominator against the **same** claims, which means a **lower** required rate.
# MAGIC
# MAGIC In the **app**, switching the method from *Legacy annual-index* to *Earning-aware (parallelogram)*
# MAGIC moves the General Liability / Germany indication from **+6.6% to +5.4%** — about a point, defensibly.
# MAGIC The **R notebook** does exactly this calculation in R and reconciles to the platform at 0.00.

# COMMAND ----------
tot_ep = sum(legacy[y][0] for y in legacy)
tot_annual = sum(legacy[y][0] * (cur / rli[y]) for y in legacy)
tot_earning = sum(legacy[y][0] * para[y] for y in legacy)
print(f"Historic earned premium:            {tot_ep:,.0f}")
print(f"On-level premium (annual index):    {tot_annual:,.0f}")
print(f"On-level premium (earning-aware):   {tot_earning:,.0f}")
dbutils.notebook.exit(f"annual={tot_annual:,.0f}; earning_aware={tot_earning:,.0f}")
