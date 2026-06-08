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

- [x] `[L]` **Part A — document-free parser** *(done)*. Make `parse()` touch no DOM:
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
- [x] `[M]` **Centralize per-element scope reset** into one `resetElementScope()` so
  `selfClosing = false` and buffer-array flushing happen in one place *(done)*. Both
  `flushElement` exits route through it, draining `tagBuffer` / `elementBuffer` /
  attribute scratch and clearing `currentTagName` + `selfClosing` — the
  "scratch is empty between elements" invariant is now explicit, not a consequence of
  control flow (the suppressed root `<template>` used to leave `currentTagName` /
  `tagBuffer` dangling). *(API-review M/N TODO + TODO.md parser — same item.)*
- [x] `[L]` **Store attribute type bits in the parser** *(done)*. New
  `ATTRIBUTE_NAME_KIND` (`UNKNOWN`/`PLAIN`/`NATIVE_EVENT`/`EXPLICIT_EVENT`) +
  `eventName` on `AttributeBinding`, classified once in `completeAttribute` via
  `classifyAttributeName`; `applyAttributeBinding` takes the bits and dispatches over a
  `switch` instead of the per-write charCode cascade, with `resolveEventNameFromKey` as
  the runtime fallback for dynamic/spread names (`UNKNOWN`). Prerequisite for the
  attribute-table rework below. *(API-review Phase 3 + TODO.md attributes — same item.)*

  **Bench note:** 705 DOM/unit tests green. The cached re-render hot path is flat
  (~1.0×); the new classification cost is paid once at parse time (cold, cached after
  first parse) by design. The committed `bench/baseline.json` is from a different machine
  (macOS) so cross-machine compares are meaningless here; an identical-code A/B on this
  container measured a ±15–25 % process-to-process noise floor on the cold micro-benches
  (`simple static template`, which has no attributes, swung 0.83×–1.08× with no code
  change). No regression resolvable above that floor. **Regenerate `baseline.json` on the
  target hardware (`npm run bench:baseline`) before trusting future `bench:compare`
  output.**

---

## Attributes (`src/rendering/attribute.ts`)

- [x] `[S]` **Make unknown `on*` handlers loud** *(done)*. `warnIfDeadNativeHandler`
  fires a `console.warn` (error contract, ADR-0002) when a function value reaches a
  camelCase `on<name>` with no matching IDL property, just before it lands as a dead
  property. Self-filtering (`on-<name>` and non-`on*` names return silently) so the
  single call site after the listener-resolution block stays branch-free; gated on the
  *current* value being the function so teardown doesn't re-warn.
- [x] `[S]` **Guard `clearHostAttributes`' cast** *(done)*. The `0..hostBindingOffset`
  loop now checks `binding.type === BINDING_TYPES.ATTR` before `removeAttributeBinding`,
  so a future non-ATTR binding in that range can't be force-cast into the shape switch.
- [x] `[M]` **Diff name-only (object) attributes** *(done)*. `updateExpandable` splits
  into `applyExpandable` (first render / array / shape change) and
  `diffExpandableObjects` (same-shape object update). Unchanged object entries
  (`old === new`) are skipped entirely — a stable spread listener is no longer
  detached+reattached every render. **Bench-gated** vs HEAD: object spread −24% to −87%
  (−86% on a 10-key set with one key flipping, −40% keeping a stable listener while a
  sibling class flips). The **array** path was deliberately *not* diffed: an array-membership
  diff measured **+22%** on full alternation because the `indexOf` scan (2·N·M comparisons)
  costs more than the cheap value-less add/removeAttribute it guards — arrays fall back to
  clear-all + apply-all. New test pins object-listener survival.
- [x] `[M]` **Multi-value attr listener leak — invariant confirmed** *(done, no code
  change)*. Multi-value paths route the value through `bindingToString`, which always
  yields a string, so a function can never reach the listener path and no listener is
  ever attached — there is nothing to leak. Passing `oldValue` would be dead code;
  documented the invariant on both multi-value update functions instead.
- [x] `[L]` **Rule 8:** replaced the `updateAttribute` / `removeAttributeBinding` twin
  switches with one **per-shape unit** model *(done)*. Each shape is a single
  `{ apply, remove }` const (`staticAttr`, `expandableAttr`, …) holding both halves
  together so they can't drift on what names the shape owns; two shapes that share a
  remove reference one helper (`removeStaticName` / `removeDynamicName`). A single
  `handlerForShape` `switch` over the dense `ATTRIBUTE_SHAPE` enum (jump table) returns
  the unit; both entry points dispatch through it. Behavior-identical, 688 tests green,
  bench-gate clean (object-spread wins hold; no dispatch regression above the noise
  floor).

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
