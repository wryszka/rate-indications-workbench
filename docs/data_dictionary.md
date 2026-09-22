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
