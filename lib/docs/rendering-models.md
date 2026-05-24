# Rendering pipeline — design sketches

Three structural alternatives considered before settling on the current `sources.ts` + `csr-runtime.ts` + `ssr-runtime.ts` split. Captured here so a future redesign starts from the options, not a blank page.

The constraints all three respect:

- root generator selects, leaf produces templates, updates re-run the leaf only
- SSR contract: paint the first renderable yield, then cancel both layers
- inner generators may yield templates or render-functions, never another generator
- errors from the leaf bubble to the root for try/catch recovery

## Model 1 — Source as a continuation (CPS)

One shape for every source:

> A source is a function that takes the host and a `render` callback, produces zero or more templates by calling `render`, and returns a cancel handle.

```ts
type Source = (host, render, onError) => Cancel;
```

Three factories — `staticSource(template)`, `renderFunctionSource(fn)`, `generatorSource(createGen)` — all return that shape. Runtime holds one current source and one cancel handle. `dispatchUpdate` becomes "cancel, re-invoke." Root keeps a tiny dispatcher because its yields mean "what kind of source to install," not "what to render."

SSR drops out: its `render` callback is one-shot — first call paints and flips a flag, subsequent calls no-op.

The drive loop lives only inside `generatorSource` — the one place async/promise/throw mechanics need to exist.

**Cost:** one closure per install (the cancel handle captures runtime state). Installs are uncommon, but generator updates re-invoke the factory each tick — measure before committing if the component churns.

## Model 2 — Stack of frames

Stop modeling "root slot + current slot." Model a **stack of one or two frames**, where the top frame is what's currently producing templates and the bottom is the root waiting for it to finish or be replaced.

```ts
type Frame =
  | { kind: "static" }
  | { kind: "renderFunction"; fn }
  | { kind: "generator"; createGen; generator; generation; cleanup };

interface Stack { frames: Frame[]; }   // depth 1 or 2 today, model supports more
```

When the root yields a producer, push a frame. When it completes, pop. When `update()` fires, restart the top frame. Errors propagate up the stack in one direction. Cancellation is "drop frames above N."

Static and render-function frames are stored as typed stack entries (not wrapped in synthetic generators) to keep allocations down.

**Cost:** the stack is conceptually cleaner but the implementation still needs a tag-switch on the top frame. You save the *two-slot* duplication (cancellation, error, generation each existed twice), not the per-kind switch. Pays its complexity budget on extensibility (depth > 2) that the spec doesn't ask for.

## Model 3 — Mode-specialized runtimes

Two runtimes from the start: `CSRRuntime` and `SSRRuntime`, decided in the constructor. They share the slot primitive and `drive()`, but the orchestration is monomorphic to each mode.

- **CSR runtime**: no `renderMode`, no `isServer()` check, no `finalizeServerRender`. The hot path is shorter and branch-free.
- **SSR runtime**: no `attributeObserver`, no `update()` machinery, no shape-hash patch loop. Renders once, finalizes, throws away.

The custom element's `update()` and `connectedCallback` either delegate to the runtime or short-circuit based on its type.

**Cost:** some duplication in `renderToDom`-equivalents (the hydrate branch lives only in SSR; the patch-in-place path lives only in CSR — which is actually correct, since SSR runs once and never patches). Doesn't touch the slot/yield duplication.

## Notes for a future redesign

- **Model 1 + Model 3** is the deepest cut. CPS kills the slot tag and the install/dispatch fan-out; mode-specialized runtimes give SSR a real home and let the CSR hot path drop every server-side branch. This is the combination that shipped.
- Model 2 is the most elegant on paper. Worth revisiting if the spec ever needs deeper nesting than root → leaf.
- Allocation cost of Model 1 was the main risk; verified at integration-time that per-install allocations stayed under the budget because the runtime stores callbacks/context on the handle struct instead of closing over them.

## Race surfaced by Model 1 that any future iteration must respect

The synchronous install chain runs **before** the caller can store the handle:

```ts
runtime.rootHandle = createRootHandle(...);   // first
beginHandle(runtime.rootHandle);              // then drive
```

If you combine the two into a single `installRoot(...)` that drives before returning, a synchronous error or yield inside the first step calls back into runtime code that reads `runtime.rootHandle` — and sees `null` because the assignment hasn't happened yet. Same applies to current-source generator installs called from root yield handlers and from `dispatchUpdate`.
