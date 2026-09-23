"""
Rate-indication calculation engine — deterministic, transparent, no ML.

This is the load-bearing actuarial core of the workbench. It implements the
classic **loss-ratio rate-indication method**, the standard technique a P&C
pricing actuary uses to answer "by how much should we change rates?".

The method, step by step (each step maps to an editable assumption and to a
line in the on-screen decomposition):

  1. Experience period      pick the last N accident years (experience_period_years)
  2. On-level premium        restate historic earned premium at the CURRENT rate
                             level, so premium and losses are comparable
  3. Loss development        develop reported (incurred) losses to ultimate using
                             a loss-development factor (LDF)  [loss_development_factor]
  4. Trend                   bring each year's ultimate loss to the prospective
                             cost level using frequency and severity trend
                             [frequency_trend, severity_trend]
  5. Loads                   add large-loss and catastrophe provisions
                             [large_loss_load, cat_load]
  6. Credibility             blend the experience loss ratio with a prior
                             (break-even) loss ratio  [credibility]
  7. Permissible loss ratio  1 - (expenses + commission + reinsurance + profit)
                             [expense_ratio, commission_ratio, reinsurance_load,
                              profit_provision]
  8. Indicated change        indicated = projected LR / permissible LR - 1

Everything is a closed-form arithmetic expression of the inputs — nothing is
fitted or sampled — so any number on screen can be reproduced by hand, and the
"Explain Indication" assistant narrates these results, it never computes them.

Kept dependency-free (only the stdlib) so it runs identically in the Databricks
App, in a notebook, and in an offline unit test.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

# Bump when the arithmetic changes; persisted with every result for audit.
# 1.1.0 — pluggable on-level premium factors (earning-aware parallelogram alongside
#         the legacy annual-index method); raw vs on-level reported LRs surfaced.
CALC_VERSION = "1.1.0"

# The eleven assumptions the actuary can set. Order matters: the decomposition
# walks them in this sequence, flipping each from baseline to scenario in turn.
ASSUMPTION_ORDER: list[str] = [
    "frequency_trend",
    "severity_trend",
    "loss_development_factor",
    "large_loss_load",
    "cat_load",
    "credibility",
    "experience_period_years",
    "expense_ratio",
    "commission_ratio",
    "reinsurance_load",
    "profit_provision",
]

# Human labels + units, used by the API/UI so the frontend never hardcodes them.
ASSUMPTION_META: dict[str, dict[str, str]] = {
    "severity_trend":          {"label": "Severity trend",        "unit": "pct", "group": "Loss"},
    "frequency_trend":         {"label": "Frequency trend",       "unit": "pct", "group": "Loss"},
    "loss_development_factor": {"label": "Selected development",  "unit": "factor", "group": "Loss"},
    "large_loss_load":         {"label": "Large-loss load",       "unit": "pct", "group": "Loss"},
    "cat_load":                {"label": "Catastrophe load",      "unit": "pct", "group": "Loss"},
    "credibility":             {"label": "Credibility (Z)",       "unit": "pct", "group": "Method"},
    "experience_period_years": {"label": "Experience period",     "unit": "years", "group": "Method"},
    "expense_ratio":           {"label": "Expense ratio",         "unit": "pct", "group": "Provision"},
    "commission_ratio":        {"label": "Commission ratio",      "unit": "pct", "group": "Provision"},
    "reinsurance_load":        {"label": "Reinsurance load",      "unit": "pct", "group": "Provision"},
    "profit_provision":        {"label": "Profit & contingency",  "unit": "pct", "group": "Provision"},
}


@dataclass
class ExperienceYear:
    """One accident year of experience for a single segment (LOB x territory)."""
    accident_year: int
    earned_premium: float          # as historically written/earned
    reported_incurred: float       # incurred (paid + case reserves) to date
    claim_count: int
    exposure: float                # exposure units (e.g. policy-years / turnover units)
    rate_level_index: float        # cumulative rate index in force during that AY
    ldf_to_ultimate: float         # empirical loss-development factor to ultimate


@dataclass
class SegmentResult:
    indicated_rate_change: float
    projected_loss_ratio: float    # trended, loaded, credibility-weighted (the indication denominator input)
    permissible_loss_ratio: float
    experience_loss_ratio: float   # loaded experience LR (despite the name — NOT the credibility Z)
    current_rate_level: float
    on_level_earned_premium: float
    projected_ultimate_loss: float
    required_premium: float
    detail_years: list[dict[str, Any]] = field(default_factory=list)
    # premium-basis measures (Phase 1A): reported (undeveloped) LRs, same losses,
    # different denominator. Distinct from the trended projected_loss_ratio above.
    total_earned_premium: float = 0.0
    raw_reported_loss_ratio: float = 0.0        # reported / historical EP
    on_level_reported_loss_ratio: float = 0.0   # reported / on-level EP
    overall_on_level_factor: float = 1.0        # total OLEP / total EP
    on_level_method: str = "legacy_annual_index"


def permissible_loss_ratio(a: dict[str, float]) -> float:
    """Break-even loss ratio: the share of premium left for losses after the
    variable provisions. Losses above this => rate increase indicated."""
    provisions = (
        a["expense_ratio"] + a["commission_ratio"]
        + a["reinsurance_load"] + a["profit_provision"]
    )
    perm = 1.0 - provisions
    # Reject a nonsensical (>=100%) provision set for new calculations rather than
    # silently flooring to a tiny positive number.
    if perm <= 0:
        raise ValueError("provisions (expense+commission+reinsurance+profit) must be < 100%")
    return perm


def _effective_ldf(base_ldf: float, latest_base_ldf: float, selected_ldf: float) -> float:
    """Scale an accident year's empirical LDF by the ratio the actuary selected
    for the most immature year. Fully-developed years (base_ldf ~ 1.0) barely
    move; immature years move most. Keeps a single editable 'selected
    development' number meaningful across the whole triangle."""
    if latest_base_ldf <= 1e-6:
        return base_ldf
    scale = selected_ldf / latest_base_ldf
    # Apply the scale to the *development portion* (ldf - 1), not the whole factor.
    return 1.0 + (base_ldf - 1.0) * scale


def calc_segment(
    experience: list[ExperienceYear],
    current_rate_level: float,
    prospective_period: int,
    assumptions: dict[str, float],
    on_level_factors: dict[int, float] | None = None,
    on_level_method: str = "legacy_annual_index",
) -> SegmentResult:
    """Run the loss-ratio indication for one segment. Pure arithmetic.

    On-level premium (step 2) uses `on_level_factors[accident_year]` when supplied
    (the earning-aware parallelogram factor computed in on_level.py); otherwise it
    falls back to the legacy annual-index factor (current_rate_level / rate_index),
    which preserves the original behaviour exactly. Only the premium denominator
    changes between methods — losses (develop/trend/loads/credibility) are identical."""
    a = assumptions
    n_years = int(round(a["experience_period_years"]))
    # Most-recent n_years of experience.
    exp = sorted(experience, key=lambda e: e.accident_year)[-n_years:] if n_years > 0 else list(experience)
    if not exp:
        raise ValueError("no experience years selected")

    latest_base_ldf = max(exp, key=lambda e: e.accident_year).ldf_to_ultimate
    sel_ldf = a["loss_development_factor"]

    sum_olep = 0.0
    sum_trended_ult = 0.0
    sum_ep = 0.0
    sum_reported = 0.0
    detail: list[dict[str, Any]] = []

    for e in exp:
        # (2) on-level the premium — supplied factor (parallelogram) or legacy annual index
        if on_level_factors is not None and e.accident_year in on_level_factors:
            olf = on_level_factors[e.accident_year]
        else:
            olf = (current_rate_level / e.rate_level_index) if e.rate_level_index else 1.0
        olep = e.earned_premium * olf
        # (3) develop reported losses to ultimate
        eff_ldf = _effective_ldf(e.ldf_to_ultimate, latest_base_ldf, sel_ldf)
        ultimate = e.reported_incurred * eff_ldf
        # (4) trend the ultimate loss to the prospective cost level
        delta = prospective_period - e.accident_year
        trend_factor = ((1.0 + a["frequency_trend"]) ** delta) * ((1.0 + a["severity_trend"]) ** delta)
        trended_ult = ultimate * trend_factor

        sum_olep += olep
        sum_trended_ult += trended_ult
        sum_ep += e.earned_premium
        sum_reported += e.reported_incurred
        detail.append({
            "accident_year": e.accident_year,
            "earned_premium": round(e.earned_premium, 2),
            "on_level_factor": round(olf, 6),
            "on_level_earned_premium": round(olep, 2),
            "reported_incurred": round(e.reported_incurred, 2),
            # reported (undeveloped) LRs — same losses, two denominators; null if no premium
            "raw_reported_lr": round(e.reported_incurred / e.earned_premium, 4) if e.earned_premium else None,
            "on_level_reported_lr": round(e.reported_incurred / olep, 4) if olep else None,
            "effective_ldf": round(eff_ldf, 4),
            "ultimate_loss": round(ultimate, 2),
            "trend_years": delta,
            "trend_factor": round(trend_factor, 4),
            "trended_ultimate": round(trended_ult, 2),
            # NOTE: this is the TRENDED-ULTIMATE / OLEP ratio (kept for contract), not the raw reported LR
            "loss_ratio": round(trended_ult / olep, 4) if olep else None,
        })

    # A zero on-level premium means the segment has no usable experience — fail
    # loudly rather than record a misleading 0% indication.
    if sum_olep <= 0:
        raise ValueError("no on-level earned premium in the selected experience period")
    # experience loss ratio (on-level, developed, trended)
    raw_lr = sum_trended_ult / sum_olep
    # (5) loads: large-loss multiplicative on losses; cat additive as % of premium
    loaded_lr = raw_lr * (1.0 + a["large_loss_load"]) + a["cat_load"]
    # (7) permissible loss ratio
    perm_lr = permissible_loss_ratio(a)
    # (6) credibility blend toward the break-even (prior) loss ratio
    z = min(1.0, max(0.0, a["credibility"]))
    projected_lr = z * loaded_lr + (1.0 - z) * perm_lr
    # (8) indicated rate change
    indicated = projected_lr / perm_lr - 1.0

    required_premium = sum_olep * (projected_lr / perm_lr)

    return SegmentResult(
        indicated_rate_change=indicated,
        projected_loss_ratio=projected_lr,
        permissible_loss_ratio=perm_lr,
        experience_loss_ratio=loaded_lr,
        current_rate_level=current_rate_level,
        on_level_earned_premium=sum_olep,
        projected_ultimate_loss=sum_trended_ult,
        required_premium=required_premium,
        detail_years=detail,
        total_earned_premium=sum_ep,
        raw_reported_loss_ratio=(sum_reported / sum_ep) if sum_ep else 0.0,
        on_level_reported_loss_ratio=(sum_reported / sum_olep) if sum_olep else 0.0,
        overall_on_level_factor=(sum_olep / sum_ep) if sum_ep else 1.0,
        on_level_method=on_level_method,
    )


def decompose(
    experience: list[ExperienceYear],
    current_rate_level: float,
    prospective_period: int,
    baseline: dict[str, float],
    scenario: dict[str, float],
    baseline_factors: dict[int, float] | None = None,
    scenario_factors: dict[int, float] | None = None,
    premium_basis_label: str | None = None,
) -> list[dict[str, Any]]:
    """Sequential (marginal) attribution of the move in indicated rate change
    from baseline to scenario. Contributions sum EXACTLY to the total move.

    Order: an optional grouped **Premium rate basis** step first (holding loss
    assumptions at baseline, switching the on-level factors baseline→scenario —
    e.g. a method/date/history change), then each loss assumption in
    ASSUMPTION_ORDER (all evaluated at the scenario's premium factors)."""
    steps: list[dict[str, Any]] = []
    working = dict(baseline)

    def ind(assumptions, factors):
        return calc_segment(experience, current_rate_level, prospective_period,
                            assumptions, on_level_factors=factors).indicated_rate_change

    prev = ind(working, baseline_factors)
    # Step 0 — premium rate basis (on-level factors), loss assumptions held at baseline.
    if scenario_factors is not None and scenario_factors != baseline_factors:
        cur = ind(working, scenario_factors)
        contribution = cur - prev
        if abs(contribution) > 1e-9:
            steps.append({
                "assumption": "premium_basis",
                "label": premium_basis_label or "Premium rate basis",
                "from": None, "to": None,
                "group": "Premium",
                "contribution_pts": round(contribution * 100, 2),
            })
        prev = cur
    factors = scenario_factors if scenario_factors is not None else baseline_factors
    for name in ASSUMPTION_ORDER:
        if name not in scenario or scenario[name] == working.get(name):
            continue
        working[name] = scenario[name]
        cur = ind(working, factors)
        contribution = cur - prev
        if abs(contribution) > 1e-9:
            steps.append({
                "assumption": name,
                "label": ASSUMPTION_META.get(name, {}).get("label", name),
                "from": baseline.get(name),
                "to": scenario.get(name),
                "group": ASSUMPTION_META.get(name, {}).get("group", ""),
                "contribution_pts": round(contribution * 100, 2),
            })
        prev = cur
    return steps
