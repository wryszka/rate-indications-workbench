# Databricks notebook source
# MAGIC %md
# MAGIC # 01 · Generate the synthetic book + seed the audited baseline
# MAGIC
# MAGIC Deterministic (seeded) synthetic P&C book for the chosen `book_flavour`
# MAGIC (default European commercial). Writes reference, experience, loss triangle,
# MAGIC rate history and rate state, then — for every segment — creates an
# MAGIC **Approved Baseline** scenario, runs the deterministic engine and **records**
# MAGIC `indication_results` + append-only `indication_audit_log`. Nothing is computed
# MAGIC without being recorded.
# MAGIC
# MAGIC Idempotent: fully rebuilds the book and baselines each run.

# COMMAND ----------
import sys, json, uuid
from datetime import datetime, timezone

dbutils.widgets.text("catalog", "lr_dev_aws_us_catalog")
dbutils.widgets.text("schema", "rate_indications")
dbutils.widgets.text("book_flavour", "eu_commercial")
dbutils.widgets.text("prospective_period", "2027")
CATALOG = dbutils.widgets.get("catalog")
SCHEMA = dbutils.widgets.get("schema")
FLAVOUR = dbutils.widgets.get("book_flavour")
PROSPECTIVE = int(dbutils.widgets.get("prospective_period"))
FQ = f"`{CATALOG}`.`{SCHEMA}`"

# --- import the shared engine + generator from the synced bundle files ---------
ctx = dbutils.notebook.entry_point.getDbutils().notebook().getContext()
nb_path = ctx.notebookPath().get()                    # .../files/src/01_data/01_generate_book
files_root = nb_path.split("/src/")[0]                # .../files
if not files_root.startswith("/Workspace"):
    files_root = "/Workspace" + files_root            # workspace-files import needs the FUSE prefix
for p in (f"{files_root}/src/app", f"{files_root}/src/common"):
    if p not in sys.path:
        sys.path.insert(0, p)
from indication_engine import ExperienceYear, calc_segment, CALC_VERSION, ASSUMPTION_META  # noqa
from gen_book import generate, baseline_assumptions, BOOKS  # noqa

USER = ctx.userName().get() if ctx.userName().isDefined() else "build"
NOW = datetime.now(timezone.utc)
VERSION = NOW.strftime("v%Y%m%d%H%M")
print(f"Flavour={FLAVOUR}  version={VERSION}  prospective={PROSPECTIVE}  calc={CALC_VERSION}")

# COMMAND ----------
# ---- Generate + write the book ----
book = generate(FLAVOUR, VERSION)

def write(rows, table, mode="overwrite"):
    if not rows:
        return
    tgt = f"{CATALOG}.{SCHEMA}.{table}"
    # Build against the DDL schema (created in 00_setup) so nullable/all-None
    # columns type correctly on serverless Spark Connect.
    schema = spark.table(tgt).schema
    spark.createDataFrame(rows, schema=schema).write.mode(mode).saveAsTable(tgt)

write(book["ref_lob"], "line_of_business")
write(book["ref_terr"], "territory")
write(book["experience"], "indication_experience")
write(book["triangle"], "indication_loss_triangle")
write(book["rate_hist"], "rate_change_history")
write(book["rate_state"], "segment_rate_state")

# approval routing by absolute indicated change
write([
    {"min_abs_change": 0.0,  "max_abs_change": 0.05, "approver_role": "Pricing Manager", "note": "routine change"},
    {"min_abs_change": 0.05, "max_abs_change": 0.10, "approver_role": "Chief Pricing Actuary", "note": "material change"},
    {"min_abs_change": 0.10, "max_abs_change": 99.0, "approver_role": "Pricing Committee", "note": "large change — committee sign-off"},
], "approval_role")
print(f"Book written: {len(book['experience'])} experience rows, {len(book['triangle'])} triangle cells.")

# COMMAND ----------
# ---- Seed the audited baseline (every baseline is a recorded, approved calculation) ----
exp_by_seg, lob_meta = {}, {l[0]: l for l in BOOKS[FLAVOUR]["lobs"]}
for e in book["experience"]:
    exp_by_seg.setdefault((e["lob_code"], e["territory_code"]), []).append(e)
rate_state = {(r["lob_code"], r["territory_code"]): r for r in book["rate_state"]}

scenarios, assumptions, results, audit = [], [], [], []
for (lob, terr), rows in exp_by_seg.items():
    code, label, tail, base_lr, sev, freq = lob_meta[lob]
    a = baseline_assumptions(tail, sev, freq)
    ey = [ExperienceYear(accident_year=r["accident_year"], earned_premium=r["earned_premium"],
                         reported_incurred=r["reported_incurred"], claim_count=r["claim_count"],
                         exposure=r["exposure"], rate_level_index=r["rate_level_index"],
                         ldf_to_ultimate=r["ldf_to_ultimate"]) for r in rows]
    res = calc_segment(ey, rate_state[(lob, terr)]["current_rate_level"], PROSPECTIVE, a)
    sid = f"baseline-{lob}-{terr}-{PROSPECTIVE}"
    rid = str(uuid.uuid4())
    scenarios.append(dict(scenario_id=sid, scenario_name="Approved Baseline", lob_code=lob,
                          territory_code=terr, indication_period=PROSPECTIVE, status="APPROVED",
                          is_baseline=True, owner=USER, reviewer=USER, created_by=USER,
                          created_at=NOW, updated_at=NOW, submitted_at=NOW, reviewed_at=NOW,
                          approved_at=NOW, selected_rate_change=round(res.indicated_rate_change, 6),
                          selection_comment="Baseline seeded at build.", comments="Approved baseline basis.",
                          cloned_from=None, experience_version=VERSION))
    for name, val in a.items():
        assumptions.append(dict(scenario_id=sid, assumption_name=name, assumption_value=float(val),
                                baseline_value=float(val), unit=ASSUMPTION_META.get(name, {}).get("unit", ""),
                                updated_by=USER, updated_at=NOW))
    results.append(dict(result_id=rid, scenario_id=sid, calc_version=CALC_VERSION, experience_version=VERSION,
                        indicated_rate_change=round(res.indicated_rate_change, 6),
                        selected_rate_change=round(res.indicated_rate_change, 6),
                        projected_loss_ratio=round(res.projected_loss_ratio, 6),
                        permissible_loss_ratio=round(res.permissible_loss_ratio, 6),
                        experience_loss_ratio=round(res.experience_loss_ratio, 6),
                        required_premium=round(res.required_premium, 2),
                        on_level_earned_premium=round(res.on_level_earned_premium, 2),
                        projected_ultimate_loss=round(res.projected_ultimate_loss, 2),
                        decomposition_json="[]", detail_json=json.dumps(res.detail_years),
                        calculated_by=USER, calculation_timestamp=NOW))
    for act, frm, to in [("CREATE", None, "DRAFT"), ("CALCULATE", "DRAFT", "DRAFT"),
                          ("APPROVE", "DRAFT", "APPROVED")]:
        audit.append(dict(event_id=str(uuid.uuid4()), log_ts=NOW, scenario_id=sid, action=act,
                          actor=USER, from_status=frm, to_status=to, calc_version=CALC_VERSION,
                          result_id=rid if act == "CALCULATE" else None,
                          note="baseline seeded", details=None))

write(scenarios, "indication_scenarios")
write(assumptions, "indication_assumptions")
write(results, "indication_results")
write(audit, "indication_audit_log", mode="append")
print(f"Seeded {len(scenarios)} approved baseline scenarios, {len(results)} recorded results, {len(audit)} audit events.")

# COMMAND ----------
display(spark.sql(f"""
  SELECT s.lob_code, s.territory_code, r.indicated_rate_change, r.projected_loss_ratio
  FROM {FQ}.indication_scenarios s JOIN {FQ}.indication_results r USING (scenario_id)
  WHERE s.is_baseline ORDER BY s.lob_code, s.territory_code"""))
