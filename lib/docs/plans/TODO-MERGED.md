# Consolidated TODO

Merge of `docs/API-REVIEW-TODO.md` (API grilling action items) and `TODO.md` (known
issues / backlog). Grouped by **code location**; within each group items run **simple →
complex**. Complexity is tagged `[S]` / `[M]` / `[L]`. Overlapping items from both files
are merged and noted.

Durable rationale lives in `CONVENTIONS.md` and `docs/adr/`; this file is disposable and
gets rewritten as items land.

> **Bench-gate discipline (learned from `VALUE_KIND`).** Several items below add an allocation
> or a comparison to a per-render or per-construction path to save work that is already cheap.
> `VALUE_KIND` looked clean and **regressed** construction **+97%** / lists **+5–14%** because
> the cost landed on the `HTMLTemplate` constructor (every literal eval + every list item)
> while the dispatch it bought came back within noise. **Rule:** every change must pay into at
> least one axis — **performance or clarity** — and must **not regress the other**. A
> clarity/consistency refactor that is perf-neutral is a ship (clarity is the win); a perf
> win that muddies the code is a ship (perf is the win); when two shapes are equally
> performant, the clearer one wins. What gets **rejected** is a regression on the axis you
> are not improving — `VALUE_KIND` traded clarity for a perf regression, so it lost. Any item
> marked **`⟂bench-gate`** therefore needs a bench — gate it against the **construction /
> list-reconciliation** benches, not just steady-state `update()`, and record the p75 deltas
> (as the attribute object-diff and `VALUE_KIND` items already do) so "perf-neutral" is
> measured, not assumed.

---

## Process (done)

- [x] `[S]` Commit `CONVENTIONS.md`. _(Phase 0)_
- [x] `[S]` Open ADRs for the deferred tradeoffs so "decided" is distinct from
  "unnoticed" (see Deferred decisions below). _(Phase 0)_

---

## Parser (`src/parser`)

- [x] `[L]` **Part A — document-free parser** _(done)_. Make `parse()` touch no DOM:
  parser state → pooled `ParserState` struct + context-first free functions; `parse()`
  returns a `result` **string seed** (`fragment: null`); materialization (`buildFragment`,
  `parserHost`) moves to the rendering layer and runs lazily on first `setup()`;
  root-template detection moves into parse-state (disqualify checks + `<template>`
  wrapper suppression + flag-driven tail reparse). Gate the struct step on `html.bench.ts`
  vs `bench/baseline.json`. Foundation for the html compiler **and** happy-dom-free SSR
  parse. Plan: [`document-free-parser-plan.md`](document-free-parser-plan.md); rationale:
  **ADR-0009** (pooled struct), **ADR-0010** (document-free). **Subsumes** the two items
  below — the non-reentrancy comment moves onto the pooled instance, and "parser returns a
  string" _is_ this work.
- [x] `[M]` **Centralize per-element scope reset** into one `resetElementScope()` so
  `selfClosing = false` and buffer-array flushing happen in one place _(done)_. Both
  `flushElement` exits route through it, draining `tagBuffer` / `elementBuffer` /
  attribute scratch and clearing `currentTagName` + `selfClosing` — the
  "scratch is empty between elements" invariant is now explicit, not a consequence of
  control flow (the suppressed root `<template>` used to leave `currentTagName` /
  `tagBuffer` dangling). _(API-review M/N TODO + TODO.md parser — same item.)_
- [x] `[L]` **Store attribute type bits in the parser** _(done)_. New
  `ATTRIBUTE_NAME_KIND` (`UNKNOWN`/`PLAIN`/`NATIVE_EVENT`/`EXPLICIT_EVENT`) +
  `eventName` on `AttributeBinding`, classified once in `completeAttribute` via
  `classifyAttributeName`; `applyAttributeBinding` takes the bits and dispatches over a
  `switch` instead of the per-write charCode cascade, with `resolveEventNameFromKey` as
  the runtime fallback for dynamic/spread names (`UNKNOWN`). Prerequisite for the
  attribute-table rework below. _(API-review Phase 3 + TODO.md attributes — same item.)_

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

- [x] `[S]` **Make unknown `on*` handlers loud** _(done)_. `warnIfDeadNativeHandler`
  fires a `console.warn` (error contract, ADR-0002) when a function value reaches a
  camelCase `on<name>` with no matching IDL property, just before it lands as a dead
  property. Self-filtering (`on-<name>` and non-`on*` names return silently) so the
  single call site after the listener-resolution block stays branch-free; gated on the
  _current_ value being the function so teardown doesn't re-warn.
- [x] `[S]` **Guard `clearHostAttributes`' cast** _(done)_. The `0..hostBindingOffset`
  loop now checks `binding.type === BINDING_TYPES.ATTR` before `removeAttributeBinding`,
  so a future non-ATTR binding in that range can't be force-cast into the shape switch.
- [x] `[M]` **Diff name-only (object) attributes** _(done)_. `updateExpandable` splits
  into `applyExpandable` (first render / array / shape change) and
  `diffExpandableObjects` (same-shape object update). Unchanged object entries
  (`old === new`) are skipped entirely — a stable spread listener is no longer
  detached+reattached every render. **Bench-gated** vs HEAD: object spread −24% to −87%
  (−86% on a 10-key set with one key flipping, −40% keeping a stable listener while a
  sibling class flips). The **array** path was deliberately _not_ diffed: an array-membership
  diff measured **+22%** on full alternation because the `indexOf` scan (2·N·M comparisons)
  costs more than the cheap value-less add/removeAttribute it guards — arrays fall back to
  clear-all + apply-all. New test pins object-listener survival.
- [x] `[M]` **Multi-value attr listener leak — invariant confirmed** _(done, no code
  change)_. Multi-value paths route the value through `bindingToString`, which always
  yields a string, so a function can never reach the listener path and no listener is
  ever attached — there is nothing to leak. Passing `oldValue` would be dead code;
  documented the invariant on both multi-value update functions instead.
- [x] `[L]` **Rule 8:** replaced the `updateAttribute` / `removeAttributeBinding` twin
  switches with one **per-shape unit** model _(done)_. Each shape is a single
  `{ apply, remove }` const (`staticAttr`, `expandableAttr`, …) holding both halves
  together so they can't drift on what names the shape owns; two shapes that share a
  remove reference one helper (`removeStaticName` / `removeDynamicName`). A single
  `handlerForShape` `switch` over the dense `ATTRIBUTE_SHAPE` enum (jump table) returns
  the unit; both entry points dispatch through it. Behavior-identical, 688 tests green,
  bench-gate clean (object-spread wins hold; no dispatch regression above the noise
  floor).

---

## Content (`src/rendering/content.ts`)

- [x] `[S]` **Rule 5:** unify `EMPTY_ARRAY` (template-html) + `EMPTY_PREVIOUS` (content)
  into one exported `EMPTY_EXPRESSIONS` _(done)_. Lives in its own leaf module
  (`empty-expressions.ts`, imports nothing) so it stays **outside** the
  template-html ↔ content ↔ attribute import cycle — homing it in `template-html.ts`
  tipped that cycle's init order and left `updateByType` holding `undefined` callbacks.
- [x] `[S]` **Rule 5:** fix the `previous === undefined` first-render branch to read the
  unified sentinel explicitly _(done)_. `updateContent` now branches on
  `previousExpressions === EMPTY_EXPRESSIONS`; a previously-`undefined` expression (not
  first render) falls through to the existing clear-and-insert path with the same result.
- [x] `[M]` **Rule 14:** `EXPANDABLE` now stores its expression slot in `values[0]` like
  every other shape _(done)_. The parser relocates `keys[0] → values[0]` in
  `completeAttribute` right after shape classification; the two runtime consumers
  (`expandableAttr.write`, `removeExpandable`) read `values[0]`. The `as number` cast
  stays — `values` is `Array<number | string>`, so every shape's slot read casts the same
  way; consistency was the win, not cast removal.
- [x] `[M]` **Rule 5/4:** replaced the 5 `previousExpressions.length > 0/=== 0` checks in
  `attribute.ts` with one model _(done)_: identity against the shared `EMPTY_EXPRESSIONS`
  sentinel (`!==` / `===`). One source of truth, and an identity compare is cheaper than
  the `.length` probe it replaced (no property load). No helper — the user prefers a
  shared const over an indirection layer.
- [x] `[M]` **Rule 15 + Rule 8 (VALUE_KIND):** _measured, rejected — no code change._ The
  idea: classify each content expression's kind (`TEXT`/`NULLISH`/`TEMPLATE`/`LIST`) once
  in `update()`/`setup()` into a per-template `Uint8Array`, then dispatch `updateContent`
  over a table keyed by it (replacing the `== null` / `instanceof HTMLTemplate` /
  `Array.isArray` cascade). Implemented in full and **bench-gated against a pinned local
  baseline**: **0 improvements, 22 regressions** (61 within noise). The `Uint8Array`
  allocation in the `HTMLTemplate` constructor regressed template **construction** up to
  **+97.6%** (`html\`…\``cached) / **+48.8%** (warm-cache construction across the board)
and **list reconciliation +5–14%** (one array per item); the dispatch saving itself came
back **within noise** even on a purpose-built "10 text slots, all change" bench. The
classification isn't already computed in`update()`'s probe (it lacks the
`instanceof`/null split) and the dispatch it replaces isn't an expensive re-probe, so
neither leg of Rule 15's caveat holds — the **perf-veto** wins. Current inline cascade in
`updateContent` stays.
- [x] `[L]` **Rule 13:** resolved the `renderTemplate` / `renderTemplate` / `renderOnce`
  naming tangle _(done)_. The same-role CSR/SSR callbacks (`renderTemplate` on csr,
  `renderOnce` on ssr) are unified as **`renderRoot`** in both layers — aligns with the
  existing `handleRootYield` / `rootHandle` / `startSSRRoot` vocabulary. This frees the
  name `renderTemplate` for the content.ts helper, which keeps it (fits its local
  `renderList` / `renderComment` / `renderTemplate` family) and no longer collides.

> _Value-kind classification resolved:_ the **attribute** half landed at parse time
> (`ATTRIBUTE_NAME_KIND` on the binding); the **content** half (`VALUE_KIND` on `update()`)
> was measured and rejected (see the VALUE_KIND item above). No remaining "one pass" work.

---

## Tags (`src/rendering/tag.ts`)

- [x] `[M]` **Don't update a tag if it is identical** _(done)_ — `updateTag` now bails on
  `newTag === element.localName` before any rebuild. Bare `===` as the bench-gate
  demanded (no hash). **Gate (two runs):** the identical-tag setup path (`<${"div"}>`
  resolving to the parser's `<div>` placeholder, static attrs + 5 children) is
  **−42% / −41.7%**; every changing-tag swap bench stayed within the ±5% noise floor, so
  the guard's cost where it misses is below measurement. Side benefit: a same-name
  re-render no longer destroys focus/selection. Added a setup bench for the hit path.
- [ ] `[L]` **Restoring an element drops all internal state** (its own and its
  children's): event listeners, focus, scroll positions, animation progress. Restore as
  faithfully as possible. _(TODO.md tags.)_

---

## List rendering (`renderList`)

- [ ] `[M]` **In-place array mutation silently skips re-render.** `arr.push(x); update()`
  hits the `===` short-circuit (identity unchanged). Document the immutable-array contract
  or detect mutation. **`⟂bench-gate`** if "detect" means copying/hashing the array per
  update — that is per-render cost on the list path; prefer documenting the contract.
  _(TODO.md + API-review deferred — same item.)_
- [ ] `[L]` **Stop mutating the user's list.** `renderList` mutates the user's list
  contents in place; reconcile without mutating user data (cost: an allocation — measure).
  Needs an alternative to the current user-data manipulation. **`⟂bench-gate`** — this is
  the direct `VALUE_KIND` repeat: the copy lands per-render on the list path, exactly where
  `VALUE_KIND` bled +5–14%. Gate on `list-reconciliation.bench.ts`; expect the allocation to
  dominate. _(TODO.md list rendering + API-review "G" — same item.)_
- [ ] `[L]` **Rule 11:** define the marker-pair range walk once; route
  `deleteNodesBetween`, `#findTargets`, `renderList` collection, and
  `removeItemDom` / `moveItemAfter` through it. Forces the `deleteNodesBetween` and
  `removeItemDom` stop-conditions into agreement.

---

## Templates (`src/rendering/template-html.ts`, template-hash)

- [x] `[M]` **Rule 12:** binding index normalized — **dropped** `bindingIndex` from
  `TagBinding` _(done)_. The render path already passes the index positionally
  (`updateTag` uses its `index` param), so position is the universal model and "none
  carry it" is the symmetric reading. The lone reader was the parse-time `</${tag}>`
  close mapping; it now derives the opener's slot via `bindings.indexOf` on that cold,
  parse-once path instead of a stored field.
- [x] `[L]` **Rule 3 + 4:** `HTMLTemplate` moved onto **free functions** _(done)_ —
  `setupTemplate` / `updateTemplate` / `hydrateTemplate` / `hashTemplate` /
  `clearHostAttributes` / `isTemplate`, with all 9 `instanceof` sites, 2 white-box tests,
  and 6 benches ported. The type itself stayed a **data-only class** (fields + constructor,
  no methods) rather than becoming a struct — see the bellwether outcome below.

  **Bellwether outcome (the consistency call).** A real struct was implemented and gated three
  ways (symbol brand, numeric-field brand, no-guard). The brand check — _any_ form — measured
  **~3.5× slower than `instanceof`** on the hot `hashValue` miss and recovered **none** of the
  resulting object-hash regression; `instanceof` needs a prototype, i.e. a class. So the type
  is a **data-only class** discriminated by `instanceof`, operated on by the free functions:
  keeps the platform fast paths (`new`, `instanceof`), avoids duck-typing, and still gets the
  Rule 3 call-style. Net vs the old class: **setup −4µs, list reconciliation faster, no real
  regression** (the residual +19.6% "object value change" is ~41ns of timer quantization — its
  identical twin recovered fully under `instanceof`). The struct-conversion program does **not**
  extend here, but the **cold** structs (`CSRRuntime`, `SourceHandle`, pooled parser) are
  unaffected and stay structs — the split is principled: a class only for the one type that is
  hot, per-render-constructed, **and** sieved from arbitrary user values. Logged as a
  **provisional Rule 3 exception** in `CONVENTIONS.md`; re-evaluate when a second template type
  (`css\`\``) lands — two members make it a pattern or send it back to a struct + brand.

---

## Core / update state machine (`src/index.ts`, `src/rendering/sources.ts`)

- [x] `[L]` **Make `update()` span the whole async render, not just the synchronous
  dispatch window** (ADR-0003). **Done.** Driver fires a one-shot `onSettle` at each
  natural/error terminal in `sources.ts` (not on `cancelHandle`); runtime carries
  `dirty`/`flushPromise`/`resolveFlush`/`driving` and runs the machine via
  `scheduleFlush → runFlush → finishFlush` + `handleSourceSettle` in `csr-runtime.ts`;
  `update()` in `src/index.ts` is guards + `scheduleFlush`.
    - **Contract (now honored):** "`update()` resolves once the DOM reflects this call,
      coalescing with any concurrent update, across sync **and** async renders."
    - **Decisions:** *settle = source completion* — `await update()` on a never-returning
      generator never resolves (release via disconnect/supersession). *No reflush loop
      guard* — `dirty` is one bit (≤ one reflush per settle); an unconditional re-update
      loops the microtask queue (documented user error, like setState-in-render), never the
      stack.
    - **Tests:** `tests/integration/update-scheduling.browser.test.ts` (early-resolve,
      coalescing, mid-flight reflush, error-resolves, supersession); `async.browser.test.ts`
      dropped its redundant post-`update()` sleeps; rapid-restart `nested-generators` tests
      reframed to coalesce-don't-restart.

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

- [ ] `[L]` _(potential)_ **Isolate CSS changes** and update only the specific changed
  rule. _(TODO.md potential feature.)_
- [ ] `[L]` _(potential)_ Allow styles to be **added directly as a class** on a component
  / register styles in an additional way. _(TODO.md potential feature.)_

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
- **`#flush` is O(all bindings).** A dirty-index queue makes it O(dirty). **`⟂bench-gate`** —
  the queue is a per-update allocation replacing a linear scan over a cache-friendly,
  branch-predictable `Uint8Array`; the saving only clears the allocation when binding count is
  high _and_ dirty count is low. Measure on large static templates.
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
