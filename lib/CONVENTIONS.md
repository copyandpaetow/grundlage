# CONVENTIONS

Guardrails for this codebase. The goal is code that is **fast and legible**. These are
defaults, not dogma. They describe _how we build_, independent of any particular file or
refactor — they should still hold at 2.0.

## Preface — performance is the veto

If following a rule forces a megamorphic call site, an extra allocation in a hot path, or
a deopt, the rule loses. When you break a rule for performance, leave a `// why` comment
naming the perf reason. The rule is the default; the comment is the escape hatch. Never
trade a real cycle for cosmetic consistency. When a rule and a hot path conflict and you
are unsure, measure.

---

## 1. State lives in a struct made by `createX`

Per-instance mutable state lives in a plain struct returned by a `createX(...)` factory,
typed by an `interface`. No module-level mutable state.

**Exception:** a non-reentrant, run-once-per-call-site hot path that caches its result
(e.g. a parser) may keep a **single pooled struct instance** at module scope and `reset`
it between runs rather than allocating per call — the reuse is the perf point, not loose
globals. It still takes the `createX` + struct + context-first free-function shape (no raw
module-scope cursors, no `class`); only the one instance is long-lived. The pooled instance
carries a comment stating the non-reentrancy assumption, including any synchronous
self-recursion site. See ADR-0009.

## 2. Don't mutate inputs as a side channel

An array or object passed in stays semantically what it was passed as. Reusing an input
slot as a cache needs a `// why` comment naming what is cached and when it is read back.
Mutating data owned by the _caller of the public API_ is not allowed — internal reuse only.

## 3. No `class`; use a struct + `context`-first free functions

Stateful things are structs operated on by free functions whose first parameter is the
struct (`context`/`handle`/`runtime`). No `class`.

**Exception:** the platform demands it (e.g. extending `HTMLElement`).

**Exception (provisional — tryout, evaluate soon):** a _data-only_ class — fields +
constructor, **no methods** — still operated on by the same context-first free functions, may
be used as a performant alternative to duck-typing. When a type must be told apart from
arbitrary user values on a hot path, `instanceof` is measurably faster than any property
brand (symbol or numeric field) and avoids duck-typing entirely. The sole case today is
`HTMLTemplate`. This is a tryout, not a settled pattern: revisit once a second such type
exists (e.g. a `css` template) to decide whether it generalizes or folds back to a struct +
brand.

## 4. Discriminate types by brand, not by paradigm

- Our own types: a single `isX(value)` guard. No `instanceof`
  on our own types.
- Platform types: `instanceof` (`Promise`) or `typeof` (primitive, function).

**Exception:** duck-typing a _user-supplied_ object — comment that it is user surface.

## 5. One shared const per absence-kind

Each "absence" value (empty expression list, finished-handle sentinel, …) is declared
once and imported. `null` only for "a slot that will later hold a real value." Never
`undefined` as a branched-on sentinel.

**Exception:** an optional parameter's own absence, and a `Map.get` miss, are honest
`undefined` and may be branched on.

## 6. Every acquire has a paired release in the same module

`createX`/`setupX` has a sibling deinit (`teardownX`/`clearX`/`cancelX`) in the same
module. The verb fits the noun. Teardown is never inlined at the call site.

**Exception:** a single bare platform call with no bookkeeping — comment that it is
intentionally inline.

## 7. Errors propagate through one model

Errors propagate via the established channel (the `onError` handle callback). `try/catch`
exists only at the boundaries that feed it — the generator driver and the public entry
point. Deliberate swallows are `catch { /* why */ }` with a reason. Fatal display is one
shared function, not duplicated per layer.

## 8. Dispatch over a union goes through one table

Dispatch over a tagged union uses one `const table = { [TAG]: fn }`. Paired operations
over the same union (apply/remove) share one table of `{ apply, remove }` so they cannot
drift.

**Exception:** a per-character/per-state `switch` over a dense enum where there is no
function to call — it compiles to a jump table and stays a `switch`.

## 9. Indexed `for` in any per-render path

Hot/per-render loops use indexed `for`.

**Exception:** cold/setup paths may use `for…of`/`while`; `for…in` only over genuinely
dynamic-keyed objects — comment which.

## 10. Parallel boolean flags are `Uint8Array` with `0`/`1`

Not `Set`, not `boolean[]`. No helper — the access is already obvious.

## 11. One traversal primitive per DOM-marker protocol

A marker protocol (e.g. "two comments bracket a range") is defined once and reused. No
re-deriving the invariant per call site.

## 12. Binding self-knowledge is symmetric

Either all bindings carry their own index or none do. No mixed model where one variant
knows its index and the rest rely on position.

## 13. No duplicate names across modules

A name means one thing. Two functions in different modules must not share a name unless
they fill the same role. Same role across parallel layers (e.g. CSR/SSR) should share the
name; different roles must not collide.

## 14. A field means the same thing across all variants of a union

If `binding.values[0]` is "the expression slot," it is that in every variant — not
`keys[0]` in one and `values[0]` in the rest. A field whose meaning flips by variant is
renamed, or the variants are restructured so the data lives in one consistent place.

**Exception (preface):** if unifying a field would force a megamorphic object layout at a
shared call site, keep the divergence and comment the perf reason.

## 15. Store derived classification, don't re-derive it per use

When the same "what kind of thing is this?" question is asked at multiple sites, classify
once — ideally reusing a probe already being run — and store the result (e.g. a parallel
`Uint8Array` of kind bytes, or type bits on the binding at parse time). Downstream reads
the stored kind instead of re-probing. Subject to the preface: the store is justified when
the classification is already being computed, or when re-probing sits on a hot path.
