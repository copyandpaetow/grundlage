# CONVENTIONS

Guardrails for this codebase. The goal is code that is **simple, fast, and consistent** —
in that tension, never one at the cost of comprehension. These are defaults, not dogma.
They describe _how we build_, independent of any particular file or refactor — they should
still hold at 2.0.

---

## Philosophy

### Two triangles, held in tension

- **Design:** simplicity · performance · consistency.
- **Performance:** memory · rendering · parsing (less code is less to parse).

Within each triangle the three corners are equally important. You will trade between them
constantly; the rest of this document is mostly about _which_ trade to make.

### Simplicity wins unless performance earns the override

The default is the simplest code that does the job. Performance can override simplicity and
consistency — but only when the win is **measured** and **wide in both relative and absolute
terms**. A 20% improvement that moves 1 ns to 1.2 ns is not wide; it loses to the simpler
code. A megamorphic call site, an extra allocation in a hot path, or a deopt on a per-render
path clears the bar. When unsure, measure. Never trade a real, measured cycle for cosmetic
consistency — and never trade comprehension for a cycle you only _suspect_.

### Rule of three, not DRY-on-sight

Do not abstract on the second use. A function that only forwards to another —
`fnA(a, b, c) { return fnB(a, b, c) }` — is worse than the duplication it claims to remove:
it adds a hop and a name without adding meaning. Write it twice. On the third instance, once
the shape has proven stable, extract.

### Shallow over nested

Keep call depth and conditional nesting to a minimum. Prefer early returns to `else`
ladders. When branching or indirection makes a function hard to follow top-to-bottom, that
is the signal to simplify — not to explain.

### Comments are a rare exception

The names carry the meaning. If the variables and function names don't explain the code,
the code is too complex — fix the code, don't annotate it. Two hard rules:

- **No archaeology.** Never leave a comment comparing implementations over time
  ("was 97% slower the other way", "tried VALUE_KIND, regressed"). That belongs in the
  commit message or an ADR, not next to the code.
- The one comment that earns its place names a **present-tense constraint the code cannot
  show** — e.g. why a particular object shape avoids a megamorphic call site, or a
  non-reentrancy assumption. Present tense, current reason, no benchmark numbers.
- **No commented-out code, no dead code.** Delete it — git remembers. Unreachable branches
  and stale blocks are parse weight and a false signal to the next reader.

---

## Style

The defaults for naming and data structures. If a different solution is chosen for a
specific case, it needs a why comment naming the reason.

### Naming is consistency

The same functionality is done by the same function with the same name. A name means one
thing across the whole codebase. Across parallel layers (CSR/SSR) the same _role_ shares a
name; different roles must never collide on one.

### Name for a newcomer, not for the machine

Booleans read as predicates (`isReady`, `hasMounted`, `canFlush`). But a generic
`[verb][noun]` — `processNode`, `handleValue`, `updateState` — is usually a smell: it's
tech-jargon that names the mechanism, not the intent, and someone new to the project learns
nothing from it. Name what the code is _for_, even when that's longer or less symmetrical
than the verb-noun reflex.

### No boolean function parameters

`render(node, true)` tells the reader nothing. Split it into two named functions
(`renderStatic` / `renderLive`) or take a named kind.

### Name compound conditions

A multi-term boolean reads better as named `const`s than inline. This is naming, not
abstraction — no function hop — and it replaces the comment you'd otherwise write.

```js
const isReady = node && hasMounted || forced;
const isStale = lastRun && expired && !pinned;
if (isReady || isStale) { … }
```

### Parallel boolean flags are `Uint8Array` with `0`/`1`

Not `Set`, not `boolean[]`. No helper — the access is already obvious.

### One shared const per absence-kind

Each "absence" value (empty expression list, finished-handle sentinel, …) is declared once
and imported. `null` only for "a slot that will later hold a real value." Never `undefined`
as a branched-on sentinel.

**Exception:** an optional parameter's own absence, and a `Map.get` miss, are honest
`undefined` and may be branched on.

### Indexed `for` in any per-render path

Hot / per-render loops use indexed `for`. Cold / setup paths may use `for…of` / `while`;
`for…in` only over genuinely dynamic-keyed objects.

---

## Architecture

These are the structural guardrails. They are load-bearing: they keep allocations, dispatch,
and data layout predictable so the simple code stays fast.

### State lives in a struct made by `createX`

Per-instance mutable state lives in a plain struct returned by a `createX(...)` factory,
typed by an `interface`. No module-level mutable state.

**Exception:** a non-reentrant, run-once-per-call-site hot path that caches its result (e.g.
a parser) may keep a **single pooled struct instance** at module scope and `reset` it
between runs rather than allocating per call — the reuse is the perf point, not loose
globals. It still takes the `createX` + struct + context-first free-function shape; only the
one instance is long-lived, and it carries a comment stating the non-reentrancy assumption
(including any synchronous self-recursion site). See ADR-0009.

### Keep object shapes monomorphic

`createX` initializes **every** field, in one fixed order, on every path — no field added
later, none present only on some branches. This is what keeps the struct off megamorphic
call sites; the megamorphism named in exceptions throughout this document is the cost of
breaking this. A sometimes-absent field gets a shared sentinel (see _One shared const per
absence-kind_), never omission.

### No `class`; use a struct + `context`-first free functions

Stateful things are structs operated on by free functions whose first parameter is the
struct (`context` / `handle` / `runtime`).

**Exception:** the platform demands it (extending `HTMLElement`).

**Exception (provisional):** a _data-only_ class — fields + constructor, **no methods** —
operated on by the same context-first free functions, when a type must be told apart from
arbitrary user values on a hot path and `instanceof` measurably beats any property brand.
The sole case today is `HTMLTemplate`. Revisit once a second such type exists.

### Discriminate types by brand, not by paradigm

- Our own types: a single `isX(value)` guard. No `instanceof` on our own types.
- Platform types: `instanceof` (`Promise`) or `typeof` (primitive, function).

**Exception:** duck-typing a _user-supplied_ object — comment that it is user surface.

### Don't mutate inputs as a side channel

An array or object passed in stays semantically what it was passed as. Reusing an input slot
as a cache needs a comment naming what is cached and when it is read back. Mutating data
owned by the _caller of the public API_ is never allowed — internal reuse only.

### Every acquire has a paired release in the same module

`createX` / `setupX` has a sibling deinit (`teardownX` / `clearX` / `cancelX`) in the same
module. The verb fits the noun. Teardown is never inlined at the call site.

**Exception:** a single bare platform call with no bookkeeping — comment that it is
intentionally inline.

### Errors propagate through one model

Errors propagate via the established channel (the `onError` handle callback). `try/catch`
exists only at the boundaries that feed it — the generator driver and the public entry
point. Deliberate swallows are `catch { /* why */ }` with a reason. Fatal display is one
shared function, not duplicated per layer.

### A field means the same thing across all variants of a union

If `binding.values[0]` is "the expression slot," it is that in every variant — not `keys[0]`
in one and `values[0]` in the rest. A field whose meaning flips by variant is renamed, or
the variants are restructured so the data lives in one consistent place. The same applies to
self-knowledge: either all variants carry their own index or none do — no mixed model.

**Exception:** if unifying a field would force a megamorphic object layout at a shared call
site, keep the divergence and name the constraint.

### One traversal primitive per DOM-marker protocol

A marker protocol (e.g. "two comments bracket a range") is defined once and reused. No
re-deriving the invariant per call site.

### Store derived classification, don't re-derive it per use

When the same "what kind of thing is this?" question is asked at multiple sites, classify
once — ideally reusing a probe already being run — and store the result (a parallel
`Uint8Array` of kind bytes, or type bits set on the binding at parse time). Downstream reads
the stored kind instead of re-probing. Justified when the classification is already being
computed, or when re-probing sits on a hot path.
