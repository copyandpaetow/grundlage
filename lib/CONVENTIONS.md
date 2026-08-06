# CONVENTIONS

Guardrails for this codebase. The order is fixed: **correctness gates, simplicity and
consistency are the fabric, performance is the veto — but only real, measured performance.**
Defaults, not dogma; they should still hold at 2.0.

---

## The priority stack

Read top to bottom. A lower rule never overrides a higher one.

1. **Correctness gates everything.** A library that renders the wrong thing — or silently
   misses a change — is broken at any speed. Nothing buys past the gate.
2. **Simplicity and consistency are the fabric.** Absent a proven reason to deviate, this is
   what the code _is_.
3. **Performance is the veto — and only two things count:** fewer DOM mutations and fewer
   per-frame allocations. Everything else has been _measured_ not to matter. An override must
   be **shown on a probe**, never argued from theory or a micro-benchmark.

---

## What performance actually is

Two enemies, in order. If a change moves neither on a probe, it is not a performance change —
judge it as simplicity.

1. **DOM writes (~90–95% of frame time).** The cheapest frame writes nothing, so the most
   important code is the **change-detection skip path**: an unchanged hole touches the DOM
   not at all, leaving its identity-bearing state (focus, scroll, transitions, listeners,
   nested state) alive. A **false write** — re-setting something that didn't change — is the
   cardinal sin: a wasted mutation _and_ a restarted transition. **Patch over rebuild, move
   over recreate.**
2. **Allocation.** Per-frame young-gen churn causes GC pauses. Never retain a render's
   transient values past the frame that produced them.

**Everything else, assume the JIT handles it** — hidden classes, monomorphic shapes, cache
locality, loop style, struct vs class. Not yours to control in JavaScript, and measured not
to move the probes. Write the clearest version.

---

## Measuring

Performance claims are settled one way, by probes, so a "win" is never an artifact.

- **Real browser, 20× CPU throttle** (our old-device approximation). No micro-bench stands in.
- **Three numbers** per operation/frame: **DOM mutation count** (a `MutationObserver` tally —
  the direct read of enemy #1), **wall-clock ms including paint** (`start → mutate →
double-rAF`), and **memory/GC** (devtools allocation timeline — enemy #2).
- **Baseline and delta.** A change earns its override only when it improves a probe number
  **without regressing the others**.
- **No micro-benchmarks as justification.** A synthetic `p75` measures the ~5% the JIT
  abstracts away, with noise that routinely exceeds its signal.

Probes are representative components living with the app; which ones exist is an
implementation detail and will change. The contract above does not.

---

## Correctness (the gate)

A silent stale render is the worst possible failure — invisible, no error.

- **Never mutate caller-owned data.** An array/object passed into the public API stays what it
  was passed as; we never write into it as a side channel. Internal-slot reuse as a cache
  needs a comment naming what's cached and when it's read back.
- **Notice in-place mutation.** Change detection must catch a value mutated in place (same
  reference, new contents). Reference-equality-only skipping is a bug. Equality may **never**
  report "unchanged" for something that changed.
- **One marker-walk primitive per DOM protocol.** A marker protocol (e.g. two comments bracket
  a range) is defined once and reused by every site, so stop-conditions can't drift.
- **Every acquire has a paired release in the same module.** `createX` / `setupX` has a sibling
  `teardownX` / `clearX`; the verb fits the noun, never inlined. _Exception:_ a single bare
  platform call, commented as intentionally inline.
- **Errors propagate through one channel** (a task ends with `ROUTE_ERROR`, which the driver
  throws into the outer generator or, for the outer itself, sends to `#fail`). `try/catch` only at the
  boundaries that feed it; a deliberate swallow is `catch { /* why */ }`. `#fail` is the one
  shared fatal display.
- **A field means the same thing across every variant of a union.** If `values[0]` is the
  expression slot, it is that in every variant — never `keys[0]` in one.
- **Discriminate by brand, not paradigm.** Our types: a single `isX(value)` guard, no
  `instanceof`. Platform types: `instanceof` / `typeof`. _Exception:_ duck-typing a
  user-supplied object, commented as user surface.

---

## Simplicity and consistency (the fabric)

A deviation needs a why-comment naming the reason — and for a performance deviation, a probe
number.

- **Simplicity wins unless performance earns the override** — earned only by a probe number,
  never a suspicion, never cosmetic consistency.
- **Rule of three, not DRY-on-sight.** A forwarding function (`fnA(a) { return fnB(a) }`) is
  worse than the duplication. Write it twice; extract on the third stable instance.
- **Shallow over nested.** Early returns over `else` ladders. Hard-to-follow nesting is the
  signal to simplify, not to comment.
- **Comments are a rare exception.** Names carry the meaning. **No archaeology** (no "was 97%
  slower" — that's a commit/ADR); the one comment that earns its place names a **present-tense
  constraint the code can't show**. **No commented-out or dead code.**
- **Naming is consistency.** Same functionality, same name; a name means one thing. Parallel
  layers (CSR/SSR) share a _role_ name; different roles never collide.
- **Name for a newcomer, not the machine.** Booleans are predicates (`isReady`, `hasMounted`).
  A generic `[verb][noun]` (`processNode`, `handleValue`) names the mechanism, not the intent.
- **No boolean function parameters.** Split into named functions or take a named kind.
- **Name compound conditions** as `const`s — naming, not abstraction, no function hop.
- **Sentinels over `undefined`-as-signal.** Each absence-kind declared once; `null` only for
  "a slot that will hold a real value." _Exception:_ an optional param's own absence and a
  `Map.get` miss are honest `undefined`.
- **State lives in a struct from `createX`,** typed by an `interface`, no module-level mutable
  state; operated on by `context`-first free functions, not classes — one consistent shape.
  _Exceptions:_ the platform demands it (`HTMLElement`); or a data-only class where a probe
  shows the construction path's allocation shape matters.
