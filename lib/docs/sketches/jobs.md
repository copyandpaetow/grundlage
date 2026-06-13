# The jobs — what the render system must absolutely do

Authoritative "must-do" spec, written **independent of the current implementation**. The
point is to design against a fixed list of obligations instead of against the code we happen
to have. When we evaluate any architecture (today's two-layer runtime, the closure sketches,
or something new), it has to satisfy every **[pinned]** job; **[cost]** jobs are there for
performance/UX and could in principle be renegotiated.

> Status: design artifact, not wired into the build. Lives next to the `*.sketch.ts` files.

---

## Mental model: structured concurrency, depth 2

Strip away the current code and the system is one thing: **a parent task that can spawn at
most one child task, with a "latest template" side-effect.** Every job below maps onto a
single generic primitive — drive a generator, cancel it (→ cleanup), throw into it
(→ error propagation), await its settlement.

| structured-concurrency primitive | jobs |
| --- | --- |
| spawn a task | A1 (root), A2/A3 (child install) |
| cancel a task → run cleanup | D1, D2, D4, F2 |
| propagate error child → parent | E1, E2, E3 |
| "latest value" effect | B1–B3 (render) |
| await a task's settlement | C2, C5 |
| restart a task | C1 (generator), C4 |

The root and the current source are **the same task primitive at two depths**. The only thing
that differs is the yield handler: the parent *installs* a producer, the child *renders* a
template.

---

## A — Generator protocol

- **A1** Drive a root generator once per connection; sync or async; resume each `yield` with
  the host element. **[pinned]**
- **A2** A root yield installs exactly one producer: static template | render function |
  nested generator (≤ 1 level). **[pinned]**
- **A3** A nested generator yields template | render function. Yielding a generator function
  here is the depth-limit error (`"Inner generators cannot yield generator functions"`).
  **[pinned]** — `nested-generators` "inner generator yielding a generator function throws"
- **A4** A yielded Promise is awaited; its resolution flows back as the `yield` expression's
  result (not treated as a render target). **[pinned]** — `nested-generators` "non-renderable
  value passes through unchanged"

## B — Rendering

- **B1** Paint a template into the shadow root. First paint = setup, or **hydrate once** if an
  SSR shadow root was prerendered. **[pinned]**
- **B2** Subsequent paints **patch in place** on a `templateHash` match, else replace children.
  **[cost]** — pure performance; correctness would survive always-replace.
- **B3** Bracket the host-attribute `MutationObserver` around any host-touching render so
  framework writes don't generate spurious mutation records. **[pinned]**

## C — `update()` (CSR only)

- **C1** Re-run the **current** producer (never the root): static = no-op, render-fn = re-call
  (synchronous), generator = **restart from scratch** (asynchronous). **[pinned]** —
  `nested-generators` "update() restarts the inner generator each time"
- **C2** The returned promise resolves once **this call's** DOM has landed — across sync *and*
  async renders (no trailing `sleep` crutch). **[pinned — ADR-0003]** — `update-scheduling`
  "await update() resolves only after the async DOM has landed"
- **C3** Concurrent calls coalesce onto **one shared promise** and resolve together.
  **[pinned]** — `update-scheduling` "coalesced callers share one promise"
- **C4** A call arriving **mid-flight** → exactly one reflush with a **fresh pull**, no restart
  churn. **[pinned]** — `update-scheduling` "mid-flight reflushes exactly once with a fresh pull"
- **C5** A restart **supersedes** the in-flight render; the stale one cannot clobber it.
  **[pinned]** — `update-scheduling` "update() supersedes an in-flight render";
  `nested-generators` "late resolution of cancelled inner await must not silence the restart"
- **C6** No-op and resolve (don't hang) on a static current or a disconnected element.
  **[pinned]** — `update-scheduling` "static template … resolves immediately", "disconnected
  element resolves immediately"

## D — Lifetime / cleanup

- **D1** Cancel a generator via `.return()` → its `try/finally` runs. **[pinned]** —
  `nested-generators` "try/finally fires on update() restart"
- **D2** Capture `return cleanupFn` on **natural completion**; fire it on the next
  swap/disconnect. (Not captured if cancelled mid-await — that path is `try/finally`'s job.)
  **[pinned]** — `nested-generators` cleanup-contract tests
- **D3** Contain a cancelled generator's **late await resolution**: no render, no settle.
  **[pinned]** — `nested-generators` "rapid restart with in-flight inner async work"
- **D4** Disconnect cancels both layers (firing cleanups) and disconnects the observer.
  **[pinned]** — `nested-generators` "both outer and inner cleanups run on disconnect"

## E — Errors

- **E1** A current-source error **bubbles to the root** via `.throw()` for `try/catch` recovery.
  **[pinned]**
- **E2** Root recovers (yields a new producer) → install it; the prior DOM persists.
  **[pinned]** — `nested-generators` "outer try/catch around the inner can recover"
- **E3** Root falls through / no root left → teardown + `console.warn` + write the error text
  into the shadow root. **[pinned]** — `nested-generators` "uncaught inner error becomes a
  terminal"

## F — SSR

- **F1** One-shot: drive to the **first renderable yield**, paint once (setup or hydrate), tear
  down. **[pinned]**
- **F2** No `update()`; abandon later yields — cancel runs `finally`, discard whatever the
  generator returned. **[pinned]**
- **F3** Any error → teardown + warn + write into shadow. **[pinned]**

## G — Synchronous transparency  ← the constraint that shapes everything

- **G1** `connectedCallback` must **not `await`** — it returns synchronously, having kicked off
  the driver synchronously. (The framework **may** schedule its own async *elsewhere*; what it
  must never do is suspend the connect path itself.) **[pinned]**
- **G2** So fully-synchronous user code produces a fully-synchronous subtree — including the
  connection/upgrade of **nested components** — within that `connectedCallback`. Only a
  user-supplied Promise/`await` suspends the connect path. **[pinned]**

  **Why:** nested components had real timing bugs when a parent's `connectedCallback` was
  async — children connected in the wrong order / observed an unset-up parent. We cannot know
  what the user puts in a render function (it is either synchronous code or Promises), so on
  the connect path the framework stays transparent: sync-in ⇒ sync-out, async only where the
  user asked for it.

- **G3 — async is a deliberate spend.** Framework-introduced async is *allowed*, but in a
  rendering library "async" means *waiting*, and waiting has two faces: a useful **breather**
  for the main thread (let the browser do layout/paint/other tasks, coalesce a burst) or pure
  **wasted time** (a deferral that only postpones work that could have run synchronously —
  latency for nothing). So the framework spends async **only when the waiting buys something**.
  **[pinned as principle]**

  - *Justified spend we already make:* the `update()` batching microtask — one deferral that
    buys coalescing of a synchronous burst (C3/C4).
  - *Wasted spend we refuse:* deferring a yield that had no Promise behind it.

  **Consequence (this is the big one):** the driver is **synchronous-while-possible, suspending
  only on a real Promise** — it spends zero async it didn't need. Native `for await…of` fails
  this twice: it defers the *first* paint (breaking G2's nested-component timing) **and** it
  spends a microtask on *every* yield for no benefit (G3 waste). **G forecloses native async
  iteration and makes the hand-rolled driver required, not a choice — while leaving the door
  open for deliberate, paid-for breathers (e.g. time-slicing a long render) if we ever want them.**

---

## What the jobs FIX (no longer up for debate)

- **A driver exists**, and it is the hand-rolled synchronous-while-possible kind (G). Not
  native `for await`. It suspends only on a real Promise — async is a spend, made only when it
  pays (G3); deliberate breathers are permitted but never gratuitous.
- **Two depths.** Root installs, current renders; ≤ 1 nested level (A2/A3).
- **`update()` is async** and needs a settle signal + coalescing, because generator restart is
  async (C1) and that's pinned.
- **Error propagation parent ← child** via `.throw()` (E1). Cancellation alone is not enough.
- **The runtime is the fixed point.** Per-instance state lives on the node; no global queue.

## What the jobs leave FREE (the actual design space)

1. **Decomposition of the two depths.** Two hand-written layers (today) **vs** one depth-1
   recursive task primitive (root and current become depth 0/1 of one driver). The jobs only
   require "root installs, ≤ 1 nested level" — not two separate code paths.
2. **How behavior binds to data.** Module-level functions + threaded opaque `context` + a
   dispatch table (#8) **vs** per-instance **closures** that capture a typed runtime (no cast,
   no table; ≈4 fresh closures per generator install) **vs** a shared frozen `SourceOps` vtable.
   Trade: per-handle allocation + call-site monomorphism vs readability. Measure on the
   component benches.
3. **Scheduler encoding.** The 4-state machine (`IDLE/SCHEDULED/RENDERING/RENDERING_DIRTY`)
   **vs** Concept 1 (the flush as one linear async function whose own promise is the join
   handle; `#1 batching` = `flushPromise != null`, `#2 settle` = `dirty` + `settleResolve`).
   Same contract (C2–C5), different surface.

These three are orthogonal. Picking positions on them — not re-deriving the obligations — is
the remaining work.
