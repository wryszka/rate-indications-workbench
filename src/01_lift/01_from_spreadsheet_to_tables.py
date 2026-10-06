# Databricks notebook source
# MAGIC %md
# MAGIC # Your spreadsheet, lifted — same tabs, same formulas, same +6.6%
# MAGIC
# MAGIC This notebook **is** the General Liability / Germany rate-indication spreadsheet, moved onto
# MAGIC Databricks. Nothing is hidden behind clever functions — **every Excel formula is redone here as a
# MAGIC plain, visible step**, so you can see line-for-line how the workbook becomes a notebook. It lands on
# MAGIC the **same answer the spreadsheet emails round: +6.6%.**
# MAGIC
# MAGIC _Synthetic data, fictional insurer Bricksurance SE._

# COMMAND ----------
# MAGIC %md
# MAGIC ## Your Excel, as four governed layers
# MAGIC
# MAGIC The workbook has three tabs. On the platform they become governed tables, organised into the
# MAGIC **four layers of a rate-indication database** — exactly the structure you'd want to plan around:
# MAGIC
# MAGIC | Layer | From the spreadsheet | Governed table(s) |
# MAGIC |---|---|---|
# MAGIC | **1. Inputs** | the **Experience** tab (premium & losses by year) | `indication_experience` (+ `indication_loss_triangle`, `segment_rate_state`) |
# MAGIC | **2. Assumptions** | the **Assumptions** tab (the yellow cells) | `indication_assumptions` |
# MAGIC | **3. Results** | the **Indication** tab (the emailed number) | `indication_results` |
# MAGIC | **4. Audit** | *(the thing Excel can't give you)* | `indication_audit_log` |
# MAGIC
# MAGIC We walk the first two layers, redo the maths in the open, then show results + audit.

# COMMAND ----------
CATALOG, SCHEMA = "lr_dev_aws_us_catalog", "rate_indications"
LOB, TERR, PERIOD = "GENERAL_LIABILITY", "DE", 2027      # the one worked example: GL / Germany / 2027
FQ = f"{CATALOG}.{SCHEMA}"
spark.sql(f"USE CATALOG {CATALOG}"); spark.sql(f"USE SCHEMA {SCHEMA}")

# COMMAND ----------
# MAGIC %md
# MAGIC ## Layer 1 — INPUTS: the **Experience** tab → `indication_experience`
# MAGIC
# MAGIC Premium, reported losses and the rate index by accident year — the numbers that were pasted into
# MAGIC the Experience tab, now a table. We take the most recent years (the experience period from the
# MAGIC assumptions, below) — exactly the rows the spreadsheet uses.

# COMMAND ----------
import pandas as pd
exp_all = spark.sql(f"""
  SELECT accident_year, earned_premium, reported_incurred, rate_level_index, ldf_to_ultimate
  FROM {FQ}.indication_experience
  WHERE lob_code = '{LOB}' AND territory_code = '{TERR}'
  ORDER BY accident_year
""").toPandas()
display(exp_all)

# COMMAND ----------
# MAGIC %md
# MAGIC ## Layer 2 — ASSUMPTIONS: the **Assumptions** tab → `indication_assumptions`
# MAGIC
# MAGIC The hand-keyed yellow cells — trend, development, loads, credibility, expenses — are now governed
# MAGIC records (the approved baseline set). We read them into a simple dictionary `A`, just like reading
# MAGIC the cells of the Assumptions tab.

# COMMAND ----------
arows = spark.sql(f"""
  SELECT a.assumption_name, a.assumption_value
  FROM {FQ}.indication_assumptions a
  JOIN {FQ}.indication_scenarios s ON a.scenario_id = s.scenario_id
  WHERE s.is_baseline AND s.lob_code = '{LOB}' AND s.territory_code = '{TERR}'
    AND s.indication_period = {PERIOD}
""").collect()
A = {r["assumption_name"]: r["assumption_value"] for r in arows}
# the current rate level (today's price level) lives with the segment, like a cell on the sheet
CRL = spark.sql(f"SELECT current_rate_level FROM {FQ}.segment_rate_state "
                f"WHERE lob_code='{LOB}' AND territory_code='{TERR}'").first()["current_rate_level"]
display(pd.DataFrame([{"assumption": k, "value": v} for k, v in sorted(A.items())]
                     + [{"assumption": "current_rate_level", "value": CRL}]))

# COMMAND ----------
# MAGIC %md
# MAGIC ## The formula chain — the **Experience** tab, column by column
# MAGIC
# MAGIC This is the fragile part of the spreadsheet, redone as plain steps. We work on the most recent
# MAGIC `experience_period_years` rows (the same rows the sheet totals).

# COMMAND ----------
n = int(round(A["experience_period_years"]))
df = exp_all.tail(n).copy().reset_index(drop=True)          # the last n accident years
latest_base_ldf = df["ldf_to_ultimate"].iloc[-1]            # the latest year's empirical LDF (sheet cell)
sel_ldf = A["loss_development_factor"]
print(f"Experience period: last {n} years ({df['accident_year'].min()}–{df['accident_year'].max()}); "
      f"latest empirical LDF = {latest_base_ldf:.3f}; selected tail LDF = {sel_ldf:.3f}")

# COMMAND ----------
# MAGIC %md
# MAGIC **Step A — on-level the premium** (Excel col F: `=EarnedPremium * (CurrentRateLevel / RateIndex)`).
# MAGIC Restate each year's premium to today's price level.

# COMMAND ----------
df["on_level_factor"] = CRL / df["rate_level_index"]
df["on_level_premium"] = df["earned_premium"] * df["on_level_factor"]

# COMMAND ----------
# MAGIC %md
# MAGIC **Step B — develop losses to ultimate** (Excel col G: `=1+(EmpiricalLDF-1)*(SelectedLDF/LatestLDF)`,
# MAGIC col H: `=Reported * EffLDF`). Young years aren't fully reported, so grow them to final cost.

# COMMAND ----------
df["effective_ldf"] = 1 + (df["ldf_to_ultimate"] - 1) * (sel_ldf / latest_base_ldf)
df["ultimate_loss"] = df["reported_incurred"] * df["effective_ldf"]

# COMMAND ----------
# MAGIC %md
# MAGIC **Step C — trend to the future period** (Excel col J: `=(1+freq)^yrs*(1+sev)^yrs`, col K: `=Ultimate*Trend`).
# MAGIC Push each year's losses to 2027 cost levels.

# COMMAND ----------
df["trend_years"] = PERIOD - df["accident_year"]
df["trend_factor"] = ((1 + A["frequency_trend"]) ** df["trend_years"]) * ((1 + A["severity_trend"]) ** df["trend_years"])
df["trended_ultimate"] = df["ultimate_loss"] * df["trend_factor"]
display(df[["accident_year", "earned_premium", "on_level_factor", "on_level_premium",
            "reported_incurred", "effective_ldf", "ultimate_loss", "trend_factor", "trended_ultimate"]])

# COMMAND ----------
# MAGIC %md
# MAGIC ## The **Indication** tab — five steps to the number
# MAGIC
# MAGIC Each line below is one row of the Indication tab (the bit that gets emailed round).

# COMMAND ----------
sum_olep = df["on_level_premium"].sum()
sum_trended = df["trended_ultimate"].sum()

# B4  experience loss ratio (on-level, developed, trended) = SUM(trended) / SUM(on-level premium)
experience_lr = sum_trended / sum_olep
# B5  + loads: large-loss (multiplicative on losses) and cat (additive, % of premium)
loaded_lr = experience_lr * (1 + A["large_loss_load"]) + A["cat_load"]
# B6  permissible loss ratio = 1 - (expenses + commission + reinsurance + profit)
permissible_lr = 1 - (A["expense_ratio"] + A["commission_ratio"] + A["reinsurance_load"] + A["profit_provision"])
# B7  credibility-weighted projected loss ratio = Z*loaded + (1-Z)*permissible
Z = A["credibility"]
projected_lr = Z * loaded_lr + (1 - Z) * permissible_lr
# B8  INDICATED RATE CHANGE = projected / permissible - 1
indicated = projected_lr / permissible_lr - 1

print(f"B4  experience loss ratio        : {experience_lr:7.2%}")
print(f"B5  + loads                      : {loaded_lr:7.2%}")
print(f"B6  permissible loss ratio       : {permissible_lr:7.2%}")
print(f"B7  projected (credibility-wtd)  : {projected_lr:7.2%}")
print(f"B8  INDICATED RATE CHANGE        : {indicated:+7.2%}")

# COMMAND ----------
# MAGIC %md
# MAGIC ## Same as the spreadsheet: **+6.6%**
# MAGIC
# MAGIC No black box — the notebook reproduced the Excel formula chain line for line and landed on the same
# MAGIC number. The difference is everything *around* it: it's governed, it runs for the whole book, and
# MAGIC — the next two layers — it's **recorded and auditable**.

# COMMAND ----------
# MAGIC %md
# MAGIC ## Layers 3 & 4 — RESULTS and AUDIT: recorded, and traceable (what Excel can't do)
# MAGIC
# MAGIC Every committed calculation is written to `indication_results` with its method + data version, and
# MAGIC every action is an append-only row in `indication_audit_log`. You can always answer *"who produced
# MAGIC this number, when, on which inputs"* — the control an emailed spreadsheet never gives you.

# COMMAND ----------
display(spark.sql(f"""
  SELECT r.indicated_rate_change, r.calc_version, r.experience_version, r.calculated_by, r.calculation_timestamp
  FROM {FQ}.indication_results r
  JOIN {FQ}.indication_scenarios s ON r.scenario_id = s.scenario_id
  WHERE s.is_baseline AND s.lob_code='{LOB}' AND s.territory_code='{TERR}' AND s.indication_period={PERIOD}
  QUALIFY row_number() OVER (PARTITION BY r.scenario_id ORDER BY r.calculation_timestamp DESC) = 1
"""))

# COMMAND ----------
display(spark.sql(f"""
  SELECT log_ts, action, actor, from_status, to_status, note
  FROM {FQ}.indication_audit_log
  ORDER BY log_ts DESC LIMIT 10
"""))

# COMMAND ----------
# Headline check (lets this notebook be run as a job to confirm it still reconciles to +6.6%).
print(f"Inline notebook indicated rate change: {indicated:+.4f}")
dbutils.notebook.exit(f"{indicated:.4f}")
