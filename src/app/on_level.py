"""
On-level earned premium — earning-aware rate-level adjustment. Pure stdlib.

Answers: "what would the premium earned on this historical business have been at
the selected reference rate level?" Restating historic earned premium to one
reference level makes historic experience comparable for rate adequacy. Standard
actuarial adjustment (CAS, Basic Ratemaking) — NOT a forecast of future premium
and NOT loss development/trend/mix (those are separate, downstream).

Two methods:
- ``legacy_annual_index``   — the existing simplification: factor = reference index
                              / the year's annual rate-level index. A crude annual
                              approximation (what a spreadsheet does).
- ``parallelogram_fixed_term`` — earning-aware: the average EARNED index over the
                              period is derived analytically from dated rate changes
                              under uniform writing + straight-line earning of a
                              fixed policy term (the parallelogram method).

The two comparison loss ratios (raw vs on-level) use EXACTLY the same losses; only
the premium denominator changes. Nothing here develops or trends losses.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from typing import Any, Literal

LEGACY = "legacy_annual_index"
PARALLELOGRAM = "parallelogram_fixed_term"


class OnLevelError(ValueError):
    """Actionable, safe validation error for on-level inputs."""


@dataclass
class RateEvent:
    effective_date: date
    change: float                 # decimal, e.g. 0.03 = +3%; must be > -1
    status: str = "implemented"   # MVP uses implemented only
    event_id: str | None = None
    date_source: str = "observed"  # observed | seeded | assumed_from_year


@dataclass
class RateHistory:
    baseline_index: float          # level applying from baseline_date until first event
    baseline_date: date
    events: list[RateEvent] = field(default_factory=list)
    version: str | None = None
    complete_from: date | None = None   # history is trustworthy from this date


# --------------------------------------------------------------------------- validate
def validate_rate_history(h: RateHistory) -> None:
    if not (h.baseline_index and h.baseline_index > 0 and _finite(h.baseline_index)):
        raise OnLevelError("baseline rate index must be finite and positive")
    impl = [e for e in h.events if e.status == "implemented"]
    dates = [e.effective_date for e in impl]
    if len(dates) != len(set(dates)):
        raise OnLevelError("duplicate rate-change effective dates in one segment history")
    for e in impl:
        if not _finite(e.change) or e.change <= -1:
            raise OnLevelError(f"rate change {e.change} on {e.effective_date} must be finite and > -100%")
        if e.effective_date < h.baseline_date:
            raise OnLevelError("a rate change is dated before the baseline date")


def _finite(x: float) -> bool:
    return isinstance(x, (int, float)) and x == x and x not in (float("inf"), float("-inf"))


# ------------------------------------------------------------------- written index
def _sorted_impl(h: RateHistory, on_or_before: date | None = None) -> list[RateEvent]:
    ev = [e for e in h.events if e.status == "implemented"]
    if on_or_before is not None:
        ev = [e for e in ev if e.effective_date <= on_or_before]
    return sorted(ev, key=lambda e: e.effective_date)


def rate_index_at(h: RateHistory, when: date) -> float:
    """Cumulative WRITTEN tariff index in force for policies incepting on `when`.
    Changes compound: +10% then -10% => 0.99."""
    idx = h.baseline_index
    for e in _sorted_impl(h, on_or_before=when):
        idx *= (1.0 + e.change)
    return idx


def _cumulative(h: RateHistory) -> list[tuple[date, float, float]]:
    """Return [(effective_date, index_before, index_after)] for each implemented
    event in date order, so each event's absolute increment is index_after-index_before."""
    out, idx = [], h.baseline_index
    for e in _sorted_impl(h):
        before = idx
        idx *= (1.0 + e.change)
        out.append((e.effective_date, before, idx))
    return out


# ----------------------------------------------------------- earning-aware average
def _G(x_days: float, T: float) -> float:
    """Antiderivative of the earned-share ramp clamp((t-d)/T,0,1)."""
    if x_days <= 0:
        return 0.0
    if x_days < T:
        return (x_days * x_days) / (2.0 * T)
    return x_days - T / 2.0


def earned_change_share(A: date, B: date, d: date, term_days: int) -> float:
    """Share of a change (effective date d) earned within period [A,B), under uniform
    writing + straight-line earning of a fixed term. h_j = [G(B-d)-G(A-d)] / (B-A)."""
    span = (B - A).days
    if span <= 0:
        raise OnLevelError("period end must be after period start")
    bd = (B - d).days
    ad = (A - d).days
    return (_G(bd, term_days) - _G(ad, term_days)) / span


def average_earned_rate_index(A: date, B: date, h: RateHistory, term_days: int) -> float:
    """I0 + Σ (I_j - I_(j-1)) · earned_share_j over [A,B)."""
    avg = h.baseline_index
    for (d, before, after) in _cumulative(h):
        avg += (after - before) * earned_change_share(A, B, d, term_days)
    return avg


# ------------------------------------------------------------------- coverage check
def assert_history_covers(h: RateHistory, earliest_period_start: date, reference_date: date,
                          term_days: int) -> None:
    """History-mode requires a baseline valid at/before earliest_period_start - term,
    and completeness through the reference date. Do not infer coverage from the first
    event alone."""
    need_from = date.fromordinal(earliest_period_start.toordinal() - term_days)
    if h.baseline_date > need_from:
        raise OnLevelError(
            f"rate history incomplete: need a baseline at/before {need_from.isoformat()} "
            f"(earliest earning cohort), have baseline from {h.baseline_date.isoformat()}")
    if h.complete_from is not None and h.complete_from > need_from:
        raise OnLevelError(
            f"rate history only complete from {h.complete_from.isoformat()}; "
            f"need coverage from {need_from.isoformat()}")


# --------------------------------------------------------------------------- driver
@dataclass
class Period:
    key: Any                       # e.g. accident_year
    start: date
    end: date
    earned_premium: float
    reported_incurred: float
    legacy_index: float | None = None   # the annual rate_level_index (legacy mode only)


def calculate_on_level(periods: list[Period], history: RateHistory, reference_date: date,
                       term_days: int, method: Literal["legacy_annual_index", "parallelogram_fixed_term"]
                       ) -> dict[str, Any]:
    """Per-period factor, OLEP and paired reported LRs, plus weighted totals.
    Applies the factor ONCE to observed earned premium. No loss adjustment here."""
    if method not in (LEGACY, PARALLELOGRAM):
        raise OnLevelError(f"unknown on-level method: {method}")
    if not periods:
        raise OnLevelError("no experience periods supplied")
    if method == PARALLELOGRAM:
        validate_rate_history(history)
        assert_history_covers(history, min(p.start for p in periods), reference_date, term_days)

    ref_index = rate_index_at(history, reference_date)
    if not (_finite(ref_index) and ref_index > 0):
        raise OnLevelError("reference rate index must be finite and positive")

    rows, tot_ep, tot_olep, tot_loss = [], 0.0, 0.0, 0.0
    for p in periods:
        if method == LEGACY:
            if not (p.legacy_index and p.legacy_index > 0):
                raise OnLevelError(f"legacy index missing/invalid for period {p.key}")
            avg_index = p.legacy_index
        else:
            avg_index = average_earned_rate_index(p.start, p.end, history, term_days)
        if not (_finite(avg_index) and avg_index > 0):
            raise OnLevelError(f"average earned index invalid for period {p.key}")
        factor = ref_index / avg_index
        olep = p.earned_premium * factor
        rows.append({
            "key": p.key, "earned_premium": p.earned_premium, "reference_index": ref_index,
            "average_earned_index": avg_index, "on_level_factor": factor,
            "on_level_earned_premium": olep, "reported_incurred": p.reported_incurred,
            # per-row reported LRs are null when premium is zero (never 0% or inf)
            "raw_reported_lr": (p.reported_incurred / p.earned_premium) if p.earned_premium else None,
            "on_level_reported_lr": (p.reported_incurred / olep) if olep else None,
        })
        tot_ep += p.earned_premium
        tot_olep += olep
        tot_loss += p.reported_incurred

    return {
        "method": method, "reference_date": reference_date.isoformat(),
        "reference_index": ref_index, "term_days": term_days,
        "periods": rows,
        "total_earned_premium": tot_ep,
        "total_on_level_earned_premium": tot_olep,
        "overall_factor": (tot_olep / tot_ep) if tot_ep else None,
        # weighted totals — never an unweighted average of row ratios
        "raw_reported_loss_ratio": (tot_loss / tot_ep) if tot_ep else None,
        "on_level_reported_loss_ratio": (tot_loss / tot_olep) if tot_olep else None,
    }
