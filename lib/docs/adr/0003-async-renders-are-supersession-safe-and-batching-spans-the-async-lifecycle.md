# Async renders are supersession-safe; batching spans the whole async lifecycle

Renders may be asynchronous — first-class promises, sync generators that `yield` a Promise,
and async generators are all supported producers (`src/rendering/sources.ts`). We do **not**
forbid `await` inside a render to make scheduling simpler. Instead, two scheduler invariants
keep an async render predictable: a stale async render can never land, and `update()`'s
batching/await contract spans the async render to completion rather than stopping at the
synchronous dispatch boundary.

## Why

The library's north star is "close to vanilla, smallest surface, no DSL." Forbidding async
in renders (forcing the React `useEffect`-style "do the await in a nested function" dance)
would shrink the model on paper but push real complexity onto the user and make promises
second-class. We keep async first-class and pay for predictability in the scheduler, where
it belongs, not in a restriction on the user.

Predictability rests on two pieces:

1. **Supersession (already in the driver).** Every resume in `step` checks `handle.finished`
   first. When a source is swapped (an `update()` re-fire, or teardown), the old handle is
   cancelled, so its in-flight `.then` continuations return without committing. A render
   that started against older state therefore **cannot** clobber a newer one. Last-write-wins
   is enforced at the handle level, not by hoping renders finish in order.

2. **The `update()` state machine must track the source's *settle*, not the synchronous
   return of `dispatchCSRUpdate`.** Because `dispatchCSRUpdate` returns the instant the
   driver suspends on a Promise, a naive `RENDERING → finally → IDLE` flips `IDLE` while the
   async render is still in flight — which (a) resolves `await update()` before the DOM
   lands and (b) drops mid-flight coalescing back into supersession churn. The contract is
   therefore: `IDLE → SCHEDULED` (queue microtask), repeated calls coalesce onto one shared
   flush promise, calls that arrive while `RENDERING` set a `dirty` bit instead of being
   dropped or restarting, and on settle the runtime either re-runs once (if dirtied, with a
   fresh pull) or goes `IDLE` and resolves the flush promise. `update()` resolves once the
   DOM reflects the call, across sync **and** async renders.

This closes the data-flow model on itself: components **pull** their inputs from durable
element state at render time, `update()` re-pulls, and async work resolves into durable
state that the next pull reads — so async never races on a *value*, only on *which render
wins*, which supersession already decides.

## Considered Options

- **Force renders synchronous, push all `await` into setup / `load` (rejected).** Would make
  every flush atomic and batching trivial, but makes promises second-class and is exactly
  the React `useEffect` quarantine we want to avoid. Async stays first-class instead.
- **Bless an imperative `setProp` push as the cross-boundary data channel (rejected).** A
  nudge does not pin *when* the target's async render runs, so it standardizes the race
  rather than removing it. `setProp` stays an escape hatch; peers coordinate by event. See
  the one-writer discussion in `CONTEXT.md`.

## Consequences

- The supersession guard (`handle.finished`) is load-bearing, not an optimization: removing
  the `if (handle.finished)` checks in `step` would let stale async renders commit over newer
  ones. A future reader must not "simplify" them away.
- The `updateState` machine is more than a re-entrancy guard — it owns the async batching
  contract. It cannot be collapsed back to "flip IDLE in `finally`" without reintroducing
  early-resolving awaits and restart-churn. See `docs/API-REVIEW-TODO.md` for the open
  re-entrancy/loop-guard question this opens.
