# Demo Q&A — Rate Indications Workbench

Straight, sourced answers to the "yes, but…" questions the room asks. Persona in brackets.

**Q (Actuary): What method is this?** The loss-ratio indication method: on-level the
premium, develop losses to ultimate, trend to the prospective period, add large-loss and
cat loads, credibility-weight against the permissible loss ratio, and read the indicated
rate change as projected ÷ permissible − 1. Standard technique, computed transparently.

**Q (Actuary): Is the indication done by AI/ML?** No. It's closed-form deterministic
arithmetic (`indication_engine.py`, pinned `calc_version`). The only AI is the "Explain"
narrator, which explains the numbers it's given and never computes them.

**Q (Actuary): Where do the development factors come from?** From the loss triangle
(`indication_loss_triangle`) — the same triangle shape the reserving team uses. The
"selected development" assumption lets you override the tail; older years are fully
developed and barely move.

**Q (Actuary): Only a single LDF scalar?** V1 exposes one selected tail factor scaled
across the immature years by the empirical pattern. Per-maturity selection and alternative
methods (chain-ladder, BF, Cape Cod) are the roadmap — the reserving workbench already
holds that machinery to plug in.

**Q (Decision-maker): Why does severity trend move it so much?** Long-tail liability
trends compound over the development-plus-projection horizon, so 2.5 points of extra
severity trend is worth ~8 points of indication. The decomposition shows it explicitly and
it sums exactly to the total move.

**Q (Decision-maker): Indicated vs selected?** The indication is the technical answer; the
selected rate is what management chooses to file, which may differ for competitive or
conduct reasons. Both are captured, with a comment and an audit event.

**Q (Incumbent champion): Can I reproduce a number months later?** Yes — every committed
calculation is an immutable row carrying the full assumption vector, `calc_version`,
`experience_version`, author and timestamp; every action is an append-only audit event.
Nothing is computed without being recorded.

**Q (Incumbent champion): Isn't the calc just hidden in the app?** Today the arithmetic
runs in-process for instant feedback, but only *previews* live there — anything committed
is recorded in Unity Catalog. The roadmap moves the mechanics into a governed UC
function/job so the app computes nothing load-bearing. (Labelled, see DECISIONS.md.)

**Q (SA): Is the data real?** Synthetic and seeded (deterministic — same numbers every
rebuild). Shaped to the ACORD/data-core semantics so it reads like a real book and can be
pointed at the group's actual experience.

**Q (SA): How does this move to another product/geography?** `book_flavour` — European
commercial is the default; US Retail (Prof Liability / GL / BOP, US states) ships as an
alternate. The workbench is book-agnostic; only the seed data changes.

**Q (Practitioner): Who has to approve?** Routed by the size of the change
(`approval_role`): routine (<5%) a pricing manager, material (5–10%) the chief pricing
actuary, large (>10%) the pricing committee.

**Q (Decision-maker): What's the portfolio picture?** The Portfolio view aggregates every
segment's approved baseline indication premium-weighted, so you see the book-level rate
need and which segments drive it — increases and decreases both.
