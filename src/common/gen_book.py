"""
Deterministic synthetic-book generator (shared by the local calibration harness
and the Databricks build notebook). Pure Python + stdlib so it runs anywhere.

Produces, for a chosen book flavour, the reference dims + per-segment experience,
loss triangle, rate-change history and current rate state. Everything is seeded,
so the same inputs always yield the same book (needed for reproducible demos).
"""
from __future__ import annotations
import hashlib, math, random
from datetime import date

# On-level premium coverage: a baseline rate level valid before the first event, so
# the earning-aware (parallelogram) method has full history for the earliest cohort.
BASELINE_DATE = date(2018, 1, 1)      # index 1.0 applies from here until the first change
BASELINE_INDEX = 1.0
REFERENCE_RATE_DATE = date(2026, 1, 1)  # latest experience end boundary
POLICY_TERM_DAYS = 365
LOSS_VALUATION_DATE = date(2026, 6, 30)

# ----- book flavours ---------------------------------------------------------
BOOKS = {
    "eu_commercial": {
        "currency": "EUR",
        "lobs": [
            # code, label, tail, target on-level *developed* loss ratio (pre-trend), sev, freq
            ("COMMERCIAL_PROPERTY", "Commercial Property", "short", 0.520, 0.045, -0.010),
            ("GENERAL_LIABILITY",   "General Liability",   "long",  0.535, 0.055, -0.015),
            ("COMMERCIAL_MOTOR",    "Commercial Motor",    "medium",0.500, 0.035, -0.005),
        ],
        "territories": [
            ("DE", "Germany",      "DACH",    1.00),
            ("FR", "France",       "West EU", 0.92),
            ("IT", "Italy",        "South EU",1.06),
            ("ES", "Spain",        "South EU",0.98),
            ("NL", "Netherlands",  "West EU", 0.90),
        ],
    },
    "us_retail": {
        "currency": "USD",
        "lobs": [
            ("PROFESSIONAL_LIABILITY", "Professional Liability", "long",  0.535, 0.060, -0.010),
            ("GENERAL_LIABILITY",      "General Liability",      "long",  0.520, 0.050, -0.010),
            ("BOP",                    "Business Owners Policy", "short", 0.500, 0.045,  0.000),
        ],
        "territories": [
            ("TX", "Texas",       "South",     1.04),
            ("CA", "California",   "West",      1.10),
            ("NY", "New York",     "Northeast", 1.12),
            ("FL", "Florida",      "Southeast", 1.15),
            ("IL", "Illinois",     "Midwest",   0.98),
        ],
    },
}

FIRST_AY, LAST_AY = 2019, 2025          # 7 accident years of experience
PROSPECTIVE_DEFAULT = 2027

# Approved baseline assumption set per tail (the "Approved Baseline" scenario).
BASELINE_BY_TAIL = {
    "short":  dict(loss_development_factor=1.03, credibility=0.90, experience_period_years=5,
                   large_loss_load=0.03, cat_load=0.03),
    "medium": dict(loss_development_factor=1.10, credibility=0.85, experience_period_years=5,
                   large_loss_load=0.04, cat_load=0.01),
    "long":   dict(loss_development_factor=1.18, credibility=0.75, experience_period_years=5,
                   large_loss_load=0.05, cat_load=0.005),
}
COMMON_BASELINE = dict(expense_ratio=0.185, commission_ratio=0.125,
                       reinsurance_load=0.03, profit_provision=0.05)


def _rng(*parts) -> random.Random:
    h = hashlib.sha256("|".join(str(p) for p in parts).encode()).hexdigest()
    return random.Random(int(h[:12], 16))


def baseline_assumptions(tail: str, sev: float, freq: float) -> dict:
    a = dict(COMMON_BASELINE)
    a.update(BASELINE_BY_TAIL[tail])
    a["severity_trend"] = sev
    a["frequency_trend"] = freq
    return a


def _ldf_for_maturity(tail: str, maturity: int) -> float:
    """Empirical LDF-to-ultimate by how developed a year is; long tails need more."""
    tail_ldf = {"short": 1.03, "medium": 1.12, "long": 1.22}[tail]
    if maturity >= 6:
        return 1.0
    return round(1.0 + (tail_ldf - 1.0) * (0.62 ** maturity), 4)


def generate(flavour: str = "eu_commercial", version: str = "v1", seed: str = "stable-2026"):
    """`version` is the lineage label stamped on every row; `seed` fixes the
    randomness so the book (and therefore the demo numbers) is identical on every
    rebuild regardless of when it runs."""
    book = BOOKS[flavour]
    lobs, terrs, ccy = book["lobs"], book["territories"], book["currency"]

    ref_lob = [dict(lob_code=c, lob_label=l, tail=t, display_order=i)
               for i, (c, l, t, _, _, _) in enumerate(lobs)]
    ref_terr = [dict(territory_code=c, territory_label=l, region=r, currency=ccy, display_order=i)
                for i, (c, l, r, _) in enumerate(terrs)]

    experience, triangle, rate_hist, rate_state = [], [], [], []

    for lob_code, lob_label, tail, base_lr, sev, freq in lobs:
        for terr_code, terr_label, region, terr_mult in terrs:
            rng = _rng(seed, flavour, lob_code, terr_code)
            # premium scale differs by segment
            base_prem = 6_000_000 * terr_mult * rng.uniform(0.6, 1.5)
            # rate-change history -> cumulative index
            idx = 1.0
            for yr in range(FIRST_AY, LAST_AY + 1):
                chg = round(rng.uniform(-0.01, 0.05) + (0.01 if tail == "long" else 0.0), 4)
                idx = round(idx * (1 + chg), 4)
                rate_hist.append(dict(lob_code=lob_code, territory_code=terr_code,
                                      effective_year=yr, rate_change_pct=chg, rate_level_index=idx,
                                      note="taken rate change",
                                      rate_history_version=version,
                                      event_id=f"{lob_code}-{terr_code}-{yr}",
                                      effective_date=date(yr, 1, 1),   # assumed_from_year (synthetic)
                                      status="implemented", date_source="assumed_from_year"))
            current_rate_level = idx
            rate_state.append(dict(lob_code=lob_code, territory_code=terr_code,
                                   current_rate_level=current_rate_level,
                                   last_rate_change_pct=chg, last_effective_year=LAST_AY,
                                   rate_history_version=version,
                                   baseline_effective_date=BASELINE_DATE, baseline_rate_index=BASELINE_INDEX,
                                   history_complete_from=BASELINE_DATE, reference_rate_date=REFERENCE_RATE_DATE,
                                   policy_term_days=POLICY_TERM_DAYS, on_level_method="legacy_annual_index"))
            # per-segment loss-ratio noise so segments differ
            seg_lr = base_lr * rng.uniform(0.93, 1.09)
            rl_idx = {r["effective_year"]: r["rate_level_index"]
                      for r in rate_hist if r["lob_code"] == lob_code and r["territory_code"] == terr_code}
            for yr in range(FIRST_AY, LAST_AY + 1):
                i = yr - FIRST_AY
                maturity = LAST_AY - yr
                earned = round(base_prem * (1.035 ** i) * rng.uniform(0.97, 1.03), 2)
                written = round(earned * rng.uniform(1.0, 1.06), 2)
                ldf = _ldf_for_maturity(tail, maturity)
                # ultimate loss at the (historic) rate level implies on-level LR seg_lr
                on_level_prem = earned * (current_rate_level / rl_idx[yr])
                ultimate = on_level_prem * seg_lr * rng.uniform(0.94, 1.07)
                reported = round(ultimate / ldf, 2)
                paid = round(reported * rng.uniform(0.45, 0.85) * (1 - 0.12 * (ldf - 1)), 2)
                claim_count = max(1, int((earned / rng.uniform(9000, 16000))))
                experience.append(dict(
                    experience_version=version, lob_code=lob_code, territory_code=terr_code,
                    accident_year=yr, earned_premium=earned, written_premium=written,
                    exposure=round(claim_count * rng.uniform(6, 10), 1), claim_count=claim_count,
                    reported_incurred=reported, paid_to_date=paid,
                    rate_level_index=rl_idx[yr], ldf_to_ultimate=ldf,
                    loss_valuation_date=LOSS_VALUATION_DATE,
                    premium_basis="gross_earned_365d", loss_basis="reported_incurred_gross"))
                # triangle: build cumulative incurred by dev lag up to current maturity
                for lag in range(0, maturity + 1):
                    dev_ldf_remaining = _ldf_for_maturity(tail, maturity - lag)  # factor still to go at this lag
                    cum_inc = round(ultimate / dev_ldf_remaining, 2)
                    cum_paid = round(cum_inc * min(1.0, 0.35 + 0.11 * lag) * rng.uniform(0.9, 1.0), 2)
                    triangle.append(dict(experience_version=version, lob_code=lob_code,
                                         territory_code=terr_code, accident_year=yr,
                                         dev_lag_months=lag * 12, cumulative_incurred=cum_inc,
                                         cumulative_paid=cum_paid))
    return dict(ref_lob=ref_lob, ref_terr=ref_terr, experience=experience,
                triangle=triangle, rate_hist=rate_hist, rate_state=rate_state,
                currency=ccy, prospective=PROSPECTIVE_DEFAULT, version=version)
