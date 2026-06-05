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

- [ ] **Make the `update()` state machine span the whole async render, not just the
      synchronous dispatch window.** See ADR-0003. Today `update()` in `src/index.ts` sets
      `RENDERING`, calls `dispatchCSRUpdate` *synchronously*, and flips back to `IDLE` in
      `finally` — but `dispatchCSRUpdate` returns the moment the driver (`sources.ts` `step`)
      suspends on a Promise, so `updateState` goes `IDLE` while an **async** render is still
      in flight. Two consequences to fix:
      - **Await resolves too early for every async render** (not just coalesced calls): the
        promise settles when the synchronous slice returns, not when the async DOM lands.
        56 call sites `await update()`; this is the flaky-test source.
      - **Coalescing doesn't span async flight**: during an in-flight async render
        `updateState` is already `IDLE`, so the next `update()` re-fires and *supersedes* —
        correct result (the `handle.finished` guard prevents stale commits) but it is
        restart-churn, not batching.
      Fix (surface unchanged): the state machine must track the source's **settle** signal,
      not the synchronous return of `dispatchCSRUpdate`. `IDLE → SCHEDULED` (queue microtask,
      return shared `flushPromise`); `SCHEDULED → ` return the same promise (coalesce, as
      today); `RENDERING → ` set a `dirty` bit and return the same promise (do **not** drop,
      do **not** restart). On settle: if `dirty`, re-run once with a fresh pull (coalescing
      everything that arrived mid-flight); else `IDLE` and resolve `flushPromise`. The
      driver-level supersession (`handle.finished`) stays as the safety net for *external*
      source swaps. Contract to ratify: "`update()` resolves once the DOM reflects this call,
      coalescing with any concurrent update, across sync **and** async renders."

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

- **Re-entrant `update()` during a render: defer how far?** An `update()` fired while
      `updateState === RENDERING` currently hits the `!== IDLE` shortcut and is **dropped**.
      The async-spanning rework above changes this: a mid-flight `update()` sets the `dirty`
      bit and re-runs after settle (defer, not drop). That answers the *missed-update* half —
      but reopens the *infinite-loop* half: a render that **always** calls `update()` would
      set `dirty` on every settle and re-run forever. So the remaining decision is whether a
      render-time `update()` is legal at all (it is a side effect during what should be a
      pull) and, if so, whether the `dirty` reflush needs a same-frame loop guard. Decide
      alongside ADR-0003's implementation; see the rework item above.

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
