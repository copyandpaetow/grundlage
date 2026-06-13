# Update machinery — how the three capabilities interact

The render machinery is **three structs in one acyclic line**: `Scheduler → RenderState → Painter`.
Each layer points only _down_. The `update()` settle signal travels back _up_ through a **returned
Promise**, never a back-edge — so there is no cycle and nothing needs a `!`-asserted parent pointer.

`GeneratorRun` sits underneath `RenderState` as the generator driver (depth 0 = the outer generator,
depth 1 = the inner generator, both the same primitive). The `writeToDom` strategy
(`writeToDom` on the client / `writeToServerDom` on the server) is the single piece of per-mode data.

```
                                  ┌───────────────────────────┐
                                  │      BaseElement           │   (the custom element)
                                  │  #painter #renderState      │
                                  │  #scheduler                │
                                  └─────────────┬─────────────-┘
                       update() ────────────────┤  connectedCallback wires the stack;
                                                 │  update() drives only the Scheduler
                                                 ▼
        ┌───────────────────────────────────────────────────────────────┐
        │  SCHEDULER                       (client only; null on server)  │
        │  { flushPromise, dirty }                                        │
        │                                                                 │
        │  update() gate (inline in the element):                         │
        │    • open batch  → runFlushLoop  • already open → set dirty     │
        │    • returns the shared flushPromise  ───────────────┐         │
        │                                                       │         │
        │  runFlushLoop:  await null  (coalesce window)         │         │
        │    do { dirty=false; await rerunCurrentRenderer(s) }   │         │
        │    while (dirty)                                       │         │
        └───────────────┬───────────────────────────────────────┼────────┘
                        │ calls down                              │ resolves up
            rerunCurrentRenderer(state)                           │ (the RETURNED promise —
                        │                                         │  the only upward signal)
                        ▼                                         │
        ┌───────────────────────────────────────────────────────┴────────┐
        │  RENDERSTATE                      (one struct, both modes)       │
        │  { outerRun, currentRun, currentRenderer,                        │
        │    pendingUpdateResolve, writeToDom, painter }                   │
        │                                                                  │
        │  rerunCurrentRenderer: pendingUpdateResolve = resolve;           │
        │    re-run currentRenderer                                        │
        │    • static (renderer null) → finishUpdate now                   │
        │    • render-fn  → paint + finishUpdate now                       │
        │    • generator  → start inner run; it finishes later via         │
        │                   signalRunFinished                              │
        │                                                                  │
        │   drives ▼ GeneratorRun(s)          settle ▲ finishUpdate()      │
        │  ┌──────────────────────────────┐   (fires pendingUpdateResolve  │
        │  │  GENERATORRUN  (depth 0/1)   │    once, a no-op on the server) │
        │  │  generator driver, depth-    │                                 │
        │  │  aware. the driver calls     │                                 │
        │  │  directly (no hooks):        │                                 │
        │  │  handleYieldedValue ─────────┼──► state.writeToDom(state, v)   │
        │  │  handleRendererError         │      │  (the ONLY per-mode spot) │
        │  │  signalRunFinished ──────────┼──────┘                          │
        │  └──────────────────────────────┘                                 │
        └───────────────────────┬──────────────────────────────────────────┘
                                │ writeToDom calls down (never back up)
              writeToDom │ writeToServerDom   (two exported strategies; element picks one)
                                ▼
        ┌──────────────────────────────────────────────────────────────────┐
        │  PAINTER                          (leaf; survives a reconnect)     │
        │  { host, renderedTemplate, attributeObserver?, hydratePending }    │
        │                                                                    │
        │   paint(painter, value)         ← writeToDom: patch-or-replace,    │
        │                                   observer bracket, continuous     │
        │   serverPaint(painter, value)   ← writeToServerDom: hydrate-or-    │
        │                                   produce once + flushHostPayload  │
        └───────────────────────────────┬───────────────────────────────────┘
                                        │ writes
                                        ▼
                                  host.shadowRoot   (the DOM)
```

> Since the task→producer merge there are **no behaviour hooks**: the driver in `GeneratorRun`'s
> `step` calls `handleYieldedValue` / `handleRendererError` / `signalRunFinished` directly, all in the
> same `generator-layer.ts` file. A yield's whole journey reads top-to-bottom with go-to-definition
> working at every hop.

## The two directions, kept separate

| Direction                                               | Mechanism                                                                             | Why it's safe                                                                              |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| **Down (drive):** Scheduler → RenderState → Painter     | direct calls (`rerunCurrentRenderer`, `writeToDom`, `paint`)                          | each layer knows only the layer below — a straight line                                    |
| **Up (settle):** Painter-done → RenderState → Scheduler | the **Promise returned by `rerunCurrentRenderer`** resolves when `finishUpdate` fires | no struct holds an upward reference; the promise IS the signal, so the graph stays acyclic |

## Where the modes differ — exactly one field

Everything above is identical on client and server **except `state.writeToDom`**:

- **client** → `createRenderState(painter, writeToDom)` → `paint` (continuous; observer; never one-shot)
- **server** → `createRenderState(painter, writeToServerDom)` → `serverPaint` once, then cancels both
  run layers — that cancel (their `finished` flag) is what makes it one-shot; there is no `done` field.
  The Scheduler is never built (`#scheduler` stays null), so the whole
  upper layer is simply inert: `pendingUpdateResolve` stays null ⇒ `finishUpdate` is a no-op,
  `rerunCurrentRenderer` is never called. No flag, no branch — the absent scheduler and the swapped
  `writeToDom` are the whole difference.

## ADR-0003 contract, read off the diagram

`update()` returns `flushPromise`. That promise resolves only when `runFlushLoop` exits, which only
happens after `rerunCurrentRenderer` resolves (DOM landed) **and** `dirty` is false (no update arrived
mid-flight). So `await update()` resolves once _this_ call's DOM is on screen, coalescing every
concurrent update — across sync and async renders.
