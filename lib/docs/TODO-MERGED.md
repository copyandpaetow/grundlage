# Consolidated TODO

Merge of `docs/API-REVIEW-TODO.md` (API grilling action items) and `TODO.md` (known
issues / backlog). Grouped by **code location**; within each group items run **simple →
complex**. Complexity is tagged `[S]` / `[M]` / `[L]`. Overlapping items from both files
are merged and noted.

Durable rationale lives in `CONVENTIONS.md` and `docs/adr/`; this file is disposable and
gets rewritten as items land.

---

## Process (done)

- [x] `[S]` Commit `CONVENTIONS.md`. *(Phase 0)*
- [x] `[S]` Open ADRs for the deferred tradeoffs so "decided" is distinct from
  "unnoticed" (see Deferred decisions below). *(Phase 0)*

---

## Parser (`src/parser`)

- [ ] `[L]` **Part A — document-free parser** *(do first)*. Make `parse()` touch no DOM:
  parser state → pooled `ParserState` struct + context-first free functions; `parse()`
  returns a `result` **string seed** (`fragment: null`); materialization (`buildFragment`,
  `parserHost`) moves to the rendering layer and runs lazily on first `setup()`;
  root-template detection moves into parse-state (disqualify checks + `<template>`
  wrapper suppression + flag-driven tail reparse). Gate the struct step on `html.bench.ts`
  vs `bench/baseline.json`. Foundation for the html compiler **and** happy-dom-free SSR
  parse. Plan: [`document-free-parser-plan.md`](./document-free-parser-plan.md); rationale:
  **ADR-0009** (pooled struct), **ADR-0010** (document-free). **Subsumes** the two items
  below — the non-reentrancy comment moves onto the pooled instance, and "parser returns a
  string" *is* this work.
- [ ] `[M]` **Centralize per-element scope reset** into one `resetElementScope()` so
  `selfClosing = false` and buffer-array flushing happen in one place. Today's
  correctness depends on unstated buffer-state invariants (latent, not a live bug).
  *(API-review M/N TODO + TODO.md parser — same item.)*
- [ ] `[L]` **Store attribute type bits in the parser** (is-event, is-property) on the
  binding, so `applyAttributeBinding` skips the per-write charCode/typeof cascade.
  Prerequisite for the attribute-table rework below. *(API-review Phase 3 + TODO.md
  attributes — same item.)*

---

## Attributes (`src/rendering/attribute.ts`)

- [ ] `[S]` **Make unknown `on*` handlers loud.** When a camelCase `on<name>` carries a
  function value but no matching IDL property exists, the value currently falls through
  to a silent property assignment (typo'd `onClik` becomes a dead property). Add a
  `console.warn` before that write (error contract, ADR-0002). Silent fallback is
  incidental to IDL-gate ordering, so the warning is safe.
- [ ] `[S]` **`clearHostAttributes`** casts `0..hostBindingOffset` as `AttributeBinding`
  unguarded — guard it. *(Deferred.)*
- [ ] `[M]` **Diff name-only (array/object) attributes** so only changed entries are
  written; skip where `old === new`. Check first whether the browser already coalesces
  these. *(TODO.md attributes.)*
- [ ] `[M]` **Multi-value attr with a function won't clean up its listener.** `oldValue`
  isn't passed on multi-value attr paths → potential listener leak if such an attr ever
  carries a function. Confirm the parser invariant or pass `oldValue`. *(TODO.md +
  API-review deferred — same item.)*
- [ ] `[L]` **Rule 8 + 15:** collapse the `updateAttribute` / `removeAttributeBinding`
  twin switches into one `{ apply, remove }` table keyed by `ATTRIBUTE_SHAPE`, using the
  new parser type bits.

---

## Content (`src/rendering/content.ts`)

- [ ] `[S]` **Rule 5:** unify `EMPTY_ARRAY` (template-html) + `EMPTY_PREVIOUS` (content)
  into one exported `EMPTY_EXPRESSIONS`.
- [ ] `[S]` **Rule 5:** fix the `previous === undefined` first-render branch to read the
  unified sentinel explicitly instead of an out-of-bounds `undefined`.
- [ ] `[M]` **Rule 14:** `EXPANDABLE` stores its expression slot in `keys[0]` while every
  other shape uses `values[0]`. Rename so the slot location is consistent; remove the
  `as number` casts.
- [ ] `[M]` **Rule 5/4:** replace the repeated `previousExpressions.length > 0` idiom
  (`resolvePreviousExpressions` + 4 inline checks) with one model.
- [ ] `[M]` **Rule 15:** add a `VALUE_KIND` `Uint8Array`, classified in `update()`'s
  existing probe.
- [ ] `[M]` **Rule 8:** convert `updateContent`'s value dispatch to a table over
  `VALUE_KIND` (depends on the item above).
- [ ] `[L]` **Rule 13:** resolve the `renderTemplate` (content.ts) / `renderTemplate`
  (csr) / `renderOnce` (ssr) naming tangle. Same-role CSR/SSR callbacks share a name; the
  content.ts helper is renamed.

> Fold the four Rule 15 / value-kind items (here + Attributes) into **one pass** over
> `update()` / `applyAttributeBinding` rather than touching them twice. *(API-review
> Phase 3.)*

---

## Tags (`src/rendering/tag.ts`)

- [ ] `[M]` **Don't update a tag if it is identical.** *(TODO.md tags.)*
- [ ] `[L]` **Restoring an element drops all internal state** (its own and its
  children's): event listeners, focus, scroll positions, animation progress. Restore as
  faithfully as possible. *(TODO.md tags.)*

---

## List rendering (`renderList`)

- [ ] `[M]` **In-place array mutation silently skips re-render.** `arr.push(x); update()`
  hits the `===` short-circuit (identity unchanged). Document the immutable-array contract
  or detect mutation. *(TODO.md + API-review deferred — same item.)*
- [ ] `[L]` **Stop mutating the user's list.** `renderList` mutates the user's list
  contents in place; reconcile without mutating user data (cost: an allocation — measure).
  Needs an alternative to the current user-data manipulation. *(TODO.md list rendering +
  API-review "G" — same item.)*
- [ ] `[L]` **Rule 11:** define the marker-pair range walk once; route
  `deleteNodesBetween`, `#findTargets`, `renderList` collection, and
  `removeItemDom` / `moveItemAfter` through it. Forces the `deleteNodesBetween` and
  `removeItemDom` stop-conditions into agreement.

---

## Templates (`src/rendering/template-html.ts`, template-hash)

- [ ] `[M]` **Rule 12:** normalize the binding index — give every binding `bindingIndex`,
  or drop it from `TagBinding` and pass the index.
- [ ] `[L]` **Rule 3 + 4:** convert `HTMLTemplate` from class to struct + free functions
  (`createTemplate`, `setupTemplate`, `updateTemplate`, …). `#hash` becomes a nullable
  field; an `isTemplate` symbol brand replaces all 9 `instanceof HTMLTemplate` sites.

---

## Core / update state machine (`src/index.ts`, `src/rendering/sources.ts`)

- [ ] `[L]` **Make `update()` span the whole async render, not just the synchronous
  dispatch window** (ADR-0003). Today `update()` sets `RENDERING`, calls
  `dispatchCSRUpdate` synchronously, and flips back to `IDLE` in `finally` — but
  `dispatchCSRUpdate` returns the moment the driver (`sources.ts` `step`) suspends on a
  Promise, so `updateState` goes `IDLE` while an async render is still in flight.
    - **Await resolves too early for every async render:** the promise settles when the
      sync slice returns, not when the async DOM lands. 56 `await update()` call sites —
      this is the flaky-test source.
    - **Coalescing doesn't span async flight:** mid-flight, `updateState` is already
      `IDLE`, so the next `update()` re-fires and supersedes — correct result
      (`handle.finished` guards stale commits) but it's restart-churn, not batching.
    - **Fix (surface unchanged):** track the source's **settle** signal, not the sync
      return. `IDLE → SCHEDULED` (queue microtask, return shared `flushPromise`);
      `SCHEDULED →` return same promise (coalesce); `RENDERING →` set a `dirty` bit and
      return same promise (don't drop, don't restart). On settle: if `dirty`, re-run once
      with a fresh pull; else `IDLE` + resolve `flushPromise`. Driver-level supersession
      (`handle.finished`) stays as the safety net for external source swaps.
    - **Contract to ratify:** "`update()` resolves once the DOM reflects this call,
      coalescing with any concurrent update, across sync **and** async renders."

---

## Loader / SSR (`src/loader/load.ts`)

- [ ] `[M]` **Warn on SSR `load` replay drift.** Unkeyed `load` replays positionally
  (client consumes `data-ssr` scripts in DOM order). With conditional/nested `load` calls
  a positional mismatch between server and client can silently hand the wrong payload to
  the wrong `load`. Add a `console.warn` when drift is detectable (an unkeyed `load` finds
  no script while unconsumed `data-ssr` scripts remain, and/or leftover scripts survive
  hydration). Keep the positional default and `key` opt-in (error contract, ADR-0002).

---

## Error handling (rendering)

- [ ] `[M]` **Rule 7:** extract one `showFatal(host, error)`; collapse the duplicated
  `abortAndShowError` / `reportSSRError` bodies.

---

## CSS

- [ ] `[L]` *(potential)* **Isolate CSS changes** and update only the specific changed
  rule. *(TODO.md potential feature.)*
- [ ] `[L]` *(potential)* Allow styles to be **added directly as a class** on a component
  / register styles in an additional way. *(TODO.md potential feature.)*

---

## Public API / naming (breaking — do pre-1.0)

- [ ] `[M]` **Rename `render` → `component`** (the factory builds a custom-element
  constructor — a class — it does not render). Touch: `src/index.ts` export, type names,
  `README`, `llms.txt`, `CONCEPT.md`, tests, all `website/` call sites.
- [ ] `[M]` **Rename `host.setProperty` → `host.setProp`** (write-twin of `props`; same
  `prop` vocabulary, singular because it writes one). Touch: `src/index.ts` method,
  `src/types.ts` `BaseComponent`, tests, benches, `website/`.

---

## Documentation (no code)

- [ ] `[S]` Document that `props` / `setProp` are two halves of one model and both obey
  the **attribute-vs-property rule** (primitive → attribute, complex → property); state
  the rule once so read and write sides can't drift.
- [ ] `[S]` Document that object/array/function props are read from the **property only** —
  an attribute string like `tags='[1,2]'` is never parsed.

---

## Deferred decisions (need ADRs, not rule work)

- **Hash collisions.** `templateHash` patch path and expression-`hash` list
  reconciliation both trust 32-bit hashes; collisions silently reuse the wrong DOM.
  **Only correctness cliff found.** Decide: accept / wider hash / structural-equality
  fallback / explicit keys.
- **`#flush` is O(all bindings).** A dirty-index queue makes it O(dirty). Measure on
  large static templates.
- **Structural debts the rules fence but don't fix:** `targets` megamorphic union + two
  index spaces; `SourceHandle` nullable fields / `!` asserts; CSR/SSR install
  duplication. First empirical question: is the `targets` union a real perf cost or only
  a legibility one? Measure before surgery.

---

## Open questions (deferred — keep, revisit)

- **Should event-handler functions be passed down as props as well?**
- **Re-entrant `update()` during a render: defer how far?** A render-time `update()`
  currently hits the `!== IDLE` shortcut and is dropped. The async-spanning rework sets
  `dirty` and re-runs after settle (defer, not drop) — which reopens the infinite-loop
  half: a render that always calls `update()` would re-run forever. Decide whether a
  render-time `update()` is legal at all, and if so whether the `dirty` reflush needs a
  same-frame loop guard. Decide alongside ADR-0003.
- **Light-DOM (no-shadow) components?** `ComponentOptions = ShadowRootInit &
  { formAssociated }` always `attachShadow`s. Some components legitimately want no shadow
  root, but it touches the error contract (containment relies on the shadow root as the
  blast wall) and host-attribute / slot behavior. Revisit alongside the error and
  host/slot model.
- **Would a `<host>` element beat host attributes on the root `<template>`?** Keep the
  `<template>` carrier for now (aligned with Declarative Shadow DOM). The awkwardness:
  the template's attributes apply to the **host** while the template element is
  conceptually the **shadow root**. A nested `<host>` could separate the two. Not worth
  the invented vocabulary today; revisit if the conflation causes confusion.
