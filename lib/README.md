# Grundlage

A small, zero-dependency library for building web components with generators and tagged template literals. Components
can be rendered on the server and hydrated in the browser.

## getting started

### installation

```bash
npm install grundlage
```

### a first component

```typescript
import { component, html, prop } from "grundlage";

const props = { start: prop.attribute(Number, 0) };

customElements.define(
	"count-seconds",
	component(
		function* ({ host, start }) {
			// runs once, so `start` is a seed. See props for reading a live value
			let seconds = start;
			const interval = setInterval(() => {
				seconds++;
				host.update();
			}, 1000);

			// this runs on every update
			// the name is not required and can be anything
			yield function* view() {
				yield html`<p>${seconds} seconds</p>`;
			};

			// this runs on component disconnect
			return () => {
				clearInterval(interval);
			};
		},
		{ props },
	),
);
```

```html
<count-seconds start="10"></count-seconds>
```

What happens here:

1. `component` turns a generator function into a custom element class, and `customElements.define` registers it.
2. When the element is added to the page, the generator (the **body**) runs from top to bottom, once.
3. `yield function* view() { … }` hands the component an **update generator**. It paints now, and runs again every
   time `host.update()` is called.
4. The function the body returns is the **cleanup**. It runs when the element is removed from the page.

### core ideas

**A component is one procedure.** Many components read naturally from top to bottom: show a placeholder, fetch
something, show the result, and clean up at the end. A generator can pause and resume, so the body is written exactly
in that order. It yields three kinds of value: a template paints once, an update generator paints now and on every
update, and a promise pauses the body until it settles.

**You decide when to update.** There are no signals, no observables and no compiler. A component updates when you call
`host.update()`, when one of its declared props changes, or when one of its declared attributes changes. Nothing else
triggers an update.

**State is plain JavaScript.** The body runs once and stays alive as a closure for as long as the element is on the
page. A `let`, a `Map` or any object declared there survives every update, because only the update generator runs
again.

**It renders on the server.** A component can be rendered ahead of time into declarative shadow DOM, so its markup and
styles arrive with the HTML. In the browser the component picks up that markup instead of painting it again
([see server rendering](#server-rendering)).

## the component body

### three things to yield

| spelling                       | what it does                                                         | on `update()`                                      |
| ------------------------------ | -------------------------------------------------------------------- | -------------------------------------------------- |
| ``yield html`…` ``             | paints once; the `yield` evaluates to the host element               | nothing, it never paints again                     |
| `yield function* view() { … }` | runs the update generator now; the body waits until that run is done | the previous run is torn down and a new run starts |
| `yield promise`                | pauses the body; the `yield` evaluates to the resolved value         | not involved                                       |

Anything else throws, and the error names what a component can yield. That includes an `async function*`, an arrow
function and `await`: a generator waits by yielding the promise.

`view` is only a name for the reader, not a keyword: what makes it an update generator is the `function*`. The
examples below use `view` where the update generator just paints, and a name that says what it does where that helps
(`disclosure`, `editor`, `flip`).

A plain template is right when the markup only depends on values known at mount (a badge, a static layout). An update
generator is the default for anything that changes.

```typescript
import { component, html, prop } from "grundlage";

const props = {
	label: prop.attribute(String),
	href: prop.optional(prop.attribute(String)),
	size: prop.attribute(prop.oneOf("sm", "md", "lg"), "md"),
};

customElements.define(
	"ui-badge",
	component(
		function* ({ label, href, size }) {
			// a plain yielded template paints once, so the values at mount are all it needs
			yield html`<a class="badge ${size}" href=${href}>${label}</a>`;
		},
		{ props },
	),
);
```

```typescript
import { component, html } from "grundlage";

customElements.define(
	"disclosure-widget",
	component(function* ({ host }) {
		let isOpen = false;
		const toggle = () => {
			isOpen = !isOpen;
			host.update();
		};

		yield function* disclosure() {
			console.log("runs on mount and on every update");

			yield html`
				<button onClick=${toggle} aria-expanded=${isOpen ? "true" : "false"}>
					${isOpen ? "hide" : "show"}
				</button>
				<p hidden=${!isOpen}>details</p>
			`;
		};
	}),
);
```

The body runs once, so it can branch once: `yield isEditing ? editor : preview` picks one update generator per mount.
A choice that changes between updates belongs inside one update generator, as a conditional template
([see conditionals](#conditionals)).

### props in short

Inputs are declared as a **schema** and passed as `component(generator, { props })`. The body and every update
generator receive one object holding `host` plus every declared prop:

```typescript
import { component, html, prop } from "grundlage";

const props = {
	start: prop.attribute(Number, 0),
	label: prop.attribute(String, "count"),
};

customElements.define(
	"click-counter",
	component(
		function* ({ host, start }) {
			let count = start; // destructured in the body: read once, at mount (a seed)

			const increment = () => {
				count += 1;
				host.update();
			};

			// destructured in the update generator: read again on every update (live)
			yield function* view({ label }) {
				yield html`<button onClick=${increment}>${label}: ${count}</button>`;
			};
		},
		{ props },
	),
);
```

**Where you destructure decides what you get.** The body runs once, so a prop destructured there is a **seed**: right
for an initial value or a decision made at mount, wrong for anything that should follow later changes. An update
generator runs on every update, so a prop destructured there is **live**. The examples in this README destructure in
the update generator by default, and in the body only where the value is meant to stay fixed.

`prop.attribute` is for values markup can set, `prop.property` for values only JavaScript sets (objects, arrays,
functions). A prop without a fallback is required, and the body waits until it has a value. The full reference is in
[props](#props).

### updates

An update runs the update generator the body yielded **last** again. The previous run is torn down first: its
`finally` block and its cleanup run. The body itself never runs again.

An update is triggered by:

- `host.update()`
- assigning a declared prop a new value: `element.items = […]`
- `host.setProp(…)` ([see host api](#host-api))
- a change to the attribute of a `prop.attribute` prop. Undeclared attributes (`class`, `style`, `data-*`) are not
  observed at all
- a [host template](#host-template) binding that changes one of the component's own props

Good to know:

- after the body yields a plain template, every `update()` does nothing: there is no update generator to run
- an update while a run waits on a promise does not wait for it: that run is torn down and a new one starts, so the
  newest run always wins and a late result never lands
- `await host.update()` resolves once the run has finished and its changes are in the DOM. It resolves in a microtask,
  not after the browser paints
- several `update()` calls in a row are combined into one update
- on a disconnected element, `update()` does nothing and resolves at once

```typescript
import { awaited, component, html } from "grundlage";

customElements.define(
	"user-disclosure",
	component(function* ({ host }) {
		yield html`<p>loading…</p>`; // a plain template, painted once

		const user = yield* awaited(fetchUser()); // waits; `user` is the resolved value

		let isExpanded = false;
		const toggle = async () => {
			isExpanded = !isExpanded;
			await host.update(); // resolves once the update is in the DOM
			host.scrollIntoView(); // safe now, the DOM is current
		};

		// replaces the loading template, and runs again on every update
		yield function* view() {
			yield html`
				<button onClick=${toggle}>${user.name}</button>
				${isExpanded ? html`<pre>${JSON.stringify(user, null, 2)}</pre>` : null}
			`;
		};
	}),
);
```

#### update order

- a parent updates before its children, and each component updates once per round. Beyond that, components update in
  the order their updates were requested, not in document order
- code right after a `yield` sees this component's own DOM, but not yet the update of a child it just passed a value
  to. One more `yield` of a promise (`yield Promise.resolve()` is enough) lets the queued children update first
- during hydration a child's shadow root already holds the server's markup, so measuring a child there says nothing
  about whether the browser has painted it

### cleanup

- the function the body returns runs when the element is removed from the page
- removal is confirmed a microtask later, so moving an element to another place in the DOM keeps the component alive
- an update generator can return a function too. That is the cleanup of that run: it runs before the next run, and
  when the body paints a template over the update generator
- the body's return position holds the cleanup and nothing else. Returning any other value warns and drops it; in
  TypeScript it is a compile error

```typescript
import { component, html } from "grundlage";

customElements.define(
	"escape-dialog",
	component(function* ({ host }) {
		let isOpen = true;
		const close = () => {
			isOpen = false;
			host.update();
		};
		const onKeydown = (event) => {
			if (event.key === "Escape") close();
		};
		document.addEventListener("keydown", onKeydown); // global events are registered by hand

		yield function* view() {
			yield html`<dialog open=${isOpen}><slot></slot></dialog>`;
		};

		return () => document.removeEventListener("keydown", onKeydown); // acquired in setup, released here
	}),
);
```

## templates

### bindings

`` html`…` `` is a tagged template literal. Each distinct template is parsed once; later paints only touch the parts
that hold a `${…}` (a **hole**). Almost every part of the markup can be a hole:

```
content        <p>${text}</p>
attribute      <div class=${className}>
mixed attr     <div class="static ${dynamic}">
event          <button onClick=${handler}>
custom event   <color-swatch on-swatch-select=${handler}>
spread         <div ${attributes}>                  // object → name/value, array → boolean attributes
list           <ul>${items.map((item) => html`<li>${item}</li>`)}</ul>
list key       <li><!--${item.id}-->…</li>          // the first dynamic comment is the row key
nested         <div>${isOpen && html`<details>…</details>`}</div>
dynamic tag    <${tagName}>content</${tagName}>
raw text       <style>${css}</style>                // style / script / textarea
comment        <!-- note ${value} -->               // the second and later dynamic comments
```

Every hole remembers what it painted last. A value that did not change writes nothing to the DOM, so focus, scroll
position and input state survive an update.

**Content holes:**

- strings, numbers and bigints are painted as text, `""`, `0` and `NaN` included
- `null`, `undefined`, `true` and `false` paint nothing. So ``${isOpen && html`…`}`` is safe, but
  ``${items.length && html`…`}`` writes the text `0` on an empty list: use a ternary for anything that is not a
  boolean
- a template, an array or an iterator paints as nested markup or a list
- anything else (a plain object, a function, a `Date`, a `Map`) throws

**Attribute holes**, when the value is exactly one hole:

- `false`, `null` and `undefined` **remove** the attribute. That is right for `hidden` and wrong for an `aria-*` state,
  where `"false"` has to reach the DOM as text, so bind a string there. `true` is written as `"true"`
- a value without a string form (an object, an array, a function) is assigned as a **property** instead. That is how
  data reaches a nested custom element
- a name the child element **declares** as a prop always goes through that prop, whatever the value
  ([see props](#props))

A value with anything else in it (`class="card ${extra}"`) is composed into one string and always set. There `null`,
`undefined`, `true` and `false` add `""`, as in a content hole, so `class="card ${isOpen && "open"}"` drops the word
when closed.

**Form state:** `value` and `checked` on inputs and `selected` on options are written as the attribute on the first
paint and as the property after that. So `form.reset()` returns to the first painted value, and a later change
replaces what the user typed. `<select value=${…}>` warns and selects nothing: bind `selected` on each option.

**Dynamic tags and raw text** are their own forms:

```typescript
import { component, html, prop } from "grundlage";

const SECTION_CSS = "h2, h3 { margin-block: 0 }";

const props = { level: prop.attribute(Number, 2) };

customElements.define(
	"section-block",
	component(
		function* ({ level }) {
			yield html`
				<h${level}>section title</h${level}>
				<style>
					${SECTION_CSS}
				</style>
			`;
		},
		{ props },
	),
);
```

A dynamic tag that changes to a different name swaps the element: attributes are copied, children are moved over and
focus is restored, but a component in that position is torn down and mounted again.

### conditionals

- inside an update generator, a `${condition ? … : null}` hole is evaluated again on every update
- in the body, an `if` branches once, at mount. Use it when the two cases need different setup

When both branches are the **same** template, the hole is patched in place. When they are **different** templates, the
old markup is removed and the new one built, which resets focus, scroll and input state inside it.

```typescript
import { component, html, prop } from "grundlage";

const props = { readonly: prop.attribute(Boolean) };

customElements.define(
	"text-block",
	component(
		function* ({ host, readonly }) {
			// a branch at mount is the one place that wants the seed
			if (readonly) {
				yield function* readOnlyText() {
					yield html`<pre>${host.textContent}</pre>`;
				};
				return;
			}

			let draft = "";
			const onInput = (event) => {
				draft = event.target.value;
				host.update();
			};
			yield function* editor() {
				yield html`
					<textarea onInput=${onInput}></textarea>
					<p>${draft.length} characters</p>
				`;
			};
		},
		{ props },
	),
);
```

A failure that the component can recover from is handled the same way: keep it in state and paint it as a branch.
Throwing is for what a component cannot recover from ([see errors](#errors)).

```typescript
import { component, html, prop } from "grundlage";

const props = { src: prop.attribute(String, "") };

customElements.define(
	"safe-image",
	component(
		function* ({ host, src: initialSrc }) {
			let error = initialSrc ? null : new Error("missing src");

			yield function* imageOrError({ src }) {
				yield error
					? html`<p role="alert">${error.message}</p>`
					: html`<img
							src=${src}
							alt=""
							onError=${() => {
								error = new Error("failed to load");
								host.update();
							}}
						/>`;
			};
		},
		{ props },
	),
);
```

### lists

An array in a content hole paints one row per entry. A row that is already on the page is matched by its template and
its content, which covers most updates without extra work.

```typescript
import { component, html, prop } from "grundlage";

const props = { items: prop.property<Array<string>>([]) };

customElements.define(
	"plain-list",
	component(
		function* () {
			yield function* view({ items }) {
				yield html`<ul>
					${items.map((item) => html`<li>${item}</li>`)}
				</ul>`;
			};
		},
		{ props },
	),
);
```

Rows that hold their own state (an input, focus, a child component) or an inline event handler need a **key**. Without
one, a row whose content changed is matched by its position, so its state stays at that index while the row shows
another entry. An inline handler, `onClick=${() => select(id)}`, is a new function on every paint, so those rows never
match by content at all.

A key is a **dynamic comment**, `<!--${item.id}-->`. The first dynamic comment of a row template is its key, wherever
it sits in the row; it never reaches the DOM. Only the expression counts, so `<!-- id: ${item.id} -->` works the same.

```typescript
import { component, html } from "grundlage";

customElements.define(
	"score-board",
	component(function* ({ host }) {
		let players = loadPlayers(); // [{ id, name, score }, …]
		const bump = (id) => {
			const player = players.find((entry) => entry.id === id);
			player.score += 1; // mutating in place is fine, the update sees it
			players.sort((a, b) => b.score - a.score);
			host.update();
		};

		yield function* ranking() {
			yield html`
				<ol>
					${players.map(
						(player) => html`
							<!--${player.id}-->
							<li>
								<input placeholder="note" />
								<!-- typed text stays with the player, not the rank -->
								${player.name}: ${player.score}
								<button onClick=${() => bump(player.id)}>+1</button>
							</li>
						`,
					)}
				</ol>
			`;
		};
	}),
);
```

A row that is one component gets its key at the top level:
``html`<!--${user.id}--><user-card user=${user}></user-card>` ``.

- a matched row with the same template is patched. A keyed row can also be matched across a template change: it keeps
  its place but is rebuilt with new nodes, so no DOM state carries over
- an iterator paints like the array it yields (``items.values().map((item) => html`…`)``). It is used up once read, so
  build it inside the update generator
- row values follow the content hole rules: `null`, `undefined`, `true` and `false` paint nothing but still take a row

### events

- native events: `onClick=${handler}`. The name is matched without case, so `onclick` works as well
- custom events: dispatch a `CustomEvent`, and listen with the `on-` prefix: `on-swatch-select=${handler}`. The
  hyphenated name is kept as written
- the event name can hold a hole itself (`on${eventName}=${handler}`)
- a quoted string (`onclick="…"`) is never a binding
- global events (`document`, `window`) are registered in the body and removed in the cleanup
  ([see cleanup](#cleanup))

```typescript
import { component, html } from "grundlage";

customElements.define(
	"color-swatch",
	component(function* ({ host }) {
		const select = (value) =>
			host.dispatchEvent(
				new CustomEvent("swatch-select", {
					detail: value,
					bubbles: true,
					composed: true, // crosses the shadow boundary
				}),
			);

		yield function* view() {
			yield html`<button onClick=${() => select("#f00")}>red</button>`;
		};
	}),
);

customElements.define(
	"swatch-picker",
	component(function* ({ host }) {
		let color = "#000";
		const pick = (event) => {
			color = event.detail;
			host.update();
		};

		yield function* view() {
			yield html`
				<p style="color: ${color}">selected ${color}</p>
				<color-swatch on-swatch-select=${pick}></color-swatch>
			`;
		};
	}),
);
```

A custom event needs the `on-` prefix: `onSwatchSelect` would look for an `onswatchselect` property, which does not
exist, so it would never fire (the console warns about it).

An inline handler is a new function on every paint, so its listener is removed and added again each time. That is
cheap, but in a list it defeats matching rows by content, so key those rows ([see lists](#lists)).

### host template

If the outermost node of a yielded template is a `<template>`, it is unwrapped: its children become the shadow DOM,
and its attributes are applied to the custom element itself. This is how a component sets its own `class`, `role` or
event handlers.

- every attribute form works: static, dynamic, mixed, boolean, spread and event handlers
- an attribute a later paint no longer sets is removed from the element
- binding one of the component's own declared props is a write like any other: a new value triggers one update, so
  the paint shows it in the same frame. A value computed from that same prop (`count=${count + 1}`) never settles and
  ends in an error
- it must be the outermost node, with no siblings at the top level; otherwise it is an ordinary `<template>`
- a `<template>` with attributes in any other position (a content hole, a list row) throws

```typescript
import { component, html, prop } from "grundlage";

const props = { variant: prop.attribute(String, "default") };

customElements.define(
	"pinnable-card",
	component(
		function* ({ host }) {
			let isPinned = false;
			const togglePin = () => {
				isPinned = !isPinned;
				host.update();
			};

			yield function* view({ variant }) {
				yield html`
					<template
						role="article"
						class="card card--${variant}"
						aria-pressed=${isPinned ? "true" : "false"}
						onClick=${togglePin}
					>
						<slot></slot>
					</template>
				`;
			};
		},
		{ props },
	),
);
```

Attributes can also be spread from an object (name and value) or an array (boolean attributes):

```typescript
import { component, html } from "grundlage";

customElements.define(
	"spread-card",
	component(function* () {
		const hostAttributes = { class: "card", role: "article", tabindex: "0" };
		yield function* view() {
			yield html`<template ${hostAttributes}><slot></slot></template>`;
		};
	}),
);
```

### styles

A `<style>` inside the template is scoped to the component by the shadow DOM. A style without holes is written once
and never touched again. Holes in a style take one of two paths:

- **fast:** every `${…}` sits in a declaration **value** (`width: ${progress}%`). An update is one `setProperty` on
  this element's own style sheet, without parsing CSS again
- **text:** a hole anywhere else (a selector, a property name, an at-rule, the whole sheet) rewrites the sheet's text,
  and the browser parses it again. Correct, but slower

```typescript
import { component, html, prop } from "grundlage";

const props = { accent: prop.attribute(String, "rebeccapurple") };

customElements.define(
	"progress-bar",
	component(
		function* ({ host }) {
			let progress = 0;
			const advance = () => {
				progress = Math.min(progress + 5, 100);
				host.update();
			};

			yield function* bar({ accent }) {
				yield html`
					<style>
						.bar {
							width: ${progress}%;
							background: ${accent};
							transition: width 120ms ease-out;
						}
					</style>
					<div class="bar" onClick=${advance}></div>
				`;
			};
		},
		{ props },
	),
);
```

```typescript
import { component, html, prop } from "grundlage";

const props = { theme: prop.attribute(String, "light") };

customElements.define(
	"themed-panel",
	component(
		function* () {
			yield function* view({ theme }) {
				// themeSheet returns the CSS text: the whole sheet is one hole, so the text path
				yield html`<style>
					${themeSheet(theme)}
				</style>`;
			};
		},
		{ props },
	),
);
```

- a value the browser rejects is dropped and the **previous** value stays. `!important` and `;` cannot sneak in
  through a hole
- each element owns a private sheet, so two instances never overwrite each other
- `getHTML()` serializes the last text write, not later `setProperty` updates
- a style without holes can be hoisted: ``const styles = html`<style>…</style>` `` at module scope, embedded as
  `${styles}`, costs nothing after the first paint

## async and data

### waiting on a promise

There is no `async function*` and no `await`. A component waits by yielding the promise: the `yield` evaluates to the
resolved value, and a rejection throws at the `yield`, so a `try`/`catch` around it handles it.

In TypeScript a bare `yield promise` evaluates to `unknown`, because a generator has one resume type for all of its
yields. `yield* awaited(promise)` is the same wait with the promise's type:

```typescript
import { awaited, component, html, prop } from "grundlage";

const props = { symbol: prop.attribute(String) };

customElements.define(
	"latest-price",
	component(
		function* ({ symbol }) {
			yield html`<p aria-busy="true">loading ${symbol}…</p>`;

			const price = yield* awaited(fetchPrice(symbol)); // a rejection throws here

			yield function* view({ symbol }) {
				yield html`<output>${symbol} ${price}</output>`;
			}; // replaces the loading template
		},
		{ props },
	),
);
```

The body runs once, so this fetch runs once and never again. For a fetch that should run on every update, wait inside
the update generator. An update while it waits starts a new run, so the newest result always wins:

```typescript
yield function* priceOnEveryUpdate({ symbol }) {
	yield html`<p aria-busy="true">loading ${symbol}…</p>`;
	const price = yield* awaited(fetchPrice(symbol));
	yield html`<output>${symbol} ${price}</output>`;
};
```

### load

`yield* load(fetcher)` is for data a component needs before its first paint, when the component is
[rendered on the server](#server-rendering). On the server the fetcher runs, and its result is written into the
markup. While the browser hydrates that markup, the same `load` returns the server's result instead of fetching again.
Everywhere else the fetcher simply runs:

```typescript
import { component, html, load } from "grundlage";

customElements.define(
	"user-name",
	component(function* () {
		const user = yield* load(() =>
			fetch("/api/user").then((response) => response.json()),
		);
		yield function* view() {
			yield html`<p>${user.name}</p>`;
		};
	}),
);
```

- **always with the star:** `load()` returns a generator, and the star gives `user` the fetcher's type. `yield load(…)`
  throws and names the fix
- **order or key:** an unkeyed `load` takes the server's results in order. A `load` inside a branch the server and the
  browser can take differently needs a string key: `yield* load("user", () => …)`. A mixin builds its key from its
  arguments. A key used twice in one element throws on the server, and a mismatch in order warns in the development
  build
- **plain data:** the result travels as JSON, so it is made of plain objects, arrays, strings, finite numbers,
  booleans and `null`. A `Date`, a class instance, a `Response` or a template throws and names the fix: on the server
  always, in the browser in the development build
- **failures:** a fetcher that fails on the server throws at the `yield*`, where the component can catch it and paint a
  fallback. The browser then runs that load again
- **once** comes from the body: inside an update generator, a `load` runs on every update

## composition

There are three ways to build a component from smaller parts:

- a **template** is a plain value, so a helper function can return one
- an **update generator** is a lifecycle that starts over on every update
- a **mixin** is a generator the body delegates to with `yield*`, so it runs as part of the body

### templates in templates

```typescript
import { component, html, prop } from "grundlage";

const statusBadge = (status) =>
	html`<em class="badge badge--${status}">${status}</em>`;

const props = {
	reference: prop.attribute(String),
	status: prop.attribute(String),
};

customElements.define(
	"order-row",
	component(
		function* () {
			yield function* view({ reference, status }) {
				yield html`<p>${reference} ${statusBadge(status)}</p>`;
			};
		},
		{ props },
	),
);
```

### update generators

An update generator runs to completion like the body: it may paint several templates in a row and wait on promises in
between. Every run has its own phases: code before the `yield` runs before the DOM is patched, code after it runs once
the patch is in. A FLIP animation (First, Last, Invert, Play) needs exactly that: read the old positions, patch, read
the new positions, and animate from old to new.

```typescript
import { html } from "grundlage";

// captureRects and playFlip are user-land helpers, left out for readability
export const flipList = (readItems, onShuffle) =>
	function* flip({ host }) {
		const first = captureRects(host); // before the yield: the old positions
		yield html`
			<button onClick=${onShuffle}>shuffle</button>
			<ul>
				${readItems().map(
					(item) =>
						html`<!--${item.id}-->
							<li data-flip-id=${item.id}>${item.label}</li>`,
				)}
			</ul>
		`;
		const last = captureRects(host); // after the patch, before the browser paints
		playFlip(first, last); // move each row back to its old spot, then animate it home
	};
```

```typescript
import { component } from "grundlage";
import { flipList } from "./flip-list.js";

customElements.define(
	"shuffle-list",
	component(function* ({ host }) {
		let items = loadItems();
		const shuffleItems = () => {
			items = [...items].sort(() => Math.random() - 0.5);
			host.update();
		};

		// a function that reads the list, not the list itself: the update generator runs on every update and has to
		// see the reassigned array
		yield flipList(() => items, shuffleItems);
	}),
);
```

The body waits at the `yield` until a run finishes, and the `yield` evaluates to what that run returned. So an update
generator can also be a step the body waits on:

```typescript
const answered = Promise.withResolvers();
const answer = yield function* question() {
	yield html`<button onClick=${() => answered.resolve("yes")}>yes</button>`;
	return yield answered.promise;
};
yield html`<p>you said ${answer}</p>`;
```

The promise is created in the body: every run is a new call, so a promise created inside the update generator would be
a new one on every update. An update generator that waits forever holds the body forever.

- an update generator may not yield another update generator; nesting is one level deep. To split a large one, move
  parts into plain helper generators and call them with `yield*`
- a template the body yields after an update generator ends it for good: the update generator is torn down and its
  pending work never lands
- a second update generator the body yields replaces the first

### mixins with yield\*

`yield*` is plain JavaScript delegation: the inner generator's yields become the outer generator's yields. A mixin
therefore runs as part of the body (once), takes arguments, and the update generator it yields is the one `update()`
runs again.

```typescript
// user-card.ts: a complete lifecycle, loading → loaded
import { awaited, html, type BaseComponent } from "grundlage";

// a mixin declares the shape it reads, never a schema: it is handed whichever element mounted it
type UserCardInput = {
	host: BaseComponent;
	readonly userId: string;
};

export function* userCard(input: UserCardInput) {
	yield html`<p aria-busy="true">loading…</p>`;

	const user = yield* awaited(fetchUser(input.userId));

	yield function* view() {
		yield html`
			<article>
				<h3>${user.name}</h3>
				<p>${user.email}</p>
			</article>
		`;
	};
}
```

```typescript
import { component, prop } from "grundlage";
import { userCard } from "./user-card.js";

const userCardProps = { userId: prop.attribute(String) };
const userPanelProps = { activeUserId: prop.attribute(String) };

// as its own element
customElements.define(
	"user-card",
	component(userCard, { props: userCardProps }),
);

// or as part of another element, under that element's own prop name
customElements.define(
	"user-panel",
	component(
		function* (componentProps) {
			yield* userCard({
				host: componentProps.host,
				get userId() {
					return componentProps.activeUserId;
				},
			});
		},
		{ props: userPanelProps },
	),
);
```

- registered directly, the mixin receives the props object itself, so `input.userId` is live
- the object literal in `user-panel` is built once, so a plain `userId: componentProps.activeUserId` would freeze the
  value. The getter keeps it live
- typing the parameter as `ComponentProps<typeof userCardProps>` does not compile: that type promises a host with a
  `userId` prop, and `user-panel`'s host has `activeUserId` instead. Declaring the shape is the honest type
- a mixin that annotates its return type writes `Generator<YieldableValue>`, not a bare `Generator`, which would erase
  the inner yields to `unknown`. Inference gets it right on its own
- `yield userCard` without the star would make the whole mixin an update generator, which fails here: it yields an
  update generator itself, and nesting is one level deep

## errors

- an uncaught error ends the component: its shadow root is emptied and the element dispatches a `grundlage-error` event
  (a `ComponentErrorEvent` with `error` and `tagName`; it bubbles and crosses shadow boundaries). Unless a listener
  calls `preventDefault()`, the console logs the error and the shadow root shows its message. The rest of the page is
  unaffected
- a paint error (a wrong value in a hole) is thrown at the `yield html` that painted it. Holes before the failing one
  are already written, so paint a fallback in the `catch`
- an error in an update generator's first run, waits included, is thrown at the body's `yield` of it, where a
  `try`/`catch` handles it. After that the body has moved on, so an error in a later run ends the component, unless the
  update generator catches it itself
- an error thrown by a cleanup goes to `reportError`
- warnings exist only in the development build, which bundlers pick through the `development` export condition. Without
  a bundler, map `grundlage` to `dist/development/index.mjs` in the import map while developing

```typescript
import { awaited, component, html, prop } from "grundlage";

const props = { src: prop.optional(prop.attribute(String)) };

customElements.define(
	"data-view",
	component(
		function* ({ src }) {
			if (!src) throw new Error("<data-view> needs a src"); // ends the component

			let data;
			try {
				data = yield* awaited(fetchJson(src));
			} catch (error) {
				data = { error }; // handled here, the component keeps running
			}

			yield html`<p>${data.error ? "failed" : data.title}</p>`;
		},
		{ props },
	),
);
```

An update generator that must survive an error on every update catches it inside itself:

```typescript
yield function* chart() {
	try {
		yield html`${formatChart(data)}`;
	} catch {
		yield html`<p>chart unavailable</p>`;
	}
};
```

## form components

- `{ formAssociated: true }` ([see options](#options)) makes the element take part in forms
- `host.internals` is its `ElementInternals`: `setFormValue`, `setValidity` and so on
- the four form callbacks are dispatched as events on the element: `form-associated` `{form}`, `form-disabled`
  `{disabled}`, `form-reset` (no detail) and `form-state-restore` `{state, mode}`
- listen to them with `on-form-*` on the [host template](#host-template), or with `host.addEventListener`

```typescript
import { component, html, prop } from "grundlage";

const props = {
	name: prop.optional(prop.attribute(String)),
	value: prop.attribute(String, ""),
};

customElements.define(
	"text-field",
	component(
		function* ({ host, value: initial }) {
			// `initial` is a seed on purpose: after the first paint the input owns its value
			let value = initial;
			let isDisabled = false;

			const internals = host.internals; // null on the server, hence the `?.` below
			const publish = () => {
				internals?.setFormValue(value); // submitted with the form under `name`
				internals?.setValidity(value ? {} : { valueMissing: true }, "required");
			};
			const onInput = (event) => {
				value = event.target.value;
				publish();
				host.update();
			};
			const onDisabled = (event) => {
				isDisabled = event.detail.disabled;
				host.update();
			};
			const onReset = () => {
				const input = host.shadowRoot.querySelector("input");
				if (input) input.value = initial; // the input keeps typed text through an attribute write
				value = initial;
				publish();
				host.update();
			};

			publish(); // the form value is set before the first paint

			yield function* view({ name }) {
				yield html`
					<template on-form-reset=${onReset} on-form-disabled=${onDisabled}>
						<input
							name=${name}
							value=${initial}
							disabled=${isDisabled}
							onInput=${onInput}
							required
						/>
					</template>
				`;
			};
		},
		{ formAssociated: true, props },
	),
);
```

## extending

- `component(generator)` returns a class. Subclass it to add methods, getters or static fields
- that keeps the public API on the prototype, where outside code can rely on it
- never assign methods or state to `host` at runtime ([see antipatterns](#antipatterns))

```typescript
import { component, prop } from "grundlage";

const asTagList = (incoming: unknown) =>
	typeof incoming === "string" ? incoming.split(" ") : incoming;

const props = { tags: prop.attribute(asTagList, []) };

class TagField extends component(
	function* () {
		// …the body: reads its props, yields a template…
	},
	{ props },
) {
	get count() {
		// declared props are accessors on the class, so a subclass reads them off `this`
		return this.tags.length;
	}

	clear() {
		this.tags = []; // through the accessor: parsed, reflected, updated
	}
}

customElements.define("tag-field", TagField);
```

## options

`component(generator, options)` takes these options, and any other `ShadowRootInit` field (e.g.
`slotAssignment: "manual"`):

| option           | default  | platform default | effect                                                                            |
| ---------------- | -------- | ---------------- | --------------------------------------------------------------------------------- |
| `props`          | `{}`     | n/a              | the schema: observed attributes, accessors and types ([see props](#props))        |
| `formAssociated` | `false`  | n/a              | the element takes part in forms ([see form components](#form-components))         |
| `mode`           | `"open"` | `"open"`         | `open` exposes the root on `host.shadowRoot`; `closed` hides it there             |
| `serializable`   | `true`   | `false`          | the shadow root serializes with `getHTML`, required for server rendering          |
| `clonable`       | `true`   | `false`          | the shadow tree is copied on `cloneNode`, so a cloned element keeps its content   |
| `delegatesFocus` | `true`   | `false`          | focusing the element (click or `.focus()`) moves focus to the first focusable one |

```typescript
import { component, html, prop } from "grundlage";

const props = { label: prop.attribute(String) };

customElements.define(
	"secure-badge",
	component(
		function* () {
			// no host.shadowRoot here; a closed root still hydrates
			yield function* view({ label }) {
				yield html`<span>${label}</span>`;
			};
		},
		{ mode: "closed", props },
	),
);
```

## props

The schema is a plain object of definitions from the `prop` namespace, passed as `component(generator, { props })`.
It fixes the observed attributes and installs one accessor per prop on the element class. Hoisting it above
`customElements.define` keeps the element's inputs in one place, and gives you something to export when two elements
share a shape.

Every definition answers two questions: where the value comes from, and who must supply it.

```typescript
import { prop } from "grundlage";

const props = {
	habit: prop.property<Habit>(), // set from JavaScript only, required
	checkIns: prop.property<Array<CheckIn>>([]), // set from JavaScript only, with a fallback
	today: prop.attribute(String), // set from markup or JavaScript, required
	headingLevel: prop.attribute(Number, 2), // with a fallback
	open: prop.attribute(Boolean), // false while absent
	variant: prop.attribute(prop.oneOf("primary", "secondary"), "primary"),
	note: prop.optional(prop.property<string>()), // may stay undefined
	value: prop.unreflected(prop.attribute(Number, 0)), // the markup keeps the default
};
```

No type annotation is needed: each definition carries its type, and a fallback is checked against it.

### property and attribute

**`prop.property<Type>(fallback?)`** is a value only JavaScript sets: an object, an array, a function. It observes no
attribute and never reflects. Every value is taken as it is, `null` included; only `undefined` means absent.

**`prop.property(schema, fallback?)`** takes any [Standard Schema](https://standardschema.dev) (Zod, Valibot,
ArkType). The prop's type comes from the schema, and every write is validated: a refused value warns with the schema's
own message, and the previous value stays. A schema that validates asynchronously throws, since a prop is written
synchronously.

```typescript
import * as v from "valibot";

const props = {
	habit: prop.property(v.object({ id: v.string(), name: v.string() })),
};
```

**`prop.attribute(parser, fallback?)`** is a value markup can set. It observes the lowercased prop name, and a
property write is reflected back to the attribute. `parser` is `String`, `Number`, `BigInt`, `Boolean`,
`prop.oneOf(…)`, or a function that takes whatever arrived and returns the value, or `undefined` to refuse it:

```typescript
const asTagList = (incoming: unknown) =>
	typeof incoming === "string" ? incoming.split(" ") : incoming;
```

A **string** came from markup and needs parsing; anything else came from JavaScript and is already the value. One
parser serves both, so `<x-el tags="a b">` and `el.tags = ["a", "b"]` end up with the same value. The parameter is
`unknown` because both markup and JavaScript reach it.

**`prop.oneOf("primary", "secondary")`** is a parser that accepts exactly those strings, typed as their union.

**`prop.unreflected(prop.attribute(…))`** stops property writes from being reflected. The attribute keeps what the
markup wrote, the default, the way a native input's `value` attribute does, while the property holds the live value. A
form control reads the default back on reset:

```typescript
const ratingProps = { value: prop.unreflected(prop.attribute(Number, 0)) };

function* ({ host }) {
	const resetToMarkup = () => (host.value = prop.read(host, ratingProps).value);
	// …bound as on-form-reset=${resetToMarkup}
}
```

### required, fallback, optional

A definition without a fallback is **required**. The body does not start until every required prop has a value, so it
never reads `undefined` there:

- a child whose parent binds the prop starts once, with the value
- an element added to the page first waits, and starts with the assignment that completes it
- all writes of one task land before the body starts, so `el.habit = h; el.note = n;` starts it once
- later, writing `undefined` or removing a required attribute is refused with a warning
- a required prop still missing one frame after the element connected warns in development
- on the server nothing arrives after connecting, so a missing required prop ends the component with an error that
  names the fix: a fallback, or a parent that binds it

A **fallback** makes the prop optional for whoever sets it, and always set for the body. `prop.attribute(Boolean)`
already has `false` as its fallback.

**`prop.optional(definition)`** lets a prop without a fallback stay `undefined`. It only wraps a definition without a
fallback, and it goes outermost: `prop.optional(prop.unreflected(prop.attribute(Number)))`. Anything else is a type
error, and throws at define time in JavaScript.

`PropsOf<typeof props>` is the body's view, where only an optional prop may be missing. `PassedPropsOf<typeof props>`
is the view of whoever sets the props, where a prop with a fallback or `prop.optional` may be left out:

```typescript
const bound = { habit, today } satisfies PassedPropsOf<typeof props>;
html`<streak-habit ${bound}></streak-habit>`;
```

### reading props

The object the body receives **is** the element's prop store, not a copy, so reading from it is always current. A
read after a `yield` of a promise sees what the element holds at that moment. Destructuring takes a snapshot, by the
language's own rule:

```typescript
element.setAttribute("userid", "8");
componentProps.userId; // "8", read now
componentProps.host.userId = "9"; // parsed, reflected, updated
const frozen = { ...componentProps }; // a snapshot
```

The props half of the object is **readonly**. Writing to it directly would store a value that nothing parsed,
reflected or updated on. Write through `host` instead (`componentProps.host.userId = "9"`), the same way outside code
does (`element.userId = "9"`).

### one store, five rules

Every prop has one slot on the element, and every write lands in it.

1. **One value per prop.** The last write wins, wherever it came from. When an element is upgraded, the constructor
   fills in the fallbacks, the attribute callbacks deliver the markup, and `connectedCallback` replays whatever
   JavaScript assigned before the class existed, so a property assignment wins over markup.
2. **Every incoming value runs through the prop's parser or schema**: markup, an assignment, a parent's binding,
   `setProp`, and the fallback at construction.
3. **A refused value is ignored.** The previous value stays, the console warns, and nothing throws or updates.
4. **Absence writes the fallback.** `el.x = undefined`, removing the attribute, a binding a later paint drops, and
   element construction all take that path. A required prop refuses absence instead, and an optional one reads
   `undefined`.
5. **A property assignment to a `prop.attribute` is reflected** when the value has a string form. An attribute from
   markup is left as written: `count="007"` stays, while `el.count` reads `7`.

```typescript
el.count = "7"; // parsed to 7, written as count="7", one update
el.count = 7; // the same value: no DOM write, no update
el.count = "nope"; // refused: still 7, count="7" untouched, one console warning
el.count = undefined; // absent → the fallback, reflected
```

### names and reflection

The attribute name is the lowercased prop name: `userId: prop.attribute(String)` observes `userid`, and
`<my-el userId="5">`, `<my-el userid="5">` and `setAttribute("userId", …)` all reach it.

Prop names must match `/^[a-z][a-zA-Z0-9_-]*$/`, and two props that differ only in case throw at define time. Every
prop becomes an accessor on the element class, so a name that already exists there (`title`, `id`, `lang`, `hidden`,
`update`, `setProp`, `internals`) throws at define time. So do `host`, which the props object uses, and any name
starting with `on-`, which markup reads as a custom event. Rename the prop.

A name that merely starts with `on` is fine. A binding checks whether the element declares the name before it checks
whether it looks like an event, so `once: prop.attribute(String)` is a prop, not a listener for a `ce` event.

Reflection writes the value's own string form: a string as itself, a number or bigint through `String(value)`, `true`
as `""`. A value without a string form (an object, `undefined`) removes an outdated attribute, and does nothing when
there is none.

### booleans

An HTML boolean attribute has two states, but `prop.attribute(Boolean, true)` needs three, so the third goes into the
attribute value:

| declaration                     | absent  | `x` / `x=""` / `x="true"` | `x="false"` |
| ------------------------------- | ------- | ------------------------- | ----------- |
| `prop.attribute(Boolean)`       | `false` | `true`                    | `false`     |
| `prop.attribute(Boolean, true)` | `true`  | `true`                    | `false`     |

Writing `true` writes `""`. Writing `false` removes the attribute where absence already means `false`, and writes
`"false"` where it does not, so `:host([disabled])` stays exact.

### fallbacks

A fallback belongs to each element separately, and it runs through the parser at construction, so the body reads an
already-parsed value.

- **copied** with `structuredClone`, deeply: anything object-shaped (an array, a plain object, a `Map`, a `Set`, a
  `Date`), including every object nested inside it
- **shared**: primitives, functions and templates. A template is already shared by every paint of its literal

```typescript
const props = {
	tags: prop.attribute(asTagList, []), // copied per element
	footer: prop.property(html`<footer>made with <3</footer>`), // shared
	onSave: prop.property(() => {}), // shared, a function is a value here
};
```

A fallback `structuredClone` cannot copy (a class instance, an object holding a function) throws at define time. So
does a fallback the parser or schema refuses; the check runs once, before any element exists.

### functions as props

An inline arrow bound to a `prop.property`, `onPick=${(item) => select(item)}`, is a new function on every paint, so
the child updates on every paint of its parent. Define the function once in the body, or let the child dispatch an
event instead.

### prop.read(element, schema)

Reads the same schema once, from an element that never went through `component`, or reads the markup default of a
`prop.unreflected` prop. It returns a snapshot. Hoist the schema rather than writing it inline, since it is prepared
once per schema object. An own property under the prop name wins over the attribute, and a `prop.property` reads only
the own property. With neither, the fallback answers, and a required prop reads `undefined`.

```typescript
import { prop } from "grundlage";

const figureProps = { label: prop.attribute(String, "") };

const { label } = prop.read(document.querySelector("figure"), figureProps);
```

## host api

`host` is the element itself, typed `BaseComponent`: a normal `HTMLElement` plus `update()`, `setProp()` and
`internals`.

### update()

Runs the last yielded update generator again and resolves once that run is in the DOM ([see updates](#updates)).
Without an update generator it does nothing. On the server, an update requested during the paint (a host binding that
writes an own prop, an `update()` or prop assignment inside the update generator) runs before rendering ends, so the
markup shows the settled value; after that, `update()` does nothing.

### setProp(name, value, oldValue?)

Outside code, such as a framework rendering custom elements, uses `setProp` to pass a value to a mounted component. A
**declared** name goes through that prop's accessor: parsed, reflected and updated, and `undefined` writes the
fallback back (`null` too, for a `prop.attribute`). An undeclared name is handled the way a dynamic attribute is: a
value with a string form is written as an **attribute**, anything else as a **property**, and an `on*` name with a
function is bound as a listener. Pass `oldValue` so a previously bound listener is removed.

```typescript
const cell = document.querySelector("price-cell") as BaseComponent;
cell.setProp("currency", "EUR"); // parsed by String, reflected as currency="EUR"
cell.setProp("quote", { bid: 1.08, ask: 1.09 }); // a prop.property: taken as it is, no attribute
cell.setProp("quote", undefined); // absent → back to the fallback
```

```typescript
import { component, html, prop } from "grundlage";

const props = {
	currency: prop.attribute(String, "USD"),
	quote: prop.property({ bid: 0, ask: 0 }),
};

customElements.define(
	"price-cell",
	component(
		function* () {
			yield function* view({ currency, quote }) {
				yield html`<output>${quote.bid} ${currency}</output>`;
			};
		},
		{ props },
	),
);
```

A `setProp` only reaches the screen if an update generator reads the prop. A value destructured in the body stays as
it was at mount ([see props in short](#props-in-short)).

### internals

`host.internals` is the element's `ElementInternals`, attached on first read, on every component, not only
form-associated ones. It is `null` on the server.

## server rendering

A component can be rendered on the server: the page is loaded in a DOM emulator (happy-dom), each component runs until
its first paint, and the result is written into the HTML as declarative shadow DOM. Markup and styles are then there
when the browser first parses the page.

In the browser the component **hydrates**: it parses its template again and finds the dynamic parts in the existing
markup instead of painting it again. The page is not interactive until hydration has finished.

- on the server a component runs until its first paint. Promises it yields before that are awaited; the code after the
  first paint does not run there. Put browser-only work (measuring, `matchMedia`, storage) after the first paint
- data fetched on the server travels with the markup through [load](#load), so the browser does not fetch it again
- a `prop.property` cannot travel in markup, so on the server a binding to one marks the child `defer-hydration`: the
  child waits for its parent's paint in the browser

### prerender plugin

`vite-plugin-grundlage` renders components on the server and inlines them into the page, in development and in the
build. It ships as its own package, versioned separately and younger than the library:

```bash
npm install --save-dev vite-plugin-grundlage
```

```typescript
// vite.config.ts
import { defineConfig } from "vite";
import { prerenderWebcomponents } from "vite-plugin-grundlage";

export default defineConfig({
	plugins: [prerenderWebcomponents()],
});
```

- **pages** set the default: every page is prerendered, and `include`/`exclude` page globs narrow that down
- **elements** override it: `ssr` turns prerendering on, `ssr="false"` off, for the element and everything inside it,
  through shadow roots too
- components come from the modules a page's `<script type="module">` imports; the script's own body never runs on the
  server
- whatever cannot be prerendered stays as written and paints in the browser, with a `[prerender]` warning

Options, fallbacks, and what elements of other libraries need are in the
[plugin's README](https://github.com/copyandpaetow/grundlage/tree/main/prerender-plugin#readme).

## antipatterns

Things the model makes tempting that tend to backfire:

- **destructuring props in the body and expecting them to update**: the body runs once, so those values are seeds.
  Destructure in the update generator, or read off the props object, for live values
- **methods or state on `host`** (`host.save = …`, `host.close()`): keep state in variables in the body, talk to the
  outside with events, and add a public API by subclassing ([see extending](#extending)). A property assigned in the
  body only exists once `connectedCallback` has run, so other code can reach the element before it is there
- **mutating a class instance or a `Date` and expecting an update**: plain data (objects, arrays, `Map`, `Set`) is
  compared by content, but other objects are compared by reference, so an in-place change looks unchanged. Replace
  the object or use plain data
- **mutating a prop in place** (`el.items.push(x)`): an assignment triggers an update, a mutation does not. Assign
  again (`el.items = el.items` is enough) or call `host.update()`
- **writing to the props object** (`componentProps.count = 5`): the write would skip parsing, reflection and the
  update. Write `componentProps.host.count = 5`
- **reading attributes directly** (`host.getAttribute("count")`): they are strings, they skip the parsing, fallbacks
  and refusals the schema gives, and an undeclared attribute does not trigger an update
- **`while (true)` in the body**: the body runs once to completion, so this never ends. Repeated work is what
  `update()` is for
- **writing `<!--^.^ …-->` or `<!--*.*-->` comments in a template**: those prefixes are the library's internal
  markers, and a collision silently breaks hydration
