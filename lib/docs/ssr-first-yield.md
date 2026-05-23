# SSR: first-yield rendering

When grundlage runs on the server, a component renders **exactly once** — at
the first renderable yield of its outer generator — and then both the inner
source and the outer component generator are cancelled. The shadow root is
serialized in that state and shipped to the browser as declarative shadow
DOM; the client picks up at hydrate and drives every subsequent frame.

```javascript
import { render, html } from "grundlage";

customElements.define(
	"demo-loader",
	render(async function* (host) {
		const user = await fetchUser();

		//single renderable yield — this is what the server snapshots
		yield () => html`
			<article class="card">
				<strong>${user.name}</strong>
				<small>${user.team}</small>
			</article>
		`;

		//anything past the first yield is client-only
	}),
);
```

The prerender plugin mounts the element under a happy-dom polyfill, waits
for the shadow root to fill, and emits

```html
<demo-loader>
	<template
		shadowrootmode="open"
		shadowrootclonable
		shadowrootdelegatesfocus
		shadowrootserializable
	>
		<article class="card">…</article>
	</template>
</demo-loader>
```

into the static HTML. When the browser parses that page the shadow root is
already attached, and the client's first yield re-runs against the hydrate
path instead of `replaceChildren`.

## Why

Before this change, the SSR path drove the generator to completion and
serialized whatever the final yield produced. That was wrong for two
reasons:

- **Generators model time, not state.** A loader that yields "loading…"
  then "loaded" should ship the loading frame as the SSR snapshot only when
  the data really isn't available server-side. The natural unit of "the
  server's frame" is the first renderable yield — the same yield the
  client will start from.
- **Components ran longer than they needed to.** Subsequent yields, timers,
  microtask chains, and any post-yield body all executed against a throwaway
  context. Worst-case, a render function that schedules its own `update()`
  would spin forever during the SSR pass.

First-yield rendering pins the contract: server = first renderable frame,
client = everything after that frame.

## Detecting the server

Two signals; either one flips the lib into server mode:

- **`typeof window === "undefined"`** — the universal node/SSR signal. The
  prerender plugin polyfills `document`, `customElements`, `HTMLElement`,
  `MutationObserver`, etc. onto `globalThis`, but **never** assigns
  `window`. The check therefore stays true under the plugin and false in
  every real browser.
- **`globalThis.__grundlage_ssr__ === true`** — an explicit opt-in for
  environments that *do* have `window` but want server semantics. The
  in-browser SSR tests (`ssr.browser.test.ts`) and any tooling that wires
  up a happy-dom `Window` for unrelated reasons can set this flag to drive
  the same code path.

`isServerEnvironment()` is read at the call site each time, not cached, so
the in-browser tests can flip the flag around individual `serverRender`
calls without stale state leaking between tests.

## What server mode does

- **No `MutationObserver`.** `connectedCallback` skips
  `#watchAttributes()`. The field stays `undefined`; every later read of
  `this.#attributeObserver` uses optional chaining so disconnect, observe,
  and teardown all no-op cleanly.
- **`touchesHost` short-circuits to false** in `#renderToDom`. There's no
  observer to bracket around the host write, so the disconnect/observe
  pair would be dead work.
- **Cancel after the first paint.** Once the first template lands in the
  shadow root via `setup(this)`, `#renderToDom` cancels the active inner
  source (if it's a generator) and the outer component generator. Both
  generators run their `.return()` — user `try/finally` blocks observe the
  cancel.
- **`update()` is a no-op.** Even after the cancel, the cached
  `RENDER_FUNCTION` source still holds a live reference to the render
  function. A user microtask scheduled inside that render fn would re-enter
  `update()` and loop forever; the early-return in `update()` is the gate.
- **`setProperty` splits across the boundary.** The
  `applyAttributeBinding` half still runs (the attribute lands on the
  host, which matters for serialization), but the subsequent `update()`
  bails at the server guard.

## What server mode does *not* change

- **Host (root template) attributes** are applied normally during the
  first yield's `setup`, so the prerender plugin's serializer captures
  them on the host element.
- **Pre-yield async work** runs to completion. A generator that does
  `const data = yield fetch(...)` before its first renderable still waits
  on the promise — that yielded promise *is* the chain leading to the
  first renderable yield.
- **Error path is intact.** A rejecting pre-yield promise still routes
  through `advanceGenerator → onError → #abortAndShowError`, which writes
  the error into the shadow root. That message ends up in the serialized
  HTML.
- **Two components on the same page stop independently.** The cancel
  targets `this.#componentGenerator` / `this.#activeSource` per element.

## How it works

### Component (`lib/src/index.ts`)

- `connectedCallback` gates the observer allocation behind
  `!isServerEnvironment()`. The generator still starts, the yield pump
  still runs — only the observer is skipped.
- `#renderToDom` computes `onServer = isServerEnvironment()` once per
  render. The host-bracket calculation folds `!onServer` into
  `touchesHost`. After writing the first template, if `onServer` is true,
  it calls `cancelGenerator` on the active inner source (when it's a
  generator) and on the outer component generator.
- The cancel does *not* capture the cleanup return value. The server
  context is throwaway, and calling user `finally` blocks under
  happy-dom can touch browser-only APIs that aren't polyfilled — we let
  `cancelGenerator` swallow any throw and move on.
- `update()` returns early when `isServerEnvironment()` is true, before
  reading `#activeSource` or scheduling the microtask batch.
- `disconnectedCallback` uses `this.#attributeObserver?.disconnect()`,
  matching the server path where the field was never assigned.

### Generator stepper (unchanged)

`cancelGenerator` sets `source.terminated = true` and calls `.return()`
on the generator. `advanceGenerator`'s loop checks `terminated` at the
top of each iteration and unwinds without calling `next()` again, so any
pending microtasks for yielded promises bail out instead of resuming the
old generator. The first-yield cancel rides this existing machinery —
nothing in the stepper needed to change.

### Prerender plugin (`website/vite.config.ts`)

- The plugin only processes instances of registered tags that carry an
  opt-in sentinel attribute (default `ssr`), e.g.
  `<demo-loader ssr data-label="…"></demo-loader>`. Unmarked instances,
  unrelated pages, and unrelated custom elements (e.g. `<nav-bar>`) stay
  untouched. The sentinel survives serialization, so hydrate-side code can
  branch on `host.hasAttribute("ssr")` if it needs the same signal.
- happy-dom globals are assigned to `globalThis` lazily on the first
  matching page, and **`window` is deliberately not assigned** — that's
  what keeps `typeof window === "undefined"` true inside the lib.
- The plugin creates the host element, copies attributes from the
  authored `<demo-loader …>` tag, appends it to `document.body`, and
  **polls** until the shadow root has children. Polling beats a fixed
  sleep because async-before-first-yield generators settle whenever their
  await chain finishes — workload-dependent.
- happy-dom 20.x does not honour `serializableShadowRoots` in `getHTML`,
  so the plugin hand-rolls the declarative shadow DOM wrapper. The flags
  on the emitted `<template>` (`shadowrootmode="open"`,
  `shadowrootclonable`, `shadowrootdelegatesfocus`,
  `shadowrootserializable`) mirror the lib's `attachShadow` defaults so
  the browser reconstructs the shadow with matching ownership semantics.

### In-browser SSR tests (`lib/tests/integration/ssr.browser.test.ts`)

- `serverRender` flips `globalThis.__grundlage_ssr__ = true` for the
  duration of the call, mounts the element, polls
  `waitForShadowContent`, serializes via `getHTML({
  serializableShadowRoots: true })`, removes the element, and clears the
  flag in a `finally`.
- Host attributes are re-emitted around the serialized shadow content
  because `getHTML` returns shadow content only — without that the hydrate
  side never sees the root-template attributes.

### Node SSR tests (`lib/tests/integration/ssr.test.ts`)

- `ssr-setup.ts` is a side-effect-only module that assigns happy-dom
  globals onto `globalThis` (again without `window`). It must be the
  first import — `parser/html.ts` runs `document.createElement` at module
  load.
- These tests exercise the same code path the plugin uses in production
  builds, so they pin the contract end-to-end without needing a browser.

## Behavioural guarantees (pinned by tests)

- **First-yield only** — synchronous generators with multiple yields
  render only the first; later yields and post-yield body do not execute.
- **Render function called exactly once** — even when that render function
  schedules `host.update()` from a microtask. Without the `update()` guard
  this would loop forever.
- **Nested generator descent** — when the outer generator yields an inner
  generator function, SSR steps into the inner and stops at *its* first
  yield.
- **Async-before-yield resolves** — a generator that awaits before its
  first renderable yield gets the resolved value; the first renderable
  yield then renders normally.
- **Error before yield** — a rejecting yielded promise writes the error
  into the shadow root via `#abortAndShowError`; the post-yield body does
  not run.
- **`user finally` runs** — `cancelGenerator` calls `.return()`, so
  `try/finally` around the first yield executes. The cleanup *return
  value* is intentionally discarded on the server.
- **`setProperty` halves** — the attribute is written to the host; the
  re-render is suppressed by the `update()` guard.
- **Disconnect after SSR is safe** — `disconnectedCallback` runs
  `this.#attributeObserver?.disconnect()` cleanly even though the
  observer was never allocated.
- **Host (root template) attributes land on the host** during the first
  yield, so `getHTML` captures them on the outer tag.
- **Expression closure** — expressions in the first-yield template
  evaluate against the closure at yield time, not against any later
  mutation of those variables.
- **Per-element independence** — two components on the same page each
  stop at their own first yield.
- **Serialization shape** — `document.body.getHTML({
  serializableShadowRoots: true })` produces a `<template
  shadowrootmode=…>` wrapper carrying the first-yield content and nothing
  past it.

## Tests

- Node SSR contract (no browser, happy-dom polyfill only):
  `lib/tests/integration/ssr.test.ts`
- In-browser SSR + hydrate round-trip:
  `lib/tests/integration/ssr.browser.test.ts` (the
  `first renderable yield: SSR stops, client resumes` describe block).
