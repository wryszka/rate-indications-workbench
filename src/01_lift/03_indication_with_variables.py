# Databricks notebook source
# MAGIC %md
# MAGIC # Step up: the same indication, now with dials — and every run recorded
# MAGIC
# MAGIC In the last notebook we redid the spreadsheet line by line and got **+6.6%**. That notebook
# MAGIC answered one question, once. This one is the **same calculation** with the key assumptions turned
# MAGIC into **input boxes at the top of the page** (Databricks calls them *widgets*). Change a box, press
# MAGIC **Run all**, get a new indication — a what-if, without building anything.
# MAGIC
# MAGIC And from this step on, **every run is written down**: who ran it, when, with which inputs, and what
# MAGIC it produced. In Excel you can see every cell; here you can also see every *run* — the control you
# MAGIC already have, plus a history you never had.
# MAGIC
# MAGIC _Synthetic data, fictional insurer Bricksurance SE._

# COMMAND ----------
# MAGIC %md
# MAGIC ## 1) The dials
# MAGIC
# MAGIC These appear as boxes at the top of the notebook. The defaults are the **approved** assumptions for
# MAGIC General Liability / Germany, so running it untouched reproduces **+6.6%**. Percentages are typed as
# MAGIC percentages (5.5 means 5.5%).

# COMMAND ----------
dbutils.widgets.text("product", "GENERAL_LIABILITY", "Product")
dbutils.widgets.text("territory", "DE", "Territory")
dbutils.widgets.text("severity_trend_pct", "5.5", "Severity trend (% / yr)")
dbutils.widgets.text("frequency_trend_pct", "-1.5", "Frequency trend (% / yr)")
dbutils.widgets.text("large_loss_load_pct", "5.0", "Large-loss load (%)")
dbutils.widgets.text("run_source", "notebook", "Run by (notebook / scheduled job)")

LOB = dbutils.widgets.get("product").strip()
TERR = dbutils.widgets.get("territory").strip()
SEV = float(dbutils.widgets.get("severity_trend_pct")) / 100
FREQ = float(dbutils.widgets.get("frequency_trend_pct")) / 100
LARGE = float(dbutils.widgets.get("large_loss_load_pct")) / 100
RUN_SOURCE = dbutils.widgets.get("run_source").strip()
PERIOD = 2027
print(f"Running {LOB} / {TERR} / {PERIOD}: severity {SEV:+.2%}, frequency {FREQ:+.2%}, large-loss load {LARGE:.2%}")

# COMMAND ----------
CATALOG, SCHEMA = "lr_dev_aws_us_catalog", "rate_indications"
FQ = f"{CATALOG}.{SCHEMA}"
spark.sql(f"USE CATALOG {CATALOG}"); spark.sql(f"USE SCHEMA {SCHEMA}")

# COMMAND ----------
# MAGIC %md
# MAGIC ## 2) Read the inputs and the approved assumptions (the same two layers as before)
# MAGIC
# MAGIC Everything we did *not* put on a dial (expenses, commission, credibility, development) stays at the
# MAGIC approved value — read straight from the governed Assumptions table.

# COMMAND ----------
import pandas as pd
exp_all = spark.sql(f"""
  SELECT accident_year, earned_premium, reported_incurred, rate_level_index, ldf_to_ultimate
  FROM {FQ}.indication_experience
  WHERE lob_code = '{LOB}' AND territory_code = '{TERR}' ORDER BY accident_year
""").toPandas()
A = {r["assumption_name"]: r["assumption_value"] for r in spark.sql(f"""
  SELECT a.assumption_name, a.assumption_value
  FROM {FQ}.indication_assumptions a JOIN {FQ}.indication_scenarios s ON a.scenario_id = s.scenario_id
  WHERE s.is_baseline AND s.lob_code = '{LOB}' AND s.territory_code = '{TERR}' AND s.indication_period = {PERIOD}
""").collect()}
CRL = spark.sql(f"SELECT current_rate_level FROM {FQ}.segment_rate_state "
                f"WHERE lob_code='{LOB}' AND territory_code='{TERR}'").first()["current_rate_level"]

# the dials override the approved values
A["severity_trend"], A["frequency_trend"], A["large_loss_load"] = SEV, FREQ, LARGE

# COMMAND ----------
# MAGIC %md
# MAGIC ## 3) The same formula chain as the spreadsheet
# MAGIC
# MAGIC Identical to the previous notebook — on-level, develop, trend, loads, permissible loss ratio,
# MAGIC indicated change — just in one cell, because you have already seen each step.

# COMMAND ----------
df = exp_all.tail(int(round(A["experience_period_years"]))).copy().reset_index(drop=True)
latest_ldf = df["ldf_to_ultimate"].iloc[-1]
df["on_level_premium"] = df["earned_premium"] * CRL / df["rate_level_index"]                                   # Excel col F
df["ultimate_loss"] = df["reported_incurred"] * (1 + (df["ldf_to_ultimate"] - 1) * (A["loss_development_factor"] / latest_ldf))  # G, H
df["trend_factor"] = ((1 + A["frequency_trend"]) * (1 + A["severity_trend"])) ** (PERIOD - df["accident_year"])  # J
df["trended_ultimate"] = df["ultimate_loss"] * df["trend_factor"]                                              # K

experience_lr = df["trended_ultimate"].sum() / df["on_level_premium"].sum()                                    # Indication B4
loaded_lr = experience_lr * (1 + A["large_loss_load"]) + A["cat_load"]                                          # B5
permissible_lr = 1 - (A["expense_ratio"] + A["commission_ratio"] + A["reinsurance_load"] + A["profit_provision"])  # B6
projected_lr = A["credibility"] * loaded_lr + (1 - A["credibility"]) * permissible_lr                           # B7
indicated = projected_lr / permissible_lr - 1                                                                  # B8
print(f"INDICATED RATE CHANGE: {indicated:+.2%}")

# COMMAND ----------
# MAGIC %md
# MAGIC ## 4) Every run is written down — automatically
# MAGIC
# MAGIC One row per run in `indication_notebook_runs`. The table is **append-only**: rows can be added,
# MAGIC never edited or deleted, so the history can't be quietly rewritten. Run it twice with different
# MAGIC dials and you'll see both runs below, side by side, with who ran them.

# COMMAND ----------
import json
spark.sql(f"""
  CREATE TABLE IF NOT EXISTS {FQ}.indication_notebook_runs (
    run_ts TIMESTAMP, run_by STRING, run_source STRING,
    lob_code STRING, territory_code STRING, indication_period INT,
    inputs_json STRING, indicated_rate_change DOUBLE
  ) TBLPROPERTIES ('delta.appendOnly' = 'true')
  COMMENT 'One row per run of the indication notebook or its scheduled job: who, when, inputs, result.'
""")
run_by = spark.sql("SELECT current_user() AS u").first()["u"]
inputs = {"severity_trend": SEV, "frequency_trend": FREQ, "large_loss_load": LARGE}
spark.sql(f"""
  INSERT INTO {FQ}.indication_notebook_runs
  SELECT current_timestamp(), :run_by, :src, :lob, :terr, :period, :inputs, :ind
""", {"run_by": run_by, "src": RUN_SOURCE, "lob": LOB, "terr": TERR, "period": PERIOD,
      "inputs": json.dumps(inputs), "ind": float(indicated)})

display(spark.sql(f"""
  SELECT run_ts, run_by, run_source, lob_code, territory_code,
         round(CAST(get_json_object(inputs_json, '$.severity_trend') AS DOUBLE) * 100, 2)  AS severity_trend_pct,
         round(CAST(get_json_object(inputs_json, '$.frequency_trend') AS DOUBLE) * 100, 2) AS frequency_trend_pct,
         round(CAST(get_json_object(inputs_json, '$.large_loss_load') AS DOUBLE) * 100, 2) AS large_loss_load_pct,
         round(indicated_rate_change * 100, 2) AS indicated_pct
  FROM {FQ}.indication_notebook_runs
  ORDER BY run_ts DESC LIMIT 10
"""))

# COMMAND ----------
# MAGIC %md
# MAGIC ## Where this goes next
# MAGIC
# MAGIC - **Next step — orchestrate it:** this exact notebook runs on a schedule as a Databricks *job*
# MAGIC   (first checking the numbers still tie back to the spreadsheet, then running). No one has to press
# MAGIC   Run; the runs still land in the same table above, marked "scheduled job".
# MAGIC - **Then — add more:** the same pattern for other assumption modules (on-levelling, loss trend), and
# MAGIC   plain-English questions over the results with Genie.
# MAGIC - **Finally — a screen in front of it:** the app is these same steps with buttons instead of boxes,
# MAGIC   plus review and approval. Nothing is rebuilt; it is the same calculation.

# COMMAND ----------
dbutils.notebook.exit(f"{indicated:.4f}")
