# TODO

Open work only. Landed history → [`../../CHANGELOG.md`](../../CHANGELOG.md). Durable rationale →
`CONVENTIONS.md` / `docs/adr/`.

**Bench-gate discipline** (from `VALUE_KIND`): every change pays into _perf_ or _clarity_ and
regresses neither. Items tagged **`⟂bench-gate`** need a p75 A/B on the construction /
list-reconciliation benches, not just steady-state `update()`. Complexity tags: `[S]`/`[M]`/`[L]`.

---

## Change detection — staying on the hash engine

The committed-state rewrite was prototyped and **rejected** (see `CHANGELOG.md`). We stay on the
hash engine and re-apply only these independent wins as clean commits:

- [ ] `[S]` **Comment binding in-place patch.** `renderComment` destroy/recreates the node
      (`content.ts`); patch `.data` instead — 4.25× on changing multi-expression comments. Needs no
      stored state:
      `const node = marker.nextSibling; isComment(node) ? node.data = value : marker.after(new Comment(value))`.
- [ ] `[M]` **Drop `expressionToBinding`; per-binding update loop.** Iterate bindings, rebuild one
      if any feeding expression changed (`===`) — replaces the reverse map _and_ the `dirtyBindings`
      bitset (`template-html.ts`). Parser + renderer change together. ⚠️ Pure-`===` loses the
      fresh-but-equal-object skip `hashValue` gave — keep a one-level object compare or accept the
      re-apply deliberately. **`⟂bench-gate`**.
  - With this we can iterate the binding and abort early in multi expression bindings when a change is already
    detected
- [ ] `[S]` **`isSameTemplate` / `paint()` by `parsedHTML` ref** instead of `templateHash` — one
      pointer compare, collision-free. (Does not remove `templateHash`; it still folds into the list
      row-hash.)
- [ x ] `[S]` **Cross-type hash collisions** (`0`/`false`, `1`/`true`, ref-ids vs raw numbers reuse
  the wrong DOM). Mix a type tag into every `hashValue` branch; spread ref-counter ids out of the
  dense low-int range.
- [ ] `[M]` **Slot-diff hash-pair → short-circuiting deep-equal** in `updateTemplate` — exact,
      collision-free, less work on the changed path; keeps `hashValue` for `renderList`.

## Bugs

- [ ] `[S]` **Unpadded dynamic comment renders as visible text.** `updateContent`
      (`content.ts`) tells "comment" from "text" content only by `binding.values.length > 1`,
      so a single-expression comment with no literal padding — `html\`<!--${x}-->\``— folds to`values.length === 1`, takes the text-node path, and renders the value as **visible DOM**
between the markers. `<!-- ${x} -->`only works because the spaces push`values.length` to
  3. The parser knows it's a comment (`STATE.COMMENT`in`createBinding`) but discards that —
     comment and text both return `BINDING*TYPES.CONTENT`. Fix with a real discriminator (a
     comment flag or a distinct comment binding type); fold into the `ValuesBinding`
      two-type-tag cleanup under \_Render engine — simplification* so COMMENT becomes its own tag.
      Confirmed: `<!--${x}-->` produced a text node, `<!-- ${x} -->` a comment node.
- [ ] `[S]` **`updateTag` rebuilds once for non-lowercase dynamic tag names.** The
      `newTag === element.localName` guard (`tag.ts`) never matches a mixed/upper-case name —
      `localName` is always lowercased — so `<${"DIV"}>` rebuilds from the `<div>` placeholder on the
      first flush, dropping focus/selection for nothing. `createElement` lowercases anyway; compare
      `newTag.toLowerCase() === element.localName`.
- [ ] `[S]` **`setProperty` double-updates complex values.** `index.ts` calls `applyAttributeBinding`
      then `update()`, but for a non-stringable value `applyAttributeBinding` already calls `update()`
      (the `"update" in element` branch fires — the host carries `update`). Coalesced so harmless, but
      redundant; drop one path.
- [ x ] `[S]` **`await update()` hangs on root supersession of an in-flight child** — _resolved by the
  engine rework; keep until the checkbox is cleared._ Old failure (`generator-layer.ts`): the root
  superseded a parked child but no terminal resolved its `update()` promise, so the DOM landed while
  the promise hung. Now every terminal funnels through `resolvePendingUpdatePromise` (`engine.ts`):
  inner `COMPLETED` resolves the superseding render, and `stopEngine` / `cancelEngineAndNotifyHost`
  cover teardown and error. Regression-pinned by _"await update() resolves when it supersedes an
  in-flight async render"_ in `__tests__/flush-supersession.dom.test.ts`.

## Render engine — simplification

- [ ] `[S]` **`paint()` observer bracket → `takeRecords()`** (`painter.ts`); type `value` as
      `unknown`; share the `isTemplate(value) ? value : html\`${value}\`` coercion.
- [ ] `[S]` **Parser end-of-attribute helper** (`html.ts`): one `endAttribute(...)` for the 7
      near-identical capture/reset blocks; extract `createAttributeBinding()`. ≈ −50 LOC, no behavior
      change.
- [ x ] `[M]` **Fold Scheduler into the engine** — _done by the rework; keep until the checkbox is
  cleared._ `scheduler.ts` is deleted; `flushPromise`/`dirty` now live on the `Engine` struct
  (`pendingUpdate` / `scheduled`) in `engine.ts`, scheduled via `scheduleNextUpdate`. The server no-op
  gate is no longer a null-scheduler check — SSR routes through `startServerEngine` (`isServer()` in
  `index.ts`), which never schedules.
- [ x ] `[S]` **Dead code:** `UPDATE_STATE`, `RUNTIME_KIND` (`constants.ts`); `TagBinding.endValues`
  (written at parse time, never read).
- [ ] `[S]` _(cosmetic)_ `RawContentBinding` + `ContentBinding` are structurally identical — one
      `ValuesBinding` with two type tags if they never diverge.

## Tags

- [ ] `[L]` **Restoring an element drops internal state** (its own and children's: listeners, focus,
      scroll, animation progress). Restore as faithfully as possible.

## List rendering

- [x] `[L]` **List rendering via hash side-channel, no per-item wrapper** (ADR-0011) — _keep until
      the checkbox is cleared._ Landed in `list.ts` (extracted from `content.ts`): `renderList` diffs the
      live user array against the prior render's per-item hash row (`listItemHashes[expressionIndex]` on
      the template — no `WeakMap` side-table, no carriers), reconciles over a **parallel hash array**
      (`hashValue` per entry, reused across peel/claim), and **dispatches at the leaf** on insert —
      `HTMLTemplate` → `setupTemplate`, nested array → engine wrapper, primitive → bare text node (no more
      `toTemplateList`). A changed item is **rebuilt fresh**, never updated in place. The user's array is
      never mutated. Same-reference in-place mutation (`items.push(x); update()`) is seen because the
      array slot folds its content in `updateTemplate` and re-enters reconciliation on a changed fold —
      pinned by _"re-renders a list mutated in place on the same array reference"_ (`content.browser.test.ts`).
      The **fold-and-early-out** (formerly the optional remainder) landed as the fold-gate: `updateTemplate`
      folds the array, gates the dirty bit, and an unchanged list never enters `renderList` at all — no
      marker walk, no allocation. Bonus: the same gate bails an unchanged **array attribute spread**
      (3.4ns → 0.1ns). Changed lists fold twice (gate + per-item), near-free via memoized `template.hash`.
- [ ] `[L]` **Define the marker-pair range walk once** — route `deleteNodesBetween`, `findTargets`,
      `renderList` collection, and `removeItemDom`/`moveItemAfter` through it so the stop-conditions
      can't drift.

## Loader / SSR

- [ ] `[M]` **Warn on SSR `load` replay drift.** Unkeyed `load` replays positionally; conditional or
      nested calls can hand the wrong `data-ssr` payload to the wrong `load`. `console.warn` when
      detectable. Keep the positional default + `key` opt-in (ADR-0002).

## Error handling

- [ x ] **Extract one fatal-display path** — done by the rework. CSR and SSR both funnel through the
  single `writeFatalErrorIntoShadow` in `engine.ts` (via `cancelEngineAndNotifyHost`); there is no
  second SSR-side display path.

## concistency

- [ ] \*\*Enums should either be const with GROUPNAME_NAME or objects with GROUPNAME.NAME but not both

## CSS

- [ ] `[L]` **Fast dynamic CSS via custom-property value-indirection** (plan:
      [`css-value-indirection-plan.md`](css-value-indirection-plan.md), ADR-0008). Keep the sheet static
      and route every dynamic value through a `setProperty`'d custom property, killing the per-frame
      raw-content reparse (measured 20–30 → 90–100fps on the cube editor).
- [ ] `[L]` _(lower)_ Allow styles added directly as a class on a component / an alternate style
      registration.

## Cold-start

- [ ] `[L]` **Part B — build-time `html` compiler** (plan:
      [`html-compiler-plan.md`](html-compiler-plan.md); Part A landed). Move `parse()` to build time for
      static literals without an API change; runtime parser stays as fallback.

## Public API (breaking — pre-1.0)

- [ ] `[M]` **Rename `render` → `component`** (the factory builds a custom-element constructor — it
      does not render). Touch `index.ts`, type names, README, `llms.txt`, `CONCEPT.md`, tests, `website/`.
- [ ] `[M]` **Rename `host.setProperty` → `host.setProp`** (write-twin of `props`, singular).

## Docs

- [ ] `[S]` `props` / `setProp` are two halves of one model, both obeying attribute-vs-property
      (primitive → attribute, complex → property). State the rule once.
- [ ] `[S]` Object/array/function props are read from the **property only** — an attribute string
      like `tags='[1,2]'` is never parsed.
- [ ] `[S]` Document the **`await update()` settle contract** — it settles on generator completion,
      so a long-lived `for await` current generator gets a hanging update promise.

## Deferred (need ADRs)

- **`#flush` is O(all bindings).** A dirty-index queue makes it O(dirty) but trades a cache-friendly
  `Uint8Array` scan for a per-update allocation — only wins when binding count is high _and_ dirty
  count low. Measure on large static templates. **`⟂bench-gate`**.
- **Structural debts:** `targets` megamorphic union + two index spaces; `SourceHandle` nullable
  fields / `!` asserts; CSR/SSR install duplication. Measure whether the `targets` union is a real
  perf cost before surgery.

## Open questions

- Should event-handler functions be passed down as props too?
- Re-entrant `update()` during a render — defer how far? Is a render-time `update()` legal, and if
  so does the reflush need a same-frame loop guard? Decide alongside ADR-0003.
- Light-DOM (no-shadow) components — touches the error/containment contract and host-attr/slot
  behavior.
- `<host>` element vs host attributes on the root `<template>`? Keep `<template>` for now (aligned
  with Declarative Shadow DOM).
