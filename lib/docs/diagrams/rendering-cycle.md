# The rendering cycle, in plain terms

This is the conceptual walkthrough: what actually happens when a component renders, updates,
errors, tears down, and renders on the server — described in everyday language, deliberately
**without** the current function or field names. The goal is to fix the *vocabulary* first; the
code names can then be read against this and judged on whether they say what this says.

If you want the structural view (which layer points at which), read it alongside
[`diagrams/update-machinery.md`](update-machinery.md). If you want the fixed list of
obligations the system must satisfy, that's [`sketches/jobs.md`](../sketches/jobs.md).

---

## The cast

A running component is four cooperating parts, arranged in a straight line. Each part only ever
talks to the one below it; nothing points back up.

1. **The element.** The custom element itself — the thing the browser constructs, connects, and
   disconnects. It owns the other three parts and is the only part the outside world (the browser,
   the page) touches.
2. **The batcher.** Bookkeeping for "re-render on demand." It exists only in the browser. Its
   whole job is to take a burst of "please update" requests and turn them into the right number of
   actual re-renders, and to tell each caller exactly when *their* update is on screen.
3. **The generator layer.** The part that runs the user's code. A component is defined by a
   generator function; this layer runs it, watches what it hands back, and keeps track of the *one*
   live sub-generator it may have started. This is where "what should we show" is decided.
4. **The DOM layer.** The leaf. It does one thing: put a piece of markup into the component's
   shadow DOM, reusing what's already there when it can. It knows nothing about generators or
   updates — you hand it markup, it puts that markup on the page.

The single most important rule about how the parts connect: **the live signal that an update has
finished travels back up as a returned promise, not as a stored back-reference.** No part holds a pointer to
the part above it. That's what keeps the whole thing a line instead of a loop.

A second rule shapes everything below it: **connecting a component must not pause.** The browser
connects an element synchronously, and nested components must connect in order, with the parent
fully set up before its children. So the generator layer runs *synchronously as far as it can* and
only ever pauses when the **user's own code** hands back a promise to wait on. The framework never
inserts a wait of its own on the connect path.

---

## 1. Birth: construction and connection

**Construction** happens once, when the browser upgrades the element.

- The element checks whether it *already* has a shadow DOM. If it does, that markup was put there
  ahead of time by the server prerender step, and the element remembers "my first render should
  adopt this existing markup rather than build fresh." (It has to check this now, before it creates
  its own shadow DOM, because a moment later it always has one.)
- If there was no prerendered shadow DOM, the element creates an empty one.

**Connection** happens every time the element enters the page.

- If the component is already alive (it was connected a moment ago and is only being *moved* within
  the page), connection does nothing — we must not restart a component just because it moved.
- Otherwise the element decides, once, whether it's running in the browser or on the server. This
  single decision is the only place the two modes diverge.
- The DOM layer is built (or kept — see [§10](#10-moving-within-the-page)).
- **In the browser only:** the element starts watching its own attributes for changes, and creates
  the batcher.
- The generator layer is built, told whether to show markup *continuously* (browser) or *once*
  (server), and started.

Starting the generator layer kicks off the user's generator **synchronously**. If the user's code
is fully synchronous, the entire first render — including connecting any nested components — happens
before connection returns. Only a promise in the user's own code can make any of this wait.

---

## 2. Running the user's generator

We run the user's generator forward ourselves, one step at a time. The rules:

- Run it forward, one step at a time, **synchronously, for as long as it can.**
- Each time the generator hands a value back, we look at what it is and act on it (see
  [§3](#3-what-the-generator-hands-back)), then feed the result back into the generator as that
  step's result.
- We **only pause** when we meet a real promise — either because the generator is an async
  generator, or because a synchronous generator handed back a promise to wait on. Then we wait for
  the promise and resume. A waited-on promise's resolved value flows back into the generator as that
  step's result — it is *not* treated as something to show.
- When the generator reaches its end, we finish it (see [§6](#6-cleanup-and-teardown)).
- If running the generator throws, we finish it and report the error (see
  [§7](#7-errors-and-recovery)).

There are **two depths** of generator, both run the same way:

- The **outer generator** is the one the user passed to define the component. It runs once per
  connection. Its job is to *choose* what produces the visible markup.
- The **inner generator** is the one (at most one) the outer generator may have started. Its job is
  to *produce* the visible markup over time.

Depth is the only difference between the two, and it's a single fact: the outer generator has no
parent; the inner one's parent is the outer. That parent link is also where an inner error is sent
(see [§7](#7-errors-and-recovery)).

A subtle but important point: when we act on a handed-back value (the user's render code runs, or an
inner generator starts), it can synchronously throw an error that comes back *through this same
generator* and finishes it. So after acting on a value, we re-check whether the generator is still
alive before running it forward again — otherwise we'd run a generator that has already failed and
bury the real error.

---

## 3. What the generator hands back

Every time a generator hands a value back, we look at what it is and act on it. What it means
depends on what the value is **and** on which depth handed it back.

The outer generator's job is to choose **how what's shown gets produced**. There are three answers —
the **three kinds of render**:

| Handed back                                 | What it is                                       | Re-run when an update is requested? |
|---------------------------------------------|--------------------------------------------------|-------------------------------------|
| A **finished piece of markup** (a template) | fixed markup — already produced                  | No — nothing to re-run              |
| A **render function**                       | a function we *call* to get markup back          | Yes — we call it again              |
| A **generator function**                    | a generator we *run* to produce markup over time | Yes — we start it over from scratch |

The split between the last two is *call once and get markup back* versus *run over time and produce
markup as it goes* — a generator can pause, resume, and be stopped; a render function just returns.
We'll call whichever one is producing the markup right now the **current renderer**. Fixed markup
has no renderer behind it — it's just there.

What we do, case by case:

- **The outer generator hands back markup.** Stop whatever was producing before, note that there's
  nothing to re-run (the markup is fixed — an update will have nothing to do), and show the markup.
- **The outer generator hands back a render function.** Stop whatever was producing before, remember
  the function so a later update can call it again, call it once, and show what it returns.
- **The outer generator hands back a generator function.** Stop whatever was producing before,
  remember it so a later update can restart it, and start it as the inner generator. From here,
  *that* inner generator produces the markup.
- **The inner generator hands back markup, or a render function.** Just show it (call the function
  first if it's a function). The inner generator's job is to produce, not to choose — so handing
  these back doesn't change what the current renderer is, it only shows something.
- **The inner generator hands back another generator function.** This is the depth limit — nesting
  is allowed exactly one level deep — so this is an error with a clear message.
- **Either generator hands back anything else** (a plain value, e.g. a resolved promise's value).
  It is not something to show; it simply flows back into the generator as that step's result.

"Stop whatever was producing before" always means: if an inner generator was running, stop it first
(which runs its cleanup — see [§6](#6-cleanup-and-teardown)) before starting the new one.

---

## 4. Putting markup on screen

This is the DOM layer's only responsibility. It is handed a piece of markup and puts it into the
shadow DOM. There are **three ways** it can do that, chosen automatically:

1. **Patch in place.** If markup was shown here before *and the new markup is the same template* as
   the old (only the interpolated values differ), the layer keeps the existing
   DOM nodes and only updates the values that actually changed. It compares each interpolated value
   to the previous one; identical values are skipped, and only the parts of the DOM tied to changed
   values are touched. This is the common, cheap path.
2. **Replace.** If there was previous markup but it's a different template, the old nodes are thrown
   away and the new markup is built from scratch and put in. Before doing so, any attributes the old
   markup had applied to the *host element itself* are removed (host attributes live on the
   component element, not inside the shadow DOM, so replacing the shadow children wouldn't clear
   them).
3. **Adopt (hydrate).** On the very first render, if there was prerendered markup to adopt, the
   layer does not build anything — it locates the existing nodes and wires the dynamic parts onto
   them. See [§9](#9-hydration).

Two details that matter:

- **Which template, not the values.** Every template knows which literal it came from (fixed at
  parse time). That — *which* template, regardless of the values plugged into it — is what decides
  patch vs. replace.
- **Host-attribute bookkeeping.** A component's top-level markup may carry attributes meant for the
  host element itself. While a render might touch those host attributes, the element's own
  attribute-watching is paused around the write, so the framework's own writes don't look like
  outside changes and trigger a pointless re-render. This bracketing only happens when the render
  could actually touch the host, so components without host attributes pay nothing.

If the thing handed to the DOM layer isn't a finished piece of markup (for example a render
function returned a bare string), it's wrapped into a trivial template first, so the layer always
works with markup.

---

## 5. Re-rendering on demand

This whole section is **browser-only**. On the server nothing here exists (see
[§8](#8-server-side-rendering)).

A re-render is requested by calling the element's update method. It happens for three reasons: the
user called it directly, an attribute on the host changed (the element watches for this), or a
property was set on the element.

### When a request does nothing

- **There is no batcher** — meaning the component is disconnected, or on the server. The request
  resolves immediately, so awaiting it never hangs.
- **What's on screen is fixed markup** — there's markup showing but no renderer behind it, nothing
  to re-run. The request resolves immediately.

### The batching gate

Otherwise the request enters a one-decision gate:

- If a re-render pass is **already running**, just note "another request came in while we were
  working" and hand the caller the *same* promise the in-flight pass will resolve. Every concurrent
  caller shares one promise and they all resolve together, when the final markup is on screen.
- If **no pass is running**, start one and hand back its promise.

### A re-render pass

A pass does this:

1. **Open a tiny waiting window** (a single microtask). A synchronous burst of requests all arrive
   inside this window and collapse into this one pass. This is the one and only place the framework
   deliberately waits, and it waits because the wait *buys* something: coalescing.
2. **Re-run the current renderer** and wait for the markup to be on screen:
    - A **render function** is simply called again and its result shown. This is synchronous — the
      markup is on screen immediately.
    - A **generator** is *restarted from scratch*: the running one is stopped and a fresh run is
      started. This is asynchronous — the new run produces its markup over time, and "on screen"
      means **the fresh run has finished** (reached its end), having shown whatever it produced along
      the way.
3. **If another request arrived while we were working**, run step 2 once more with a fresh pull.
   Exactly one extra pass, no churn. Otherwise the pass is done.

When the pass is done, the shared promise resolves. So awaiting an update resolves precisely when
*that* update's markup is on screen — and it works identically whether the render was synchronous or
asynchronous. That is the central promise of the update system.

### Restart beats the in-flight run

When a generator is restarted, the run that was in flight is stopped, and the fresh run takes its
place. The stopped run might still have asynchronous work in flight (a pending await). When that
late work finally resolves, it must change nothing: it must not paint, and it must not signal "done."
Two things guarantee this — a stopped generator's pending resumptions check "am I still alive?" and
go nowhere; and the "done" signal is only honored if it comes from the run that is *currently* the
live one. A superseded run can neither paint over the new one nor prematurely resolve its promise.

---

## 6. Cleanup and teardown

Cleanup comes from two places and fires at one time.

- **A generator's `finally`.** If a generator is stopped while suspended (mid-await), stopping it
  runs its `try/finally`, so any cleanup written there happens.
- **A returned cleanup function.** If a generator instead runs to its natural end and *returns* a
  function, that function is remembered and run later — when it's next replaced or the component
  disconnects.

So: stopping a live generator runs its `finally` (if suspended) and its remembered cleanup (if it
had finished and left one). Stopping is safe to do twice — the second time does nothing.

**Disconnecting** the component:

- The browser fires disconnect both on real removal and on a move within the page. So disconnect
  first waits one tick and checks whether the element came back; if it's a move, it bails and leaves
  everything running.
- On a real disconnect: stop watching attributes; stop **both** generator depths (running their
  cleanups); resolve any pending update so an awaiting caller doesn't hang; and clear the batcher.
- The generator layer and batcher are dropped entirely — the next connection builds brand-new ones.
  Only the DOM layer is kept, so that if the same element reconnects it can patch its existing markup
  in place rather than rebuild it.

---

## 7. Errors and recovery

The model is: **an error in the inner (producing) generator is offered to the outer generator,
which gets a chance to recover.** Recovery means the outer generator's own `try/catch` catches it
and hands back a new renderer.

When a renderer errors (including a render function that throws synchronously, which has no
generator behind it), the error is routed as follows:

- **If the component is already torn down** (nothing left alive), do nothing except unstick any
  awaiting update. This guards against the error path re-entering itself after teardown and warning
  twice.
- **If the error came from the outer generator itself, or the outer generator is already gone**,
  there is no one left to recover. Tear everything down, log a warning, and write the error's text
  into the shadow DOM so it's visible. (Awaiting updates are unstuck here too.)
- **Otherwise, offer the error to the outer generator** by throwing it in at the point it's
  suspended:
    - **It recovers** — its `try/catch` catches and it hands back a new renderer. That new renderer is
      installed exactly as in [§3](#3-what-the-generator-hands-back), and the markup already on
      screen stays until the new renderer produces its own. The old, failed inner generator is
      dropped.
    - **It doesn't recover** — the error escapes the outer generator and it ends. Now there's no one
      left, so we fall to the "tear down, warn, write the error into the DOM" outcome.

Because offering the error to the outer generator can cause the outer generator to *also* fail,
which routes back into this same logic, the "already torn down → do nothing" guard at the top is
what makes the re-entry clean: the second pass through finds nothing alive and quietly stops, so the
warning happens once, not twice.

After all this, if recovery left no generator producing, the markup is settled, so any awaiting
update is resolved. If recovery installed a new generator, that one will resolve the update on its
own when it finishes — so we don't resolve it twice.

---

## 8. Server-side rendering

The server path is **the browser path minus the batcher, with one swapped behavior: show *once*
instead of *continuously*.** That's the entire difference.

- On connection, the server builds no batcher and does no attribute-watching. It builds the
  generator layer the same way, but tells it to commit markup *once*.
- The generator runs exactly as in [§2](#2-running-the-user's-generator), synchronously as far as it
  can, pausing only on the user's own promises, until it reaches the **first** thing that produces
  real markup.
- At that first markup, the DOM layer puts it into the shadow DOM once (building fresh markup, or adopting prerendered
  markup if some is already there), and then any deferred data the render registered is drained out.
- Immediately after that single commit, **both generator depths are stopped.** Stopping them runs
  their `finally` blocks; anything they would have returned as cleanup is discarded. Stopping both is
  precisely what makes this one-shot: no later step of any generator can reach a stopped one, so
  there's nothing to show twice and no need for a separate "we're done" flag.
- Because there's no batcher, the parts of the system that signal updates are simply inert: the
  "update finished" signal has nowhere to go and quietly does nothing, and no re-render pass is ever
  run. There is no branching for this — the absent batcher *is* the off switch.
- **Errors on the server** take the same terminal path as a non-recoverable browser error: tear
  down, warn, write the error text into the shadow DOM.

Note that the "remember the current renderer so it can be re-run" step still happens on the server,
but nothing ever reads it back, because there are no updates. It's a harmless dead write, not a
special case.

---

## 9. Hydration

Hydration is how a component *adopts* markup the server already rendered, instead of building its
own.

- At construction, the element noticed it already had a shadow DOM (the prerender step attached one
  before the element was upgraded) and remembered "adopt on first render."
- On the **first** render, the DOM layer therefore takes the adopt path: rather than building and
  inserting nodes, it walks the existing prerendered nodes, finds the spots the dynamic parts attach
  to, and wires them up. After this first render the "adopt" flag is cleared and all later renders
  behave normally (patch or replace).
- One thing must be re-applied during adoption: attributes on the host element. The server wrote the
  prerendered *child* markup and its static attributes, but the host element's own attributes were
  never serialized — they only exist as bindings. So on adoption, every attribute binding is applied
  freshly, setting the host's attributes (and any dynamic child attributes) to their current
  values.

The same adopt-or-build choice exists on the server's one-shot commit: if there's already child
markup present, adopt it; otherwise build from scratch.

---

## 10. Moving within the page

Moving an element in the DOM fires disconnect and then connect, back to back. We must not let a move
restart the component.

- **The disconnect side** waits one tick before doing anything and bails if the element is back —
  so a move never tears anything down.
- **The connect side** checks whether the generator layer is already alive and bails if it is — so a
  move never starts a second one.
- The DOM layer is the one part deliberately **kept** across a genuine disconnect/reconnect, so a
  reconnecting element can patch its existing markup in place. Everything else is rebuilt fresh on
  reconnect, because fresh identity per connection is what makes "restart cleanly on reconnect"
  correct.

---

## 11. What triggers a re-render

In the browser, three things ask for a re-render, all funnelling through the update path in
[§5](#5-re-rendering-on-demand):

- The component code calls update directly.
- An **attribute** on the host element changes — the element watches its own attributes and asks for
  an update on any change. (This is why the framework pauses that watching around its own host
  writes — see [§4](#4-putting-markup-on-screen) — so it doesn't react to itself.)
- A **property** is set on the element — the property write is applied as a binding and then an
  update is requested.

---

## The cycle in one breath

Construct (note any prerendered markup) → connect (build the parts, in the browser also watch
attributes and build the batcher) → run the outer generator synchronously until it picks how the
markup is produced → that produces markup → the DOM layer puts it on the page (patch, replace, or adopt). On
demand, batch the requests, re-run the current renderer, and resolve each caller exactly when its
markup is on screen. An inner error is offered to the outer generator to recover, or else becomes a
visible terminal error. On disconnect, stop both generators, run their cleanups, and drop everything
but the DOM layer. On the server, do all of this once and then stop — no batcher, no updates.
