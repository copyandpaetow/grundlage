# Rendering pipeline

How a component goes from `render(generator)` to pixels on screen, and how subsequent updates patch the DOM in place. This is the implementation that shipped; for the alternatives that were considered, see [`rendering-models.md`](./rendering-models.md).

## Two layers per component

Every running component has two layers active at the same time:

- **Root source.** The generator the user passed to `render()`. It runs once per connection. Each `yield` decides what kind of producer should sit in the current slot.
- **Current source.** Whatever the root most recently installed. This is the thing that actually produces `HTMLTemplate` instances that hit the DOM.

```
root generator  ─▶  installs ─▶  current source ─▶  HTMLTemplate ─▶  DOM
   (runs once)                   (re-runs on update())
```

A current source can be one of three shapes:

| Shape              | Lifetime    | Re-runs on `update()`?                       |
| ------------------ | ----------- | -------------------------------------------- |
| Static template    | zero        | no, the value is frozen                      |
| Render function    | one call    | yes, the function is called again            |
| Inner generator    | live        | yes, the generator is restarted from scratch |

`update()` targets the current source only. The root never re-runs.

## SourceHandle: one struct, three producers

`sources.ts` collapses all three producers into a single struct, `SourceHandle`. The struct carries every field a live generator needs (its iterator, the render callback, the yield handler, the error handler) and zero closures. All behavior goes through free functions: `beginHandle`, `cancelHandle`, `throwIntoHandle`. The internal `step` function is the generator driver.

Static templates and render functions share a single `FINISHED_HANDLE` sentinel. They have no lifetime to manage, so the install path renders synchronously and returns the sentinel without allocating anything.

The struct shape means there is no per-install closure for live generators either. The host, context, render, onYield, and onError are all stored as fields; `step` and the yield/error callbacks read them off the handle.

## The driver loop

`step(handle, next)` is the only place that knows about Promises, throws, and the `done` flag. It loops synchronously through sync yields, suspends when a Promise crosses the boundary, and finalizes when the generator completes, throws uncaught, or is cancelled externally.

Two invariants matter:

1. **handle.finished is checked at every resume point.** A pending `.then` belonging to a swapped-out handle has nowhere to go; checking `finished` makes it a no-op.
2. **`onYield` may install a new source or render a template.** Either action can re-enter the runtime through user code and synchronously mark the handle finished. The driver re-checks `finished` before stepping the iterator again, otherwise it would shadow the real error by calling `.next()` on a dead handle.

The only unavoidable per-iteration allocation in steady state is the two `.then` closures around each `await`.

## CSR runtime

`csr-runtime.ts` is the hot path. It owns:

- `rootHandle` and `currentHandle`, the two layers above
- `createCurrent`, kept alongside `currentHandle` so `update()` can restart a generator or re-call a render function without consulting the root
- `renderedTemplate`, the last `HTMLTemplate` painted into the shadow root
- `attributeObserver`, the `MutationObserver` that turns external host-attribute writes into `update()` calls
- `hydratePending`, true on the first render after a prerendered shadow root was attached

`update()` (defined in `index.ts`) batches calls via a microtask, then calls `dispatchCSRUpdate`. Dispatch cancels the current handle and re-installs it from `createCurrent`. The `cancelHandle` step runs any cleanup the generator captured via `return cleanupFn`.

The render callback is `renderTemplate`. Its hot path is the shape-hash check: if the new template's `templateHash` matches the previously rendered one, the binding positions are guaranteed compatible and we call `previousTemplate.update(currentExpressions)` to patch in place. Only a shape change or the first render takes the cold path that swaps the shadow root's children.

A subtle detail lives in the observer bracket around the DOM write. Disconnecting the observer is only paid when the template carries host bindings; the bracket is purely synchronous so no legitimate user mutation can slip through the gap.

## SSR runtime

`ssr-runtime.ts` is one-shot. The render callback `renderOnce` paints the first renderable yield, drains the `loadData` buffer, and cancels both layers. Anything past that first yield is abandoned.

The SSR runtime has no `update()`, no `MutationObserver`, no shape-hash patch loop, no error recovery model. Every error tears the whole runtime down because there is no second render to recover into.

Two install-ordering subtleties carry over from CSR:

1. The runtime assigns `rootHandle` (or `currentHandle`) **before** calling `beginHandle`. A synchronous error or yield during the first step calls back into the runtime, which must read the field. Assigning after `beginHandle` would race.
2. `handleRootYield` receives the `rootHandle` as a parameter. On the very first call, `runtime.rootHandle` is still `null` (the assignment in `startSSRRoot` hasn't returned). The parameter version is always valid.

## Error contract

CSR errors bubble in one direction: from the current source up to the root for `try/catch` recovery.

- If the root catches the error and yields a new producer, `handleRootYield` swaps in the new current source. The previously-painted DOM stays where it is.
- If the root falls through (uncaught), the runtime calls `abortAndShowError`: cancel both handles, write the error into the shadow root, console-warn. The previously-painted DOM also stays put. That is the contract we promise users.

`reportCSRError` snapshots `currentHandle` before delivering the throw into the root, then checks afterwards whether the root recovered by installing a new current. If not, it kills the stale current that produced the throw.

SSR has no recovery path. `reportSSRError` is shared by both layers and the entry point in `index.ts`; every error path tears the runtime down.

## HTMLTemplate

`template-html.ts` owns the per-render binding state.

- `parsedHTML` is the cached parse output, shared across every instance of the same template literal.
- `targets` resolves binding indices to real DOM nodes once at `setup()` time. Host bindings come first in the array and resolve to the host element; ATTR/TAG/RAW_CONTENT bindings resolve to elements adjacent to their marker comments; CONTENT bindings hold the leading marker because they walk forward to find their matching close.
- `dirtyBindings` is a `Uint8Array`. Each entry is either 0 or 1 and is flipped on per-binding by `update()`.
- `currentExpressions` and `previousExpressions` hold the raw values. `previousExpressions` is the previous frame's expressions during an `update()` flush; the reference is dropped to `EMPTY_ARRAY` after flush so large user objects can be collected between renders in long-idle components.

The hash on `HTMLTemplate` folds the template's parsed shape with a per-expression content hash. Two templates have the same hash when their shapes match **and** every expression hashes to the same value. The hash is what `renderList` and `renderTemplate` use to decide whether a previous template can be reused without an `.update()` call.

## Bindings

Each binding type has its own update function in a per-shape file. The dispatch table lives in `template-html.ts`:

| File              | Binding type                  | What it patches                                      |
| ----------------- | ----------------------------- | ---------------------------------------------------- |
| `attribute.ts`    | `ATTR`                        | element attributes, event listeners, JS properties   |
| `content.ts`      | `CONTENT`                     | text, nested templates, lists                        |
| `raw-content.ts`  | `RAW_CONTENT`                 | `textContent` of an element (script/style payloads)  |
| `tag.ts`          | `TAG`                         | the tag name of an element (rewraps with focus save) |

The interesting per-file details (event-listener swap, the spread/cleanup of expandable bindings, the keyed reconciliation loop in `renderList`, the focus preservation in `updateTag`) are documented inline.

## Update flow, end to end

1. User mutates state and calls `host.update()`.
2. `update()` batches via `await Promise.resolve()`, flips `updateState`, and calls `dispatchCSRUpdate`.
3. Dispatch cancels the current handle (running the generator's `finally` and any captured `cleanupFn`) and re-installs it from `createCurrent`.
4. The fresh source emits a template. `renderTemplate` compares its shape hash to the last painted template.
5. **Same shape:** `previousTemplate.update(newExpressions)` walks `dirtyBindings`, calls the per-shape update function for each dirty binding. Each update reads from `currentExpressions` and writes to its pre-resolved target.
6. **Different shape:** clear host attributes from the previous template, replace shadow children with the new template's fragment.
7. `updateState` returns to `IDLE` in a `finally` so a throwing error path can't lock future updates out.

## Why this shape

- **One struct for every producer** keeps the install path branch-free in the cancel/throw/cleanup machinery. Adding a fourth producer kind is a new factory and a yield-handler case; the driver and lifecycle stay untouched.
- **Two runtimes, not one with mode flags.** SSR and CSR share `sources.ts` and the binding files, but their orchestration is monomorphic. CSR never pays a `isServer()` branch; SSR never carries an observer field.
- **No per-step allocations** beyond `.then` closures around `await`. The handle holds the callbacks; the binding update functions are free functions reading off `HTMLTemplate`; `dirtyBindings` is a single typed array, not a `Set`.
- **DOM stays put on errors.** The previously-painted shadow tree is never blown away by an error in the current source. The user can recover at the root without flicker.
