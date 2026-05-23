# SSR: first-yield rendering

On the server a component renders **once** — at the first renderable yield of
its outer generator — and then both the inner source and the outer generator
are cancelled. The shadow root is serialized as declarative shadow DOM; the
client picks up at hydrate.

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

The prerender plugin mounts the element under a happy-dom polyfill, waits for
the shadow root to fill, and emits

```html
<demo-loader>
	<template shadowrootmode="open" shadowrootclonable
		shadowrootdelegatesfocus shadowrootserializable>
		<article class="card">…</article>
	</template>
</demo-loader>
```

into the static HTML.

## Why

The previous SSR path drove the generator to completion and serialized the
final yield. That broke two things:

- **Generators model time, not state.** "loading → loaded" must ship the
  loading frame when the data really isn't available server-side. The natural
  unit of "the server's frame" is the first renderable yield — the same yield
  the client starts from.
- **Components ran longer than they needed to.** Post-yield bodies, timers,
  and self-scheduling `update()`s all executed against a throwaway context.

## Detecting the server

Two signals; either one flips the lib into server mode:

- **`typeof window === "undefined"`** — node/SSR. The prerender plugin
  polyfills `document`, `customElements`, etc. but never assigns `window`.
- **`globalThis.__grundlage_ssr__ === true`** — explicit opt-in for
  environments that *do* have `window` but want server semantics (in-browser
  SSR tests, tooling that runs happy-dom in the browser).

The check is read at each call site, not cached, so tests can flip the flag
between `serverRender` calls without state leaking.

## What server mode does

- **No `MutationObserver`** — `connectedCallback` skips `#watchAttributes()`;
  every later read uses optional chaining.
- **`touchesHost` short-circuits to false** in `#renderToDom` — no observer
  to bracket.
- **Cancel after the first paint** — once `setup(this)` lands, the active
  inner source and the outer component generator are both `.return()`ed.
- **`update()` is a no-op** — the cached `RENDER_FUNCTION` source still holds
  a live render fn; without the guard a user microtask that calls
  `host.update()` would loop forever.
- **`setProperty` splits across the boundary** — the attribute write still
  lands on the host (matters for serialization); the subsequent `update()`
  bails.

## What server mode preserves

- **Host attributes** apply during the first yield's `setup`, so they make it
  onto the serialized outer tag.
- **Pre-yield async work** runs — a generator that awaits a fetch before its
  first renderable still waits.
- **Error path** — a rejecting pre-yield promise routes through
  `#abortAndShowError`, which writes the message into the shadow root.
- **User `finally` runs** — `cancelGenerator` calls `.return()`; the cleanup
  *return value* is intentionally discarded.

## How it works

### Component (`lib/src/index.ts`)

`connectedCallback` gates the observer allocation behind
`!isServerEnvironment()`. `#renderToDom` reads `onServer` once, folds
`!onServer` into `touchesHost`, and after writing the first template calls
`cancelGenerator` on the active inner (if it's a generator) and on the outer
component generator. `update()` early-returns under the same check.

### Generator stepper (unchanged)

`cancelGenerator` sets `terminated = true` and calls `.return()`.
`advanceGenerator`'s loop checks `terminated` at the top of each iteration —
any pending microtasks for yielded promises bail out instead of resuming.

### Prerender plugin (`prerender-plugin/`)

- Processes only registered tags carrying an opt-in sentinel attribute
  (`ssr` by default). Unmarked instances and unrelated tags stay untouched.
- happy-dom globals get assigned to `globalThis` lazily on the first matching
  page; `window` is deliberately not assigned.
- Polls for shadow content rather than sleeping — async-before-yield
  generators settle on workload-dependent timing.
- Hand-rolls the declarative shadow DOM wrapper because happy-dom 20.x
  doesn't honour `serializableShadowRoots` in `getHTML`. The emitted flags
  mirror the lib's `attachShadow` defaults.

## Behavioural guarantees (pinned by tests)

- First yield only; post-yield body does not execute.
- Render function called exactly once, even if it schedules `update()`.
- Nested generators descend; the inner's first yield is the snapshot.
- Async-before-yield resolves before the snapshot is taken.
- Errors before yield land in the shadow root via `#abortAndShowError`.
- `user finally` runs; its return value is discarded.
- `setProperty` writes the attribute; re-render is suppressed.
- Disconnect after SSR is safe (observer was never allocated).
- Host attributes land on the host for serialization.
- Expressions evaluate at yield time, not after later mutation.
- Two components on the same page each stop at their own first yield.
- `getHTML({ serializableShadowRoots: true })` produces a
  `<template shadowrootmode=…>` carrying the first-yield content only.

## Tests

- Node SSR contract: `lib/tests/integration/ssr.test.ts`
- In-browser SSR + hydrate round-trip:
  `lib/tests/integration/ssr.browser.test.ts`
- Plugin integration: `prerender-plugin/index.test.ts`
