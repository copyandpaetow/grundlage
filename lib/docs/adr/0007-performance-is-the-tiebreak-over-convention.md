# Performance is the tiebreak over convention

When a convention in `CONVENTIONS.md` conflicts with performance, performance wins — the
convention is the default, not dogma. This is the preface to the conventions; this ADR
records the bar a perf exception must clear, so "performance is the veto" cannot become a
license to wave away any rule with "this is faster."

## Why

The library exists to make DOM operations sparse — performance _is_ the product, not a
nice-to-have layered on top. A convention that costs real cycles for cosmetic consistency
defeats the reason the library exists. So consistency yields to performance. But an
unbounded veto erodes the rules entirely (every shortcut gets retroactively called a perf
decision), so the veto has a bar.

## The bar

An exception is valid only if it **names a concrete engine mechanism** _or_ is **backed by
a measurement**:

- **Named mechanism (preferred).** Megamorphic call site, a deopt, an extra hot-path
  allocation, hidden-class instability, a non-monomorphic compare. This is the preferred
  justification _because_ the benchmark suite is slow and unreliable (see below) — a known
  engine fact is more trustworthy than a noisy number. The existing perf comments already
  work this way (`html.ts:196` hidden-class stability, `html-util.ts:3` monomorphic
  compares, `content.ts:27` one fewer allocation per render, `form-base.ts:40` skipped
  `CustomEvent.detail` allocation).
- **Measurement.** The benchmark suite is exhaustive but **slow to run and noisy**.
  Therefore a measurement overrules consistency only when the win is **reproducible and by a
  wide margin** — a marginal or flaky delta does not clear the bar, because it cannot be
  distinguished from benchmark noise.

Author intuition ("feels faster") is never sufficient on its own.

**A `// why` comment is always required** at the exception site, naming the mechanism or
citing the measurement. There are no silent rule-breaks — the comment is the audit trail
that keeps the exception reviewable.

## Considered Options

- **Performance is the tiebreak, with this bar (chosen).**
- **Consistency is inviolable (rejected).** Rules never yield; perf is handled by changing
  the rule. Rejected: in a library whose job is sparse DOM ops, a cosmetic rule that costs
  cycles is the wrong default, and the rule-change loop is too slow for hot-path work.
- **Performance wins on author judgment, no bar (rejected).** Rejected: it erodes the rules
  — any shortcut becomes "a perf decision" after the fact.

## Consequences

- Every deliberate rule-break carries a `// why` naming a mechanism or citing a measured,
  wide-margin win. Reviewers can audit each one.
- **Out of scope:** perf-vs-perf conflicts — most often compute vs memory — get _no_ fixed
  ordering here. Those are decided per case by measurement, not by this ADR.
