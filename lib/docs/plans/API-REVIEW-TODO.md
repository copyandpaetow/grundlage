# API Review — Action Items

Actionable changes that came out of the API grilling session. Design rationale lives in
`CONTEXT.md` and `docs/adr/`. These are not yet applied to source.

## Code changes

- [ ] **Rename `render` → `component`** (the factory that turns a generator into a
  custom-element constructor — it builds a class, it does not render). Breaking; do it
  pre-1.0. Touch: `src/index.ts` export, type names where relevant, `README`,
  `llms.txt`, `CONCEPT.md`, tests, and all `website/` call sites.

- [ ] **Rename `host.setProperty` → `host.setProp`** (the write-twin of `props`; same
  `prop` vocabulary, singular because it writes one). Breaking; pre-1.0. Touch:
  `src/index.ts` method, `src/types.ts` `BaseComponent`, tests, benches, `website/`.

- [x] **Make the `update()` state machine span the whole async render, not just the
  synchronous dispatch window.** See ADR-0003. **Done.** The driver (`sources.ts`) now
  fires a one-shot `onSettle` at each natural/error terminal point (not on `cancelHandle` —
  supersession stays runtime-driven). The runtime (`csr-runtime.ts`) carries
  `dirty`/`flushPromise`/`resolveFlush`/`driving` and owns the machine via `scheduleFlush`
  → `runFlush` → `finishFlush` + `handleSourceSettle`: `IDLE → SCHEDULED` (microtask,
  shared `flushPromise`); `SCHEDULED` returns the same promise; `RENDERING` sets `dirty`
  and returns the same promise (no restart). On settle, one reflush if `dirty` (fresh
  pull), else `IDLE` + resolve. `update()` in `src/index.ts` collapsed to guards +
  `scheduleFlush`. **Settle = source completion** (chosen): `await update()` on a
  never-returning generator never resolves (released by disconnect/supersession). **No
  reflush loop guard** (chosen): a render that unconditionally re-updates loops the
  microtask queue (user error), bounded only by `dirty` being one bit. Driver-level
  supersession (`handle.finished`) stays the safety net for external source swaps. Tests:
  `tests/integration/update-scheduling.browser.test.ts`; redundant `await sleep()` crutches
  dropped from `async.browser.test.ts`; rapid-restart `nested-generators` tests reframed to
  the coalesce-don't-restart contract.

- [ ] **Warn on SSR `load` replay drift.** Unkeyed `load` replays positionally (client
  consumes `data-ssr` scripts in DOM order). We must assume **conditional / nested
  `load` calls** — we don't control how users call them — so a positional mismatch
  between the server and client render can silently hand the wrong payload to the wrong
  `load`. Add a `console.warn` when drift is detectable in `src/loader/load.ts` (e.g.
  an unkeyed `load` finds no script while unconsumed `data-ssr` scripts remain, and/or
  leftover scripts survive the hydration pass). Keep the positional default and the
  `key` opt-in; just close the silent hole, per the error contract (ADR-0002).

- [ ] **Make unknown `on*` handlers loud (event-binding option (b)).** In
  `src/rendering/attribute.ts`, when a camelCase `on<name>` carries a function value
  but no matching IDL property exists, the value currently falls through to a silent
  property assignment (a typo'd `onClik` becomes a dead property). Add a
  `console.warn` before that property write so it stops violating the error contract
  (ADR-0002). The silent fallback is incidental to the IDL-gate ordering, not relied
  on, so the warning is safe.

## Documentation follow-ups (no code)

- [ ] Document that `props`/`setProp` are two halves of one model and both obey the
  **Attribute-vs-property rule** (primitive → attribute, complex → property); state the
  rule once so the read and write sides can't drift.
- [ ] Document that object/array/function props are read from the **property only** — an
  attribute string like `tags='[1,2]'` is never parsed.

## Open questions (deferred — keep, revisit)

- **should the functions for the event handlers be passed down as props as well?**

- **Re-entrant `update()` during a render: defer how far?** ✅ **Resolved** with the
  ADR-0003 implementation. A mid-flight `update()` sets `dirty` and triggers exactly one
  deferred reflush after settle (defer, not drop) — the *missed-update* half. For the
  *infinite-loop* half we chose **no loop guard**: a render-time `update()` is legal, but
  because `dirty` is a single bit each settle reflushes at most once, and a render that
  *unconditionally* re-updates loops the microtask queue by construction (user error, like
  React's setState-in-render). Reflush is always a fresh microtask, never a synchronous
  re-entry, so the failure mode is a busy microtask queue, not a stack overflow. Bounded
  conditional re-updates are covered by a regression test
  (`update-scheduling.browser.test.ts`).

- **Light-DOM (no-shadow) components?** `ComponentOptions = ShadowRootInit &
      { formAssociated }` always `attachShadow`s — there is no way to render into light DOM.
  For "close to vanilla," some components legitimately want no shadow root. Deferred on
  purpose: it has consequences for the **error contract** (containment currently relies
  on the shadow root as the blast wall) and for how host attributes / slots behave, so
  it can't be decided in isolation. Revisit alongside the error and host/slot model.

- **Would a `<host>` element make more sense than putting host attributes on the root
  `<template>`?** Decision for now: keep the `<template>` carrier. Reasoning: the root
  `<template>` → shadow root mapping is *aligned* with Declarative Shadow DOM
  (`<template shadowrootmode>`), so the children-render "pun" isn't really a pun. The
  genuine awkwardness is that the template's *attributes* are applied to the **host**,
  while the template element itself is conceptually the **shadow root**, not the host.
  A nested `<host>` element could separate the two cleanly (`<template>` = shadow root,
  `<host …>` = host attributes). Not worth the invented vocabulary today, but revisit
  if the host/shadow-root conflation causes confusion.

# Next steps

Practical backlog for bringing the codebase in line with `CONVENTIONS.md`. This document
is **disposable** — it tracks the current refactor and gets deleted or rewritten once done.
The conventions are the durable artifact; this is not.

Sequenced so the conventions are written down first and refactors land against a fixed
target.

## Phase 0 — write it down

- [ ] Commit `CONVENTIONS.md`.
- [ ] Open ADRs for the deferred tradeoffs so "decided" is distinct from "unnoticed"
  (see Deferred below).

## Phase 1 — mechanical, no design needed

- [ ] **Rule 5:** unify `EMPTY_ARRAY` (template-html) + `EMPTY_PREVIOUS` (content) into one
  exported `EMPTY_EXPRESSIONS`.
- [ ] **Rule 5:** fix `content.ts` `previous === undefined` first-render branch to read the
  unified sentinel explicitly instead of an out-of-bounds `undefined`.
- [ ] **Rule 13:** resolve the `renderTemplate` (content.ts) / `renderTemplate` (csr) /
  `renderOnce` (ssr) tangle. Same-role CSR/SSR callbacks share a name; the content.ts
  helper is renamed.
- [ ] **Rule 1:** add the non-reentrancy comments, including the `parse(strings, true)`
  self-recursion site.

## Phase 2 — small refactors against the rules

- [ ] **Rule 7:** extract one `showFatal(host, error)`; collapse `abortAndShowError` /
  `reportSSRError` duplicated bodies.
- [ ] **Rule 5/4:** replace the repeated `previousExpressions.length > 0` idiom
  (`resolvePreviousExpressions` + 4 inline checks) with one model.
- [ ] **Rule 11:** define the marker-pair range walk once; route `deleteNodesBetween`,
  `#findTargets`, `renderList` collection, `removeItemDom`/`moveItemAfter` through it.
  (Also forces `deleteNodesBetween` and `removeItemDom` stop-conditions into agreement.)
- [ ] **Rule 12:** normalize binding index — give every binding `bindingIndex`, or drop it
  from `TagBinding` and pass the index.
- [ ] **M/N TODO:** centralize parser per-element scope reset into one `resetElementScope()`;
  today's correctness depends on unstated buffer-state invariants (latent, not a live bug).
- [ ] **Rule 14:** EXPANDABLE stores its expression slot in `keys[0]` while every other shape
  uses `values[0]`. Rename so the slot's location is consistent; remove the `as number` casts.

## Phase 3 — attribute-parsing + value-kind rework (Rule 15)

Fold these into one pass over `update()` / `applyAttributeBinding` rather than touching them
twice.

- [ ] Extend the parser to store attribute **type bits** (is-event, is-property) on the binding
  so `applyAttributeBinding` skips the per-write charCode/typeof cascade.
- [ ] **Rule 8 + 15:** convert `updateAttribute` / `removeAttributeBinding` twin switches into
  one `{ apply, remove }` table keyed by `ATTRIBUTE_SHAPE`, using the new type bits.
- [ ] **Rule 15:** add a `VALUE_KIND` `Uint8Array`, classified in `update()`'s existing probe.
- [ ] **Rule 8:** convert `updateContent`'s value dispatch to a table over `VALUE_KIND`.
- [ ] **Rule 3 + 4:** convert `HTMLTemplate` from class to struct + free functions
  (`createTemplate`, `setupTemplate`, `updateTemplate`, …). `#hash` becomes a nullable field;
  an `isTemplate` symbol brand replaces all 9 `instanceof HTMLTemplate` sites.

## Deferred — needs decisions (ADRs), not rule work

- **Hash collisions.** `templateHash` patch path and expression-`hash` list reconciliation both
  trust 32-bit hashes; collisions silently reuse the wrong DOM. **Only correctness cliff found.**
  Decide: accept / wider hash / structural-equality fallback / explicit keys.
- **In-place array mutation.** `arr.push(x); update()` hits the `===` short-circuit and never
  re-renders. Document the immutable-array contract or detect mutation.
- **G — user-list mutation.** `renderList` mutates the user's list contents in place. Change to
  reconcile without mutating user data (cost: an allocation; measure).
- **`#flush` is O(all bindings).** A dirty-index queue makes it O(dirty). Measure on large static
  templates.
- **`oldValue` on multi-value attr paths.** Not passed → potential listener leak if a multi-value
  attr ever carries a function. Confirm the parser invariant or pass `oldValue`.
- **`clearHostAttributes`** casts `0..hostBindingOffset` as `AttributeBinding` unguarded.
- **Structural debts the rules fence but don't fix:** `targets` megamorphic union + two index
  spaces; `SourceHandle` nullable fields / `!` asserts; CSR/SSR install duplication. First open
  empirical question: is the `targets` union a real perf cost or only a legibility one? Measure
  before surgery.