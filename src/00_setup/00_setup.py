# Databricks notebook source
# MAGIC %md
# MAGIC # 00 · Setup — schema, data model and governance tables
# MAGIC
# MAGIC Idempotent. Creates the single `rate_indications` schema and every table it
# MAGIC holds. Table families:
# MAGIC - **reference** — `line_of_business`, `territory`
# MAGIC - **experience** (ACORD-shaped, mirrors the data-core / reserving loss triangle) —
# MAGIC   `indication_experience`, `indication_loss_triangle`, `rate_change_history`,
# MAGIC   `segment_rate_state`
# MAGIC - **governance** — `indication_scenarios`, `indication_assumptions`,
# MAGIC   `indication_results`, `indication_audit_log` (append-only), `approval_role`
# MAGIC
# MAGIC Every committed calculation writes a row to `indication_results` and an event to
# MAGIC the append-only `indication_audit_log`, so any number on screen is reproducible
# MAGIC (assumption vector + `calc_version` + `experience_version`, attributed + timestamped).

# COMMAND ----------
dbutils.widgets.text("catalog", "lr_dev_aws_us_catalog")
dbutils.widgets.text("schema", "rate_indications")
CATALOG = dbutils.widgets.get("catalog")
SCHEMA = dbutils.widgets.get("schema")
FQ = f"`{CATALOG}`.`{SCHEMA}`"
print(f"Target: {FQ}")

# COMMAND ----------
spark.sql(f"CREATE SCHEMA IF NOT EXISTS {FQ} COMMENT 'Bricksurance Rate Indications workbench — synthetic P&C rate-indication demo.'")

# COMMAND ----------
# ---- Reference ----
spark.sql(f"""CREATE TABLE IF NOT EXISTS {FQ}.line_of_business (
  lob_code STRING, lob_label STRING, tail STRING, display_order INT
) COMMENT 'Lines of business in the book (product dimension).'""")

spark.sql(f"""CREATE TABLE IF NOT EXISTS {FQ}.territory (
  territory_code STRING, territory_label STRING, region STRING, currency STRING, display_order INT
) COMMENT 'Territories / states in the book (geography dimension).'""")

# COMMAND ----------
# ---- Experience (business-ready; grain = LOB x territory x accident year) ----
spark.sql(f"""CREATE TABLE IF NOT EXISTS {FQ}.indication_experience (
  experience_version STRING,
  lob_code STRING, territory_code STRING, accident_year INT,
  earned_premium DOUBLE, written_premium DOUBLE, exposure DOUBLE,
  claim_count INT, reported_incurred DOUBLE, paid_to_date DOUBLE,
  rate_level_index DOUBLE, ldf_to_ultimate DOUBLE
) COMMENT 'Earned premium, exposure and reported losses by segment and accident year — the input to the loss-ratio indication.'""")

# The loss triangle behind ldf_to_ultimate — same shape as reserving.loss_development
spark.sql(f"""CREATE TABLE IF NOT EXISTS {FQ}.indication_loss_triangle (
  experience_version STRING,
  lob_code STRING, territory_code STRING, accident_year INT, dev_lag_months INT,
  cumulative_incurred DOUBLE, cumulative_paid DOUBLE
) COMMENT 'Cumulative incurred/paid loss development triangle underlying the selected development factors.'""")

spark.sql(f"""CREATE TABLE IF NOT EXISTS {FQ}.rate_change_history (
  lob_code STRING, territory_code STRING, effective_year INT,
  rate_change_pct DOUBLE, rate_level_index DOUBLE, note STRING
) COMMENT 'History of taken rate changes; the cumulative index on-levels historic premium to today.'""")

spark.sql(f"""CREATE TABLE IF NOT EXISTS {FQ}.segment_rate_state (
  lob_code STRING, territory_code STRING,
  current_rate_level DOUBLE, last_rate_change_pct DOUBLE, last_effective_year INT
) COMMENT 'Current in-force rate level per segment (latest cumulative index).'""")

# COMMAND ----------
# ---- Governance: scenarios, assumptions, results, audit ----
spark.sql(f"""CREATE TABLE IF NOT EXISTS {FQ}.indication_scenarios (
  scenario_id STRING, scenario_name STRING,
  lob_code STRING, territory_code STRING, indication_period INT,
  status STRING, is_baseline BOOLEAN,
  owner STRING, reviewer STRING, created_by STRING,
  created_at TIMESTAMP, updated_at TIMESTAMP,
  submitted_at TIMESTAMP, reviewed_at TIMESTAMP, approved_at TIMESTAMP,
  selected_rate_change DOUBLE, selection_comment STRING, comments STRING,
  cloned_from STRING, experience_version STRING
) COMMENT 'One rate-indication scenario = a named assumption set + workflow state, scoped to a product x territory x period.'""")

spark.sql(f"""CREATE TABLE IF NOT EXISTS {FQ}.indication_assumptions (
  scenario_id STRING, assumption_name STRING,
  assumption_value DOUBLE, baseline_value DOUBLE, unit STRING,
  updated_by STRING, updated_at TIMESTAMP
) COMMENT 'The editable assumption vector for each scenario (long format so books can add/remove assumptions).'""")

spark.sql(f"""CREATE TABLE IF NOT EXISTS {FQ}.indication_results (
  result_id STRING, scenario_id STRING,
  calc_version STRING, experience_version STRING,
  indicated_rate_change DOUBLE, selected_rate_change DOUBLE,
  projected_loss_ratio DOUBLE, permissible_loss_ratio DOUBLE, experience_loss_ratio DOUBLE,
  required_premium DOUBLE, on_level_earned_premium DOUBLE, projected_ultimate_loss DOUBLE,
  decomposition_json STRING, detail_json STRING,
  calculated_by STRING, calculation_timestamp TIMESTAMP
) COMMENT 'Immutable record of every committed calculation — reproducible from assumptions + calc_version + experience_version.'""")

# Append-only audit trail — enforced at the table level.
spark.sql(f"""CREATE TABLE IF NOT EXISTS {FQ}.indication_audit_log (
  event_id STRING, log_ts TIMESTAMP, scenario_id STRING,
  action STRING, actor STRING, from_status STRING, to_status STRING,
  calc_version STRING, result_id STRING, note STRING, details STRING
) TBLPROPERTIES (delta.appendOnly = true)
COMMENT 'Append-only journal of every action (create/edit/calculate/submit/review/approve/select-rate).'""")

spark.sql(f"""CREATE TABLE IF NOT EXISTS {FQ}.approval_role (
  min_abs_change DOUBLE, max_abs_change DOUBLE, approver_role STRING, note STRING
) COMMENT 'Magnitude-routed approval: which role must sign off an indicated change of a given size.'""")

# COMMAND ----------
# ---- On-level premium migration (additive, idempotent — never drops or rewrites rows) ----
# Adds nullable columns for dated/earning-aware on-levelling. Existing saved
# scenarios and results are preserved; old rows read as NULL (legacy) and stay valid.
_migrations = {
    "indication_experience": [
        ("loss_valuation_date", "DATE"), ("premium_basis", "STRING"), ("loss_basis", "STRING"),
    ],
    "rate_change_history": [
        ("rate_history_version", "STRING"), ("event_id", "STRING"), ("effective_date", "DATE"),
        ("status", "STRING"), ("date_source", "STRING"),
    ],
    "segment_rate_state": [
        ("rate_history_version", "STRING"), ("baseline_effective_date", "DATE"),
        ("baseline_rate_index", "DOUBLE"), ("history_complete_from", "DATE"),
        ("reference_rate_date", "DATE"), ("policy_term_days", "INT"), ("on_level_method", "STRING"),
    ],
    "indication_scenarios": [
        ("premium_settings_json", "STRING"), ("last_calculated_input_hash", "STRING"),
    ],
    "indication_results": [
        ("input_snapshot_json", "STRING"), ("input_hash", "STRING"),
        ("rate_history_version", "STRING"), ("premium_summary_json", "STRING"),
    ],
}
for tbl, cols in _migrations.items():
    existing = {f.name for f in spark.table(f"{CATALOG}.{SCHEMA}.{tbl}").schema.fields}
    missing = [(c, t) for c, t in cols if c not in existing]
    if missing:
        add = ", ".join(f"{c} {t}" for c, t in missing)
        spark.sql(f"ALTER TABLE {FQ}.{tbl} ADD COLUMNS ({add})")
        print(f"  {tbl}: added {[c for c, _ in missing]}")
print("On-level migration applied (additive).")

# COMMAND ----------
# ---- Governed UC functions: the agent tool/compute surface (Databricks-native, lineage-tracked) ----
# A deterministic calc primitive + read tools over the recorded results and governance evidence.
# The Mosaic AI Agent-Framework agent calls these as tools (MCP-first), so computation and the
# tool surface are UC objects, not app code.
spark.sql(f"""CREATE OR REPLACE FUNCTION {FQ}.fn_permissible_loss_ratio(
  expense_ratio DOUBLE, commission_ratio DOUBLE, reinsurance_load DOUBLE, profit_provision DOUBLE)
  RETURNS DOUBLE
  COMMENT 'Break-even (permissible) loss ratio = 1 - (expense+commission+reinsurance+profit). Deterministic calc primitive.'
  RETURN 1.0 - (expense_ratio + commission_ratio + reinsurance_load + profit_provision)""")

spark.sql(f"""CREATE OR REPLACE FUNCTION {FQ}.fn_segment_indication(p_lob STRING, p_territory STRING, p_period INT)
  RETURNS TABLE(lob_code STRING, territory_code STRING, scenario_name STRING, status STRING, is_baseline BOOLEAN,
                indicated_rate_change DOUBLE, projected_loss_ratio DOUBLE, on_level_reported_lr DOUBLE,
                on_level_method STRING, calc_version STRING, experience_version STRING)
  COMMENT 'Latest recorded indication + premium basis for a product/territory/period. Agent read tool over governed results.'
  RETURN SELECT s.lob_code, s.territory_code, s.scenario_name, s.status, s.is_baseline,
                r.indicated_rate_change, r.projected_loss_ratio,
                r.premium_summary_json:on_level_reported_loss_ratio::double, r.premium_summary_json:method::string,
                r.calc_version, r.experience_version
         FROM {FQ}.indication_scenarios s
         JOIN (SELECT *, row_number() OVER (PARTITION BY scenario_id ORDER BY calculation_timestamp DESC) rn
               FROM {FQ}.indication_results) r ON r.scenario_id=s.scenario_id AND r.rn=1
         WHERE s.lob_code=p_lob AND s.territory_code=p_territory AND s.indication_period=p_period""")

spark.sql(f"""CREATE OR REPLACE FUNCTION {FQ}.fn_governance_evidence()
  RETURNS TABLE(total_audit_events BIGINT, blocked_approvals BIGINT, results_total BIGINT,
                results_with_snapshot BIGINT, calc_versions STRING, approved_baselines BIGINT)
  COMMENT 'Live governance evidence for oversight questions (attribution, authorisation, reproducibility).'
  RETURN SELECT (SELECT count(*) FROM {FQ}.indication_audit_log),
                (SELECT count(*) FROM {FQ}.indication_audit_log WHERE action='APPROVE_DENIED'),
                (SELECT count(*) FROM {FQ}.indication_results),
                (SELECT count(input_hash) FROM {FQ}.indication_results),
                (SELECT concat_ws(',', array_agg(DISTINCT calc_version)) FROM {FQ}.indication_results),
                (SELECT count(*) FROM {FQ}.indication_scenarios WHERE is_baseline AND status='APPROVED')""")
print("Governed UC functions created (agent tool surface).")

# COMMAND ----------
print("Setup complete. Tables:")
display(spark.sql(f"SHOW TABLES IN {FQ}"))
