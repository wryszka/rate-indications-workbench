"""Generate the book and print baseline indications per segment — calibration harness."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src", "app"))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src", "common"))
from indication_engine import ExperienceYear, calc_segment  # noqa
from gen_book import generate, baseline_assumptions, BOOKS  # noqa

flavour = sys.argv[1] if len(sys.argv) > 1 else "eu_commercial"
book = generate(flavour)
exp_by_seg = {}
for e in book["experience"]:
    exp_by_seg.setdefault((e["lob_code"], e["territory_code"]), []).append(e)
rate_state = {(r["lob_code"], r["territory_code"]): r for r in book["rate_state"]}
lob_meta = {l[0]: l for l in BOOKS[flavour]["lobs"]}

print(f"{'segment':<40} {'indicated':>10} {'proj LR':>8} {'perm LR':>8}")
vals = []
for (lob, terr), rows in sorted(exp_by_seg.items()):
    code, label, tail, base_lr, sev, freq = lob_meta[lob]
    a = baseline_assumptions(tail, sev, freq)
    ey = [ExperienceYear(accident_year=r["accident_year"], earned_premium=r["earned_premium"],
                         reported_incurred=r["reported_incurred"], claim_count=r["claim_count"],
                         exposure=r["exposure"], rate_level_index=r["rate_level_index"],
                         ldf_to_ultimate=r["ldf_to_ultimate"]) for r in rows]
    res = calc_segment(ey, rate_state[(lob, terr)]["current_rate_level"], book["prospective"], a)
    vals.append(res.indicated_rate_change)
    print(f"{lob+'/'+terr:<40} {res.indicated_rate_change*100:>9.1f}% "
          f"{res.projected_loss_ratio*100:>7.1f}% {res.permissible_loss_ratio*100:>7.1f}%")

vals.sort()
print(f"\nsegments={len(vals)}  min={min(vals)*100:.1f}%  "
      f"median={vals[len(vals)//2]*100:.1f}%  max={max(vals)*100:.1f}%")
