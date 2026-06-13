# Update machinery — how the three capabilities interact

The render machinery is **three structs in one acyclic line**: `Scheduler → Producer → Painter`.
Each layer points only *down*. The `update()` settle signal travels back *up* through a **returned
Promise**, never a back-edge — so there is no cycle and nothing needs a `!`-asserted parent pointer.

`Task<Producer>` sits underneath `Producer` as the generic generator driver; the `commit` strategy
(`clientCommit` / `serverCommit`) is the single piece of per-mode data.

```
                                  ┌───────────────────────────┐
                                  │      BaseElement           │   (the custom element)
                                  │  #painter #producer         │
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
        │    do { dirty=false; await pullProducer(producer) }     │         │
        │    while (dirty)                                       │         │
        └───────────────┬───────────────────────────────────────┼────────┘
                        │ calls down                              │ resolves up
            pullProducer(producer)                                  │ (the RETURNED promise —
                        │                                         │  the only upward signal)
                        ▼                                         │
        ┌───────────────────────────────────────────────────────┴────────┐
        │  PRODUCER                         (one struct, both modes)       │
        │  { rootTask, currentTask, createCurrent,                         │
        │    settleResolve, commit, painter }                              │
        │                                                                  │
        │  pullProducer: settleResolve = resolve; re-run createCurrent     │
        │    • static (recipe null) → resolveSettle now                    │
        │    • render-fn  → commit + resolveSettle now                     │
        │    • generator  → spawn child; it settles later via onSettle     │
        │                                                                  │
        │   drives ▼ Task(s)                  settle ▲ resolveSettle()      │
        │  ┌──────────────────────────────┐   (fires settleResolve once,   │
        │  │  TASK<Producer>  (depth 0/1) │    a no-op on the server)       │
        │  │  generator driver, depth-    │                                 │
        │  │  aware. hooks:               │                                 │
        │  │  onYield  → producerYield ───┼──► producer.commit(producer, v) │
        │  │   onError  → producerError   │      │  (the ONLY per-mode spot) │
        │  │  onSettle → producerSettle ──┼──────┘                          │
        │  └──────────────────────────────┘                                 │
        └───────────────────────┬──────────────────────────────────────────┘
                                │ commit calls down (never back up)
              clientCommit │ serverCommit   (two exported strategies; element picks one)
                                ▼
        ┌──────────────────────────────────────────────────────────────────┐
        │  PAINTER                          (leaf; survives a reconnect)     │
        │  { host, renderedTemplate, attributeObserver?, hydratePending }    │
        │                                                                    │
        │   paint(painter, value)         ← clientCommit: patch-or-replace,  │
        │                                   observer bracket, continuous     │
        │   serverPaint(painter, value)   ← serverCommit: hydrate-or-produce │
        │                                   once + flushHostPayload          │
        └───────────────────────────────┬───────────────────────────────────┘
                                        │ writes
                                        ▼
                                  host.shadowRoot   (the DOM)
```

> Diagram labels are conceptual: `producerYield` is the real shared hook, but `onError`/`onSettle` are
> inlined closures — they call `reportProducerError` / `resolveSettle`, there are no standalone
> `producerError` / `producerSettle` functions.

## The two directions, kept separate

| Direction | Mechanism | Why it's safe |
|-----------|-----------|---------------|
| **Down (drive):** Scheduler → Producer → Painter | direct calls (`pullProducer`, `commit`, `paint`) | each layer knows only the layer below — a straight line |
| **Up (settle):** Painter-done → Producer → Scheduler | the **Promise returned by `pullProducer`** resolves when `resolveSettle` fires | no struct holds an upward reference; the promise IS the signal, so the graph stays acyclic |

## Where the modes differ — exactly one field

Everything above is identical on client and server **except `producer.commit`**:

- **client** → `createProducer(painter, clientCommit)` → `paint` (continuous; observer; never one-shot)
- **server** → `createProducer(painter, serverCommit)` → `serverPaint` once, then cancels both task
  layers — that cancel (their `finished` flag) is what makes it one-shot; there is no `done` field.
  The Scheduler is never built (`#scheduler` stays null), so the whole
  upper layer is simply inert: `settleResolve` stays null ⇒ `resolveSettle` is a no-op, `pullProducer`
  is never called. No flag, no branch — the absent scheduler and the swapped `commit` are the whole
  difference.

## ADR-0003 contract, read off the diagram

`update()` returns `flushPromise`. That promise resolves only when `runFlushLoop` exits, which only
happens after `pullProducer` resolves (DOM landed) **and** `dirty` is false (no update arrived
mid-flight). So `await update()` resolves once *this* call's DOM is on screen, coalescing every
concurrent update — across sync and async renders.
