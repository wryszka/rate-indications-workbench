"""Validates on_level.py against the worked examples in the brief (§10). Run:
python3 scripts/test_on_level.py"""
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src", "app"))
from datetime import date
from on_level import (  # noqa
    RateHistory, RateEvent, Period, calculate_on_level, average_earned_rate_index,
    rate_index_at, earned_change_share, OnLevelError, PARALLELOGRAM, LEGACY,
)

FAC, MONEY = 1e-10, 0.01
def approx(a, b, tol=FAC): assert abs(a - b) <= tol, f"{a} != {b} (tol {tol})"

# ---- Example 1 — basic factor comparison (avg index 1.00, reference 1.15) ----
h = RateHistory(baseline_index=1.00, baseline_date=date(2018, 1, 1),
                events=[RateEvent(date(2025, 1, 1), 0.15)], complete_from=date(2018, 1, 1))
# reference at 2025-01-01 => 1.15; a period fully at 1.00 before the change:
p = [Period("y", date(2023, 1, 1), date(2024, 1, 1), 100_000_000, 70_000_000)]
r = calculate_on_level(p, h, date(2025, 1, 1), 365, PARALLELOGRAM)
approx(r["periods"][0]["average_earned_index"], 1.00)
approx(r["periods"][0]["on_level_factor"], 1.15)
approx(r["total_on_level_earned_premium"], 115_000_000, MONEY)
approx(r["raw_reported_loss_ratio"], 0.70)
approx(r["on_level_reported_loss_ratio"], 70/115)
print(f"Ex1  OLEP £{r['total_on_level_earned_premium']:,.2f}  raw LR {r['raw_reported_loss_ratio']*100:.6f}%  on-level LR {r['on_level_reported_loss_ratio']*100:.6f}%")

# ---- Example 2 — +10% at beginning of year, annual earning ----
h2 = RateHistory(1.00, date(2023, 1, 1), [RateEvent(date(2025, 1, 1), 0.10)], complete_from=date(2023, 1, 1))
avg = average_earned_rate_index(date(2025, 1, 1), date(2026, 1, 1), h2, 365)
approx(avg, 1.05)
approx(rate_index_at(h2, date(2026, 1, 1)) / avg, 1.10 / 1.05)
print(f"Ex2  avg earned {avg}  factor {1.10/avg:.12f}  (£105m -> £{105_000_000*(1.10/avg)/1e6:.3f}m)")

# ---- Example 3 — midyear +20% at 2025-07-01, actual days (184 days to year end) ----
h3 = RateHistory(1.00, date(2023, 1, 1), [RateEvent(date(2025, 7, 1), 0.20)], complete_from=date(2023, 1, 1))
avg3 = average_earned_rate_index(date(2025, 1, 1), date(2026, 1, 1), h3, 365)
approx(avg3, 1.0254126477763184, 1e-12)
fac3 = 1.20 / avg3
approx(fac3, 1.1702605800721173, 1e-12)
olep3 = 100_000_000 * fac3
approx(olep3, 117_026_058.01, MONEY)
approx((70_000_000 / olep3), 0.59815738, 1e-6)
print(f"Ex3  share {184**2/(2*365*365):.16f}  avg {avg3:.16f}  factor {fac3:.16f}  OLEP £{olep3:,.2f}  on-level LR {70_000_000/olep3*100:.6f}%")

# ---- Example 4 — multiple changes, compounding + weighting (abstract 365-day year) ----
# +10% at t=0, +10% at t=182.5 -> use day 0 and day 182 (integer); brief's algebraic check uses 182.5.
h4 = RateHistory(1.00, date(2024, 1, 1), [RateEvent(date(2025, 1, 1), 0.10), RateEvent(date(2025, 7, 2), 0.10)],
                 complete_from=date(2024, 1, 1))
# target written index after both = 1.21
approx(rate_index_at(h4, date(2026, 1, 1)), 1.21)
# decrease check: +10% then -10% => 0.99
hdec = RateHistory(1.00, date(2024, 1, 1), [RateEvent(date(2025, 1, 1), 0.10), RateEvent(date(2025, 6, 1), -0.10)])
approx(rate_index_at(hdec, date(2026, 1, 1)), 0.99)
print(f"Ex4  compounding +10%/+10% -> {rate_index_at(h4, date(2026,1,1)):.4f}   +10%/-10% -> {rate_index_at(hdec, date(2026,1,1)):.4f}")

# ---- Example 5 — aggregation (weighted, not average of ratios) ----
h5 = RateHistory(1.00, date(2020, 1, 1), [], complete_from=date(2020, 1, 1))
pa = Period("A", date(2023, 1, 1), date(2024, 1, 1), 100, 60, legacy_index=1.0)
pb = Period("B", date(2024, 1, 1), date(2025, 1, 1), 300, 180, legacy_index=1.0)
# force factors 1.20 and 1.00 via legacy indices against reference 1.20:
h5b = RateHistory(1.00, date(2020, 1, 1), [], complete_from=date(2020, 1, 1))
pa.legacy_index, pb.legacy_index = 1.0, 1.2  # ref 1.2 => factors 1.2 and 1.0
r5 = calculate_on_level([pa, pb], h5b, date(2024, 1, 1), 365, LEGACY)  # ref index=1.0 (no events)... use explicit:
# simpler: set reference via a single event to 1.20, legacy indices 1.0 and 1.2
h5c = RateHistory(1.00, date(2020, 1, 1), [RateEvent(date(2024, 6, 1), 0.20)], complete_from=date(2020, 1, 1))
r5 = calculate_on_level([Period("A", date(2023,1,1), date(2024,1,1), 100, 60, legacy_index=1.0),
                         Period("B", date(2024,1,1), date(2025,1,1), 300, 180, legacy_index=1.2)],
                        h5c, date(2025, 1, 1), 365, LEGACY)
approx(r5["total_earned_premium"], 400)
approx(r5["total_on_level_earned_premium"], 420)     # 100*1.2 + 300*1.0
approx(r5["overall_factor"], 1.05)
approx(r5["raw_reported_loss_ratio"], 0.60)
approx(r5["on_level_reported_loss_ratio"], 240/420)
print(f"Ex5  OLEP {r5['total_on_level_earned_premium']}  overall factor {r5['overall_factor']}  on-level LR {r5['on_level_reported_loss_ratio']*100:.6f}%")

# ---- Boundary: no changes + complete baseline -> factor 1 every period ----
hnone = RateHistory(1.00, date(2018, 1, 1), [], complete_from=date(2018, 1, 1))
rn = calculate_on_level([Period("y", date(2024,1,1), date(2025,1,1), 500, 300)], hnone, date(2026,1,1), 365, PARALLELOGRAM)
approx(rn["overall_factor"], 1.0)

# ---- Boundary: index normalisation (scale baseline + all levels) -> factors unchanged ----
hs = RateHistory(2.00, date(2018,1,1), [RateEvent(date(2025,7,1), 0.20)], complete_from=date(2018,1,1))
avg_s = average_earned_rate_index(date(2025,1,1), date(2026,1,1), hs, 365)
approx(rate_index_at(hs, date(2026,1,1))/avg_s, fac3, 1e-12)   # same factor as Ex3

# ---- Boundary: incomplete history blocks; zero EP -> null LR not 0/inf ----
try:
    calculate_on_level([Period("y", date(2019,1,1), date(2020,1,1), 100, 50)],
                       RateHistory(1.0, date(2019,6,1), [], complete_from=date(2019,6,1)), date(2026,1,1), 365, PARALLELOGRAM)
    raise AssertionError("should have blocked incomplete history")
except OnLevelError:
    pass
rz = calculate_on_level([Period("z", date(2024,1,1), date(2025,1,1), 0.0, 10.0)], hnone, date(2026,1,1), 365, PARALLELOGRAM)
assert rz["periods"][0]["raw_reported_lr"] is None and rz["periods"][0]["on_level_reported_lr"] is None

# ---- reject rate change <= -100% ----
try:
    validate = calculate_on_level([Period("y", date(2024,1,1), date(2025,1,1), 100, 50)],
        RateHistory(1.0, date(2018,1,1), [RateEvent(date(2024,1,1), -1.0)], complete_from=date(2018,1,1)),
        date(2026,1,1), 365, PARALLELOGRAM)
    raise AssertionError("should reject change <= -100%")
except OnLevelError:
    pass

print("\nALL ON-LEVEL EXAMPLES + BOUNDARIES PASS ✅")
