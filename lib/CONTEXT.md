# Grundlage

A functional templating layer for web components. It hides the two things that make raw
web components unpleasant — declarative authoring and performant rendering — behind the
smallest possible, vanilla-close, DSL-free API. Functions over classes.

## Language

**Component**:
A generator function that defines a custom element: it runs once per mount, `yield`s
something renderable, and returns an optional cleanup function. The user authors a
generator, never a class. The factory that turns the generator into a custom-element
constructor is `component(generator)`.
_Avoid_: render (old name for the factory — it builds a class, it does not render).

**Host**:
The custom-element instance a component runs on. Passed as the first argument to the
generator and returned by every `yield`. Its only Grundlage-specific method is `update()`.
_Avoid_: element (too generic), this (the library is class-free; there is no `this`).

**Render function**:
A function `(host) => html\`…\``that a component yields. Re-invoked on each`update()`.
The unit that produces markup, distinct from the one-shot setup of the Component. The
default Producer.

**Producer**:
What a Component yields for the runtime to install as the source of markup — either a
Render function or a Render generator (or a one-shot static template). `update()` re-fires
the current Producer; the root Component never re-runs.

**Render generator**:
A Producer that is itself a generator (`function*(){ yield html\`…\`; … }`), reached for
when a single render needs more than "return markup": post-render DOM work (FLIP/measure
the just-rendered tree), an async or branching sequence, or local state held across yields.
It behaves like the root Component in async/branching, but may not nest another generator.
It runs to completion and may `yield`more than once in a single run — the canonical
measure-render shape is **render → measure the live DOM → render again**: each`yield`
paints synchronously, so the next line sees the rendered tree, and the re-`yield`patches
in place (unchanged expressions don't re-render). This is the *only* sanctioned way to feed
a measured value back into markup — never an imperative DOM write from outside the render.
On`update()`the whole generator is restarted from the top (vs a Render function, which is
merely re-invoked), re-running that pass;`update()` is for _external_ re-entry only.
_Avoid_: inner generator (the runtime term), effect/hook (there is no hook API).

**Prop**:
An input to a component. Crosses the web-component boundary as **either** an HTML
attribute (always a string) **or** a JS property — Grundlage hides which. Read inside a
component with `props(host, schema)`; written from a parent with `host.setProp(name, value)`.
_Avoid_: attribute (only one of the two channels), property (likewise), setProperty (old
name for the writer — it is the write-twin of `props`, so it shares the `prop` vocabulary).

**Attribute-vs-property rule**:
The one shared convention for which channel a Prop travels on: **primitive (string /
number / boolean) → attribute; complex (object / array / function) → JS property**
(`false`/`null`/`undefined` clear the attribute; `on*` functions bind as event listeners).
`props` reads on this cut (schema-driven); `setProp` writes on it (value-driven). The two
must stay in step.

**Update**:
The sole re-render trigger: `host.update()`, and the _single channel_ through which every
change to a component's output flows — content, gesture, animation alike. There is no
reactive primitive and no imperative DOM side-lane: an author never writes the rendered tree
directly, they change closure state and call `update()`. Microtask-batched, so repeated
calls in a tick collapse to one render, and the per-binding diff writes only what changed —
that batching is _why_ even a 60fps gesture can route through here. The host's own attribute
mutations call it automatically; everything else the author drives: a `MutationObserver` for
slotted-content changes, the event handler for a gesture (scroll/pointermove are already
refresh-tied), or a `requestAnimationFrame` loop for time-based animation with no event.
It re-fires only the current Producer; the root Component never re-runs.
_Avoid_: render (a re-render is an Update; `component` is the factory), rerender, refresh.

**Load**:
Data a component needs before its first renderable yield. `load(host, fetcher, options?)`
runs the fetcher on the server, serializes the result into the markup, and replays it once
on the client during hydration before falling back to the fetcher.
_Avoid_: fetch (only the client-fallback half), prefetch.

**Error contract**:
An error thrown anywhere in a component bubbles **up to the root generator** at its yield
point, so recovery is plain `try/catch` in the generator — there is no error-boundary API.
Uncaught, it is loud (console + error text in the shadow root) and **contained** (only that
component tears down; the host page survives). See ADR-0002.
_Avoid_: error boundary (there is none), onError (there is no such hook).
