# Data dictionary — schema `rate_indications`

Single schema, portable `${var.catalog}` (default `lr_dev_aws_us_catalog`). All data
synthetic. Grain and key columns below.

## Reference
- **line_of_business** — product dimension. `lob_code, lob_label, tail (short/medium/long), display_order`.
- **territory** — geography dimension. `territory_code, territory_label, region, currency, display_order`.

## Experience (business-ready; ACORD-shaped)
- **indication_experience** — grain: LOB × territory × accident_year. `experience_version,
  lob_code, territory_code, accident_year, earned_premium, written_premium, exposure,
  claim_count, reported_incurred, paid_to_date, rate_level_index, ldf_to_ultimate`. The
  input to the indication.
- **indication_loss_triangle** — grain: LOB × territory × accident_year × dev_lag_months.
  `cumulative_incurred, cumulative_paid`. Backs the development factors (mirrors
  `reserving_workbench.loss_development`).
- **rate_change_history** — grain: LOB × territory × effective_year. `rate_change_pct,
  rate_level_index, note`. Cumulative index on-levels historic premium to today.
- **segment_rate_state** — grain: LOB × territory. `current_rate_level,
  last_rate_change_pct, last_effective_year`.

## Governance
- **indication_scenarios** — one scenario = named assumption set + workflow state, scoped
  to product × territory × period. `scenario_id, scenario_name, lob_code, territory_code,
  indication_period, status (DRAFT/SUBMITTED/REVIEWED/APPROVED/REJECTED), is_baseline,
  owner, reviewer, created_by, created_at, updated_at, submitted_at, reviewed_at,
  approved_at, selected_rate_change, selection_comment, comments, cloned_from,
  experience_version`.
- **indication_assumptions** — grain: scenario × assumption_name (long format).
  `assumption_value, baseline_value, unit, updated_by, updated_at`. The 11 assumptions:
  severity_trend, frequency_trend, loss_development_factor, large_loss_load, cat_load,
  credibility, experience_period_years, expense_ratio, commission_ratio, reinsurance_load,
  profit_provision.
- **indication_results** — immutable record of every committed calculation. `result_id,
  scenario_id, calc_version, experience_version, indicated_rate_change,
  selected_rate_change, projected_loss_ratio, permissible_loss_ratio,
  experience_loss_ratio, required_premium, on_level_earned_premium, projected_ultimate_loss,
  decomposition_json, detail_json, calculated_by, calculation_timestamp`.
- **indication_audit_log** — append-only (`delta.appendOnly=true`). `event_id, log_ts,
  scenario_id, action (CREATE/EDIT/CALCULATE/SELECT_RATE/SUBMIT/REVIEW/APPROVE/REJECT),
  actor, from_status, to_status, calc_version, result_id, note, details`.
- **approval_role** — magnitude-routed sign-off. `min_abs_change, max_abs_change,
  approver_role, note`.

## On-level earned premium (added 2026-09-23, all nullable — additive migration)
- **indication_experience** +`loss_valuation_date DATE`, `premium_basis STRING`,
  `loss_basis STRING` (dataset metadata; scope of the synthetic reported incurred).
- **rate_change_history** +`rate_history_version STRING`, `event_id STRING`,
  `effective_date DATE` (actual inception/renewal date — required for the parallelogram method),
  `status STRING` (implemented|proposed; MVP implemented only), `date_source STRING`
  (observed|seeded|assumed_from_year — never implies an invented date was observed).
  `rate_change_pct` stays a **decimal** (0.03 = +3%); `rate_level_index` is legacy/diagnostic.
- **segment_rate_state** +`rate_history_version STRING`, `baseline_effective_date DATE`,
  `baseline_rate_index DOUBLE`, `history_complete_from DATE`, `reference_rate_date DATE`,
  `policy_term_days INT`, `on_level_method STRING` (default method for the segment).
- **indication_scenarios** +`premium_settings_json STRING` (method, reference date, baseline,
  term, history version, bounded scenario-local event overrides — validated object; structured
  inputs stay OUT of the float `indication_assumptions` table), `last_calculated_input_hash STRING`
  (stale-input guard: a scenario edited since its last calc can't be submitted).
- **indication_results** +`input_snapshot_json STRING` (full validated inputs), `input_hash STRING`
  (reproduce/verify), `rate_history_version STRING`, `premium_summary_json STRING` (method, total
  EP/OLEP, overall factor, raw & on-level reported LR). Old rows without a snapshot read as legacy.
