"""Offline sanity + math checks for the indication engine. Run: python3 scripts/test_engine.py"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src", "app"))
from indication_engine import ExperienceYear, calc_segment, decompose, permissible_loss_ratio  # noqa

# A representative Bricksurance SE segment: General Liability, Germany.
# 7 accident years, premium growing, losses developing, older years fully mature.
def make_experience():
    rows = []
    base_prem = 8_000_000.0
    for i, ay in enumerate(range(2019, 2026)):
        maturity = 2025 - ay          # years developed
        # empirical LDF to ultimate: immature years need more development
        ldf = round(1.0 + 0.14 * (0.72 ** maturity), 4) if maturity < 6 else 1.0
        earned = base_prem * (1.04 ** i)                 # ~4% premium growth
        # incurred so far ~ 62% ultimate LR then undeveloped
        ult_lr = 0.64
        reported = earned * ult_lr / ldf                 # so developed ~ 64% LR pre-trend
        rows.append(ExperienceYear(
            accident_year=ay, earned_premium=round(earned, 2),
            reported_incurred=round(reported, 2), claim_count=int(120 * (1.02 ** i)),
            exposure=round(1000 * (1.03 ** i), 1),
            rate_level_index=round(1.0 + 0.03 * i, 4),   # ~3%/yr historic rate changes
            ldf_to_ultimate=ldf,
        ))
    return rows

BASELINE = {
    "severity_trend": 0.06, "frequency_trend": -0.015, "loss_development_factor": 1.14,
    "large_loss_load": 0.04, "cat_load": 0.01, "credibility": 0.80,
    "experience_period_years": 5, "expense_ratio": 0.185, "commission_ratio": 0.125,
    "reinsurance_load": 0.03, "profit_provision": 0.05,
}

exp = make_experience()
cur_rl = 1.18  # current rate level index

base = calc_segment(exp, cur_rl, 2027, BASELINE)
print(f"CALC_VERSION check — permissible LR = {permissible_loss_ratio(BASELINE):.4f}")
print(f"Baseline indicated rate change : {base.indicated_rate_change*100:+.2f}%")
print(f"  projected loss ratio         : {base.projected_loss_ratio*100:.1f}%")
print(f"  permissible loss ratio       : {base.permissible_loss_ratio*100:.1f}%")
print(f"  on-level earned premium      : {base.on_level_earned_premium:,.0f}")

# Scenario: severity trend 6% -> 8%, higher large-loss load, higher LDF (the brief's arc)
scen = dict(BASELINE, severity_trend=0.08, large_loss_load=0.05, loss_development_factor=1.17)
sc = calc_segment(exp, cur_rl, 2027, scen)
print(f"\nScenario indicated rate change : {sc.indicated_rate_change*100:+.2f}%")
print(f"  difference vs baseline       : {(sc.indicated_rate_change-base.indicated_rate_change)*100:+.2f} pts")

steps = decompose(exp, cur_rl, 2027, BASELINE, scen)
print("\nDecomposition (why it moved):")
tot = 0.0
for s in steps:
    tot += s["contribution_pts"]
    print(f"  {s['label']:<22} {s['from']} -> {s['to']:<6} : {s['contribution_pts']:+.2f} pts")
print(f"  {'SUM of contributions':<22}{'':>16} : {tot:+.2f} pts")
print(f"  {'actual total move':<22}{'':>16} : {(sc.indicated_rate_change-base.indicated_rate_change)*100:+.2f} pts")

# assertions
assert abs(tot - (sc.indicated_rate_change - base.indicated_rate_change) * 100) < 0.02, "decomposition must sum to total"
assert -0.5 < base.indicated_rate_change < 0.5, "baseline indication should be plausible"
assert sc.indicated_rate_change > base.indicated_rate_change, "higher trend must raise the indication"
print("\nALL CHECKS PASSED ✅")
