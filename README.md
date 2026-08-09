# Grundlage

A small, vanilla-flavored, zero-dependency library for building web components with tagged template literals.

## introduction

### getting started

#### installation

```bash
npm install grundlage
```

#### example

```typescript
import { component, html } from "grundlage";

const props = { start: [Number, 0] };

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
			yield () => html`<p>${seconds} seconds</p>`;

			// this runs on component disconnect
			return () => {
				clearInterval(interval);
			};
		},
		{ props },
	),
);
```

### concepts

#### procedural components with generators

The main idea here is that components (especially the async ones) are often procedural (from top to bottom as one
lifecycle) but most frontend frameworks can't
communicate that very well. For example an async component might start with a placeholder, then fetch something, and
then render something based on the return value. Or a component requires a side effect in the beginning, renders
something, and in the end needs to clean up that side effect.

With generators that actually is possible as we can pause and resume. The library tries to render the function body to
completion. When something is yielded, it will be returned to the next step of the generator. If it is something
renderable it will get rendered.
There are currently three different renderables: static templates, render functions, and nested generators.

At the end of the generator can be a return function. That is a cleanup indicator and will run when the component itself
gets cleaned up.

#### sidestepping reactivity issues with manual updating

Reactivity in the current framework landscape boils down to having a compiler, a special signal/observable primitive
that sometimes
looks like a normal value but requires special care, or re-rendering all the time but requires state to be special.
Besides the compiler approach, it requires a lot of domain specific language (DSL) and concepts that don't translate very
well and usually bring their own footguns.
To keep the library specific DSL to a minimum, we leave the control over updating with the user, enabling them for
even finer grained performance.
When the main generator function encounters something renderable, it renders and remembers it. Whenever the
component gets updated, the last renderable will get rendered again.

#### state survives updates

Since only the renderables get re-rendered, the main function body stays intact as a closure for the lifetime of the
component, which makes it the perfect place to store state. That way state can be normal JavaScript. A `let` that gets
reassigned, a `Map/WeakMap` as a cache, nothing special here. State can also exist between renderables. There are no
rules here.

#### SSR + declarative shadow DOM

This library can be Server-Side Rendered. The idea is to replay the component with a DOM emulator like happy-dom (which
can be done with the prerender plugin) on the server until the first DOM content appears. That is serialized
by the plugin to the Declarative Shadow DOM (DSD). Styles and markup will get rendered when the HTML is first parsed
like
other HTML would.
On the client the hydration needs to run the parser step again but doesn't re-render the component. It detects the
dynamic positions and moves on from here. While the hydration runs, the interactivity sadly is paused.

There is a small helper to avoid re-fetching data when the component is transferred in its DSD form to the client.

## lifecycle

### mount & update

- component renders from top to bottom
- stops at yields like any other generator
  - yield a renderable (render fn / static template / inner generator) → renders and remembers
  - yield something else → returns the value
- update-calls re-render the last remembered renderable
- a change to a DECLARED attribute re-renders as well, through `attributeChangedCallback`; an
  undeclared one (`class`, `style`, `data-*`) is not observed and does nothing
- assigning a declared prop (`el.items = […]`) re-renders too: the accessor validates and schedules
- update() can be awaited and resolves once the DOM is patched, after the renderable has fully settled

```typescript
import { component, html } from "grundlage";

customElements.define(
	"user-disclosure",
	component(function* ({ host }) {
		yield () => html`<p>loading…</p>`; // first render of a static template

		const user = yield fetchUser(); // yield a promise → the const becomes its resolved value

		let isExpanded = false;
		const toggle = async () => {
			isExpanded = !isExpanded;
			await host.update(); // resolves once the re-render is in the DOM
			host.scrollIntoView(); // safe now, DOM is current
		};

		yield () => html`
			<button onClick=${toggle}>${user.name}</button>
			${isExpanded ? html`<pre>${JSON.stringify(user, null, 2)}</pre>` : null}
		`; // second render, replaces loading → will re-render on update calls
	}),
);
```

### cleanup

- runs on the disconnectedCallback of the custom element (see the counter example in the [intro](#example))
- disconnect is confirmed a microtask later, so moving an element inside the DOM keeps the component alive

### errors

- uncaught errors in the main function body propagate to the custom element and render their error instead of the
  content (root #fail), leaving the rest of the page intact
- an error from a nested generator is thrown into the main body at its `yield` first, so a try/catch there handles it

```typescript
import { component, html } from "grundlage";

const props = { src: String };

customElements.define(
	"data-view",
	component(
		function* ({ src }) {
			if (!src) throw new Error("<data-view> requires a src"); // → root #fail

			let data;
			try {
				data = yield fetchJson(src);
			} catch (error) {
				data = { error }; // handle locally instead of letting it reach #fail
			}

			yield () => html`<p>${data.error ? "failed" : data.title}</p>`;
		},
		{ props },
	),
);
```

Inputs are declared in `component(gen, { props })` and arrive on the generator's one argument
[see props](#props).

## components

### rendering

- yielding a template ``yield html`...` `` directly will not re-render it again. It can be dynamic but will not update
- most parts of the component can be dynamic
  - content (raw values, nested templates, lists)
  - comments (from the second one on, the first dynamic comment is the row key, see [lists](#lists))
  - tags
  - attributes (names, values, parts of those)

```typescript
import { component, html } from "grundlage";

const props = { label: String, href: String, size: [String, "md"] };

customElements.define(
	"ui-badge",
	component(
		function* ({ label, href, size }) {
			// a plain yielded template never re-renders, so seeds are all it needs
			yield html`<a class="badge ${size}" href=${href}>${label}</a>`;
		},
		{ props },
	),
);
```

- yielding it as a render function ``yield ({ host }) => html`...` `` will recall the function and the dynamic values again
- the function has to return the template, everything else is up to the author

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
		yield () => {
			console.log("updated");

			return html`
				<button onClick=${toggle} aria-expanded=${isOpen ? "true" : "false"}>
					${isOpen ? "hide" : "show"}
				</button>
				<p hidden=${!isOpen}>details</p>
			`;
		}; // content and attributes both re-read each render
	}),
);
```

- a dynamic attribute whose value is `false`, `null`, or `undefined` is **removed** → that's exactly
  right for `hidden`, and wrong for an `aria-*` state, where `"false"` has to reach the DOM as literal
  text. Bind the string for those.
- the tag name and raw text slots (style / script / textarea) are their own binding forms:

```typescript
import { component, html } from "grundlage";

const SECTION_CSS = "h2, h3 { margin-block: 0 }";

const props = { level: [Number, 2] };

customElements.define(
	"section-block",
	component(
		function* ({ level }) {
			yield html`
            <h${level}>section title</h${level}> <!-- dynamic tag -->
            <style>${SECTION_CSS}</style>        <!-- raw slot -->
        `;
		},
		{ props },
	),
);
```

### composition

- html templates can be embedded in html templates → a template is just a value, so a helper can return one
- `yield` a generator function → a nested lifecycle that **restarts on every update**
- `yield*` a generator → a mixin that runs **once**, inline in this generator's single run

#### html in html

A template is a plain value. It can be passed around, returned from a helper, or dropped into another template.

```typescript
import { component, html } from "grundlage";

const statusBadge = (status) =>
	html`<em class="badge badge--${status}">${status}</em>`;

const props = { reference: String, status: String };

customElements.define(
	"order-row",
	component(
		function* () {
			yield ({ reference, status }) =>
				html`<p>${reference} ${statusBadge(status)}</p>`;
		},
		{ props },
	),
);
```

#### nested generator, a repeatable lifecycle

A yielded generator function is installed as a child task with its own setup → yield →
after-the-patch phases, and every parent `update()` tears it down (its returned cleanup runs) and
runs it again from the top. A FLIP animation (First, Last, Invert, Play) needs exactly these phases: the old positions
are read before the yield, and after the patch the elements are measured again, transformed back to their old spot, and
animated home:

```typescript
import { html } from "grundlage";

// captureRects and playFlip are user-land helpers and excluded for readability
export const flipList = (items, onShuffle) =>
	function* ({ host }) {
		const first = captureRects(host); // before the yield: old positions, read from the live DOM
		yield () => html`
			<button onClick=${onShuffle}>shuffle</button>
			<ul>
				${items.map(
					(item) => html`<li data-flip-id=${item.id}>${item.label}</li>`,
				)}
			</ul>
		`; // patched to the new order
		const last = captureRects(host); // after the patch, before paint
		playFlip(first, last); // invert each row to its old spot, then transition home
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

		yield flipList(items, shuffleItems);
	}),
);
```

#### mixin via yield*

`yield*` is plain JavaScript delegation: the inner generator's yields surface as this generator's
yields, so it becomes part of the **one** run of the outer body.
`update()` re-fires whichever render function was yielded last, no matter which generator it came from. So `yield*`
shares setup and first render, and it takes arguments:

```typescript
// user-card.ts, a self-contained component: its own loading → loaded lifecycle
import { html } from "grundlage";

// a mixin declares nothing, it takes whatever the caller hands it
export async function* userCard({ userId }) {
	yield () => html`<p aria-busy="true">loading…</p>`; // first paint

	const user = await fetchUser(userId);

	yield () => html`
		<article>
			<h3>${user.name}</h3>
			<p>${user.email}</p>
		</article>
	`; // replaces loading once the fetch settles
}
```

```typescript
import { component } from "grundlage";
import { userCard } from "./user-card.js";

const userCardProps = { userId: String };
const userPanelProps = { activeUserId: String };

// as its own element. The registration site decides the attribute names
customElements.define(
	"user-card",
	component(userCard, { props: userCardProps }),
);

// …or mixed into a parent:
customElements.define(
	"user-panel",
	component(
		async function* (componentProps) {
			// becomes this body's loading → loaded run, under the parent's own prop name
			yield* userCard({
				...componentProps,
				userId: componentProps.activeUserId,
			});
		},
		{ props: userPanelProps },
	),
);
```

The two `yield`s inside `userCard` are self-driven. The async generator walks loading → loaded on
its own, no `host.update()` involved.

The same generator could also be dropped in with no arguments at all: `yield userCard` is a generator function,
so it installs as a nested lifecycle and reads the parent's own `userid` attribute. The difference here is the
lifecycle. As `yield*` it runs once (and remembers only the renderables); as `yield` it is the renderable and re-runs
every update.

### host template

A library specific convenience: If the outermost element of a render output is a `<template>`, it is unwrapped. Its
children become the shadow DOM, and its attributes are applied to the custom element.

- every attribute form works: static · dynamic · mixed · boolean · spread · event handler
- attributes dropped by a later render are removed from the host
- must be the outermost node with no top-level siblings, otherwise it is parsed as an ordinary element
- a `<template>` carrying attributes in a nested position (content hole, list row) throws

```typescript
import { component, html } from "grundlage";

const props = { variant: [String, "default"] };

customElements.define(
	"pinnable-card",
	component(
		function* ({ host }) {
			let isPinned = false;
			const togglePin = () => {
				isPinned = !isPinned;
				host.update();
			};

			yield ({ variant }) => html`
				<template
					role="article"
					class="card card--${variant}"
					aria-pressed=${isPinned ? "true" : "false"}
					inert=${isPinned}
					onClick=${togglePin}
				>
					<slot></slot>
				</template>
			`;
		},
		{ props },
	),
);
```

Attributes can also be added by spreading out an object (key values) or an array (boolean attributes).

```typescript
import { component, html } from "grundlage";

customElements.define(
	"spread-card",
	component(function* () {
		const hostAttributes = { class: "card", role: "article", tabindex: "0" };
		yield () => html`<template ${hostAttributes}><slot></slot></template>`;
	}),
);
```

Each root render reverts the previous host attributes before applying the new ones, so an attribute
that is no longer rendered is removed.

### events

- native events in markup: `onClick=${handler}` (case-insensitive, `onclick` works as well)
- custom events: emit with `dispatchEvent`, listen with the `on-` prefix (`on-my-event=${handler}`)

```typescript
import { component, html } from "grundlage";

customElements.define(
	"search-box",
	component(function* ({ host }) {
		let query = "";
		const onInput = (event) => {
			query = event.target.value;
			host.update();
		};
		yield () => html`
			<input onInput=${onInput} placeholder="search" />
			<p>searching for ${query}</p>
		`;
	}),
);
```

A component talks to the outside world by dispatching a `CustomEvent` (`composed` to cross the
shadow boundary). A parent listens with the `on-` prefix. The hyphenated name is kept literally:

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
					composed: true,
				}),
			);
		yield () => html`<button onClick=${() => select("#f00")}>red</button>`;
	}),
);
```

```typescript
import { component, html } from "grundlage";

customElements.define(
	"swatch-picker",
	component(function* ({ host }) {
		let color = "#000";
		const pick = (event) => {
			color = event.detail;
			host.update();
		};
		yield () => html`
			<p style="color: ${color}">selected ${color}</p>
			<color-swatch on-swatch-select=${pick}></color-swatch>
		`;
	}),
);
```

A custom listener needs the `on-` prefix because otherwise `onSwatchSelect` would resolve to a non-existent
`onswatchselect` property (and never fire).

Global events are not bound in markup, they are registered manually.

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
		document.addEventListener("keydown", onKeydown);

		yield () => html`<dialog open=${isOpen}><slot></slot></dialog>`;

		return () => document.removeEventListener("keydown", onKeydown); // acquire in setup, release here
	}),
);
```

### conditionals

- inside a render function: a `? … : null` hole re-evaluates every update
- outside, in setup: branch once at mount when the two shapes need different setup
- an error is just another branch, renders a fallback instead of throwing

```typescript
import { component, html } from "grundlage";

const props = { items: [(incoming) => incoming, []] };

customElements.define(
	"accordion-list",
	component(
		function* ({ host }) {
			let expandedId = null;
			const toggle = (id) => {
				expandedId = expandedId === id ? null : id;
				host.update();
			};
			yield ({ items }) => html`
				<ul>
					${items.map(
						(item) => html`
							<li>
								<button
									onClick=${() => toggle(item.id)}
									aria-expanded=${expandedId === item.id}
								>
									${item.label}
								</button>
								${expandedId === item.id ? html`<p>${item.details}</p>` : null}
							</li>
						`,
					)}
				</ul>
			`;
		},
		{ props },
	),
);
```

`null`, `undefined`, `false` and `true` render nothing, while numbers, bigints and strings are always
rendered, `0`, `0n` and `""` included. `&&` returns its left operand when that operand is falsy, so
`${isOpen && html`…`}` renders nothing, but `${items.length && html`…`}` writes the text `"0"` on an
empty list.

When the two branches are the **same** template the hole patches in place; when they are **different**
templates the old subtree is torn down and the new one mounted, which resets focus, scroll and input
state inside it.

```typescript
import { component, html } from "grundlage";

const props = { readonly: [Boolean, false] };

customElements.define(
	"text-block",
	component(
		function* ({ host, readonly }) {
			// a setup-time branch is the one place that wants the seed
			if (readonly) {
				yield () => html`<pre>${host.textContent}</pre>`;
				return;
			}

			let draft = "";
			const onInput = (event) => {
				draft = event.target.value;
				host.update();
			};
			yield () => html`
				<textarea onInput=${onInput}></textarea>
				<p>${draft.length} characters</p>
			`;
		},
		{ props },
	),
);
```

Errors work the same way. The failure is held in state and rendered as a branch. Throwing is reserved for what a
component cannot recover from, because it replaces the whole shadow tree with [`#fail`](#errors):

```typescript
import { component, html } from "grundlage";

const props = { src: [String, ""] };

customElements.define(
	"safe-image",
	component(
		function* ({ host, src: initialSrc }) {
			let error = initialSrc ? null : new Error("missing src");

			yield ({ src }) =>
				error
					? html`<p role="alert">${error.message}</p>`
					: html`<img
							src=${src}
							alt=""
							onError=${() => {
								error = new Error("failed to load");
								host.update();
							}}
						/>`;
		},
		{ props },
	),
);
```

### lists

A list renders one row per array entry. Rows are matched by template identity and content, which covers most updates
without extra work.

- string / number / bigint → rendered as text (including `""`, `0`, `NaN`)
- `null` / `undefined` / `true` / `false` → render nothing (still occupy a row)
- nested array → the wrapper's content renders recursively
- anything else (plain object, `Date`, function, symbol) → throws

```typescript
import { component, html } from "grundlage";

customElements.define(
	"todo-list",
	component(function* ({ host }) {
		let todos = [
			{ id: 1, text: "walk the dog", done: false },
			{ id: 2, text: "write docs", done: true },
		];
		const toggle = (id) => {
			const todo = todos.find((entry) => entry.id === id);
			todo.done = !todo.done; // mutating in place is possible
			host.update();
		};
		yield () => html`
			<ul>
				${todos.map(
					(todo) => html`
						<li class=${todo.done ? "done" : ""}>
							<button onClick=${() => toggle(todo.id)}>
								${todo.done ? "✓" : "○"}
							</button>
							${todo.text}
						</li>
					`,
				)}
			</ul>
		`;
	}),
);
```

When template and content are not enough to tell rows apart, a **dynamic comment** `<!--${item.id}-->` can be used as a
key. It binds a row's DOM to that identity. The comment can sit anywhere in the row, and is stripped at parse time.

```typescript
import { component, html } from "grundlage";

customElements.define(
	"score-board",
	component(function* ({ host }) {
		let players = loadPlayers(); // [{ id, name, score }, …]
		const bump = (id) => {
			const player = players.find((entry) => entry.id === id);
			player.score += 1;
			players.sort((a, b) => b.score - a.score); // re-sorts AND changes content
			host.update();
		};
		yield () => html`
			<ol>
				${players.map(
					(player) => html`
						<!--${player.id}-->
						<li>
							<input placeholder="note" />
							<!-- unsaved text stays with the player, not the rank -->
							${player.name}: ${player.score}
							<button onClick=${() => bump(player.id)}>+1</button>
						</li>
					`,
				)}
			</ol>
		`;
	}),
);
```

The key is the **first dynamic comment** in the row template, wherever it sits. Only the expressions count, so the
content around can be anything: `<!--${player.id}-->`, `<!-- id: ${player.id} -->` and `<!-- key: ${player.id} -->`.

```typescript
import { component, html } from "grundlage";

const props = { tags: [(incoming) => incoming, []] }; // [{ id, label }, …]

customElements.define(
	"tag-line",
	component(
		function* () {
			yield ({ tags }) =>
				html`<p>${tags.map((tag) => html`<!--${tag.id}-->${tag.label}, `)}</p>`;
		},
		{ props },
	),
);
```

### async

The generator itself can be async, so `await` works inside the main function body. A yielded promise is awaited as well
and returns its resolved value.

```typescript
import { component, html } from "grundlage";

const props = { symbol: String };

customElements.define(
	"latest-price",
	component(
		async function* (componentProps) {
			yield ({ symbol }) => html`<p aria-busy="true">loading ${symbol}…</p>`; // SSR serializes this first paint

			const price = await fetchPrice(componentProps.symbol); // rejection throws here, wrap it in try/catch to handle it

			yield ({ symbol }) => html`<output>${symbol} ${price}</output>`; // client resumes and swaps it in
		},
		{ props },
	),
);
```

The server serializes the first yield (the loading view) and the client resumes from there, so the
`await` runs on the client. This loads once and cannot retry. For a fetch that should run again, the
data is better kept in a variable and re-rendered with `update()`.

### form components

- opting in with `{formAssociated: true}` ([see options](#options)) → swaps the base class so the element participates
  in forms
- `host.internals` is the `ElementInternals` handle: `setFormValue`, `setValidity`, etc.
- the four form callbacks re-dispatch as host events: `form-associated` `{form}` · `form-disabled` `{disabled}` ·
  `form-reset` (no detail) · `form-state-restore` `{state, mode}`
- react to them declaratively with `on-form-*` on the host `<template>`, or imperatively with `host.addEventListener`

```typescript
import { component, html } from "grundlage";

const props = { name: String, value: [String, ""] };

customElements.define(
	"text-field",
	component(
		function* ({ host, value: initial }) {
			// `initial` is deliberately a seed: the input is uncontrolled after the first paint
			let value = initial;
			let isDisabled = false;

			const internals = host.internals; // null on the server, so every use below is optional
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
				if (input) input.value = initial; // the input is uncontrolled: its dirty value survives an attribute write
				value = initial;
				publish();
				host.update();
			};

			publish(); // seed the form value before the first paint

			yield ({ name }) => html`
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
		},
		{ formAssociated: true, props },
	),
);
```

### styles

- fast path: every `${}` sits in a declaration **value** → one `setProperty` on this instance's own sheet, no host write
- structural holes (selector, property name, at-rule prelude) and a duplicated holed property → full text rewrite,
  correct but the browser reparses
- a dynamic value the browser rejects is dropped and the **previous** value stays; `!important` and `;` can't ride in
  through a hole
- each instance owns a private sheet; `getHTML` serializes the last text write, not later `setProperty` updates

```typescript
import { component, html } from "grundlage";

const props = { accent: [String, "rebeccapurple"] };

customElements.define(
	"progress-bar",
	component(
		function* ({ host }) {
			let progress = 0;
			const advance = () => {
				progress = Math.min(progress + 5, 100);
				host.update();
			};
			yield ({ accent }) => html`
				<style>
					.bar {
						width: ${progress}%;
						background: ${accent};
						transition: width 120ms ease-out;
					}
				</style>
				<div class="bar" onClick=${advance}></div>
			`;
		},
		{ props },
	),
);
```

A hole that is not a declaration value takes the text path. The whole sheet is recomposed and the
browser reparses it. A whole-sheet hole and any **structural** hole (selector, property name, at-rule
prelude) end up here:

```typescript
import { component, html } from "grundlage";

const props = { theme: [String, "light"] };

customElements.define(
	"themed-panel",
	component(
		function* () {
			yield ({ theme }) =>
				html`<style>
					${themeSheet(theme)}
				</style>`; // whole sheet is a hole → text path
		},
		{ props },
	),
);
```

### extending

- `component(fn)` returns a class, which can get subclassed to add methods, getters, or static fields
- the public API stays on the prototype instead of on the instance
- never hang methods/state off `host` at runtime ([see antipatterns](#antipatterns))

```typescript
import { component } from "grundlage";

const props = { tokens: [asTokenList, []] };

class TokenField extends component(
	function* () {
		// …generator body: reads its props, yields the render…
	},
	{ props },
) {
	get count() {
		// declared props are accessors on the class, so a subclass reads them off `this`
		return this.tokens.length;
	}

	clear() {
		this.tokens = []; // through the accessor: parsed, reflected, scheduled
	}
}

customElements.define("token-field", TokenField);
```

## options

| option           | default  | platform default | effect                                                                             |
| ---------------- | -------- | ---------------- | ---------------------------------------------------------------------------------- |
| `mode`           | `"open"` | `"open"`         | `open` exposes the root on `host.shadowRoot`; `closed` hides it there              |
| `serializable`   | `true`   | `false`          | the shadow root serializes with `getHTML`, required for SSR output and hydration   |
| `clonable`       | `true`   | `false`          | the shadow tree is copied on `cloneNode`, so cloned hosts keep their content       |
| `delegatesFocus` | `true`   | `false`          | focusing the host (click or `.focus()`) moves focus to the first focusable inside  |
| `formAssociated` | `false`  | n/a              | opt into form participation ([see components → form components](#form-components)) |
| `props`          | `{}`     | n/a              | the input schema: observed attributes, accessors and types ([see props](#props))   |

Any other `ShadowRootInit` field works too, e.g. `slotAssignment: "manual"`.

```typescript
import { component, html } from "grundlage";

const props = { label: String };

customElements.define(
	"secure-badge",
	component(
		function* () {
			// no host.shadowRoot here, outside code reaches the root via host.internals.shadowRoot
			yield ({ label }) => html`<span>${label}</span>`;
		},
		{ mode: "closed", props },
	),
);
```

## host api

The generator receives one object: `host` plus every declared prop. `host` is a `BaseComponent`:
a normal `HTMLElement` plus `update()`, `setProp()` and `internals`.

That object **is** the element's prop store, not a copy of it, so it is live: a read after an
`await` sees what the element holds at that moment. Destructuring takes a snapshot, and that is the
language's rule rather than the library's:

```typescript
element.setAttribute("userid", "8");
componentProps.userid; // "8", read now
componentProps.host.userid = "9"; // parse → reflect → update()
const frozen = { ...componentProps }; // a snapshot
```

Writing goes through `host`, and the type layer says so: the props half is handed out **readonly**.
Assigning to it directly would move a value that nothing parsed, reflected or scheduled on, so the
component silently stops repainting. `componentProps.host.userid = "9"` is the same spelling
outside code uses (`element.userid = "9"`).

Where you destructure decides what you get. The generator body runs once, so
`function* ({ label })` is a **seed**: right for an initial value or a mount-time branch, wrong for
anything that should track later writes. The render function runs per update, so
`` yield ({ label }) => html`…` `` is **live**, as is reading `componentProps.label` off the object
at any point. Examples in this README destructure in the render function by default, and in the
generator body only where the value is meant to be frozen.

### update()

The explicit re-render trigger, next to a declared-attribute change and a declared-prop assignment. It re-fires the last yielded renderable and
resolves once that is in the DOM (see
[lifecycle → mount & update](#mount--update)). Before the first render it's a no-op, and calls that land during an
in-flight pass coalesce onto it.

### setProp(name, value, oldValue?)

Outside code uses `setProp` to hand a value to a mounted component. A **declared** name is assigned
through that prop's own accessor, so it runs the prop's function, reflects and schedules, and
`null` or `undefined` is the absence that writes the fallback back. An undeclared name resolves the
way a dynamic attribute does: a stringable value is written as an **attribute**, anything else as a
**property**.

```typescript
const cell = document.querySelector("price-cell") as BaseComponent;
cell.setProp("currency", "EUR"); // parsed by String, reflected as currency="EUR"
cell.setProp("quote", { bid: 1.08, ask: 1.09 }); // parsed by asQuote, no attribute half
cell.setProp("quote", null); // absence → back to the fallback
```

```typescript
import { component, html } from "grundlage";

const asQuote = (incoming) =>
	typeof incoming === "object" && incoming !== null ? incoming : undefined;

const props = {
	currency: [String, "USD"],
	quote: [asQuote, { bid: 0, ask: 0 }],
};

customElements.define(
	"price-cell",
	component(
		function* () {
			yield (componentProps) => {
				// destructured per call, so each setProp is picked up on the next render
				const { currency, quote } = componentProps;
				return html`<output>${quote.bid} ${currency}</output>`;
			};
		},
		{ props },
	),
);
```

A framework binding a custom element usually calls `setProp` on its own; `oldValue` lets it detach a
previously-set event listener. A `setProp` only reaches the screen if the render function reads the
prop when it runs. A value destructured in the generator body is frozen at mount
([see host api](#host-api)).

## props

Inputs are declared once, in `component(gen, { props })`. The schema fixes the observed attributes and
installs one accessor per prop on the element class; the generator, its render functions and any inner
generator all receive the same object.

The schema is a plain object. Hoisting it above `customElements.define` puts the element's inputs in
one place, and gives you something to export when two elements share a shape. Every example below is
written that way.

An entry is a **function** taking whatever arrived and returning the value, or `undefined` to refuse
it. `String`, `Number`, `BigInt` and `Boolean` are shorthands for the four shipped functions, and
`[entry, fallback]` supplies what the function is called with when nothing was supplied.

```typescript
{
	label: String,              // string | undefined
	count: [Number, 0],         // number
	disabled: Boolean,          // boolean, absence is one of its two states
	items: [asTagList, []],     // Array<string>
	quote: asQuote,             // Quote | undefined
}
```

That is the whole schema. There is no required shape, no optional shape and no type guard. A prop is
its function, and the function is the only place a value is parsed or validated:

```typescript
const asTagList = (incoming) =>
	typeof incoming === "string" ? incoming.split(" ") : incoming;
```

A **string** means the value came from markup and needs parsing; anything else came from JS and is
already itself. One function serves both channels, so `<x-el items="a b">` and `el.items = ["a","b"]`
land on the same value.

```typescript
import { component, html } from "grundlage";

const props = {
	label: [String, "untitled"],
	count: [Number, 0],
	disabled: Boolean,
	items: [asTagList, []],
};

customElements.define(
	"labeled-count",
	component(
		function* () {
			yield ({ label, count, disabled }) =>
				html`<p aria-disabled=${disabled}>${label}: ${count}</p>`;
		},
		{ props },
	),
);
```

### one store, five rules

Every prop has one slot on the element, and both channels write it.

1. **One value per prop.** Last write wins, whichever channel it came from; nothing is compared
   across channels. On an upgrade the platform fixes that order: the constructor fills in the absent
   values, the attribute reactions deliver the markup, and `connectedCallback` replays whatever JS
   assigned before the class existed, so markup loses to a property assignment.
2. **Every incoming value runs through the prop's function**: markup, an assignment, a parent's
   binding, `setProp`, the fallback at construction.
3. **A refusal is ignored.** The function returning `undefined` means "not a value I accept": the
   previous value stays, the console warns, and nothing throws or re-renders.
4. **Absence is a write of the fallback.** `removeAttribute`, `el.x = undefined`, `el.x = null` and
   element construction are one code path, so nothing is required and no read fails. The fallback is
   not _restored_: the function is asked the same question and gives the same answer.
5. **A property assignment reflects**, when the value it settled on has a string spelling. An
   attribute arriving from markup does not: `count="007"` stays as written while `el.count` reads `7`.

```typescript
el.count = "7"; // parsed to 7, written as count="7", one update
el.count = 7; // the same value, no DOM write, no update
el.count = "nope"; // refused: still 7, count="7" untouched, one console warning
el.count = undefined; // absence → the fallback, reflected
```

### names and reflection

Attribute names are the lowercased prop name: `userId: String` observes `userid`, and `<my-el
userId="5">`, `<my-el userid="5">` and `setAttribute("userId", …)` all land on it. Every prop observes
one, whatever its function. A prop the attribute cannot carry never has one in practice.

Prop names must match `/^[a-z][a-zA-Z0-9_-]*$/`, and two props differing only in case throw at define
time. Every declared prop becomes an accessor on the element class, so a name already on the prototype
chain (`title`, `id`, `lang`, `hidden`, `update`, `setProp`, `internals`) throws at define time, as
does `host`, which the props object reserves, and any name starting with `on-`, which markup reads as a
custom event binding. Rename the prop.

A name that merely starts with `on` is fine. A binding asks whether the target declares the name
before it asks whether it looks like an event handler, so `once: String` is set as a prop rather than
bound as a listener for a `ce` event.

Reflection writes the value's own spelling: a string as itself, a number or bigint through
`String(value)`, `true` as `""`. A value with no spelling (an object, `undefined`) takes a stale
attribute **off**, and touches nothing when there was none, so an object-valued prop never writes to
the DOM at all.

### booleans

An HTML boolean attribute has two states and `[Boolean, true]` needs three, so the third one goes into
the attribute value:

| declaration        | absent  | `x` / `x=""` / `x="true"` | `x="false"` |
| ------------------ | ------- | ------------------------- | ----------- |
| `Boolean`          | `false` | `true`                    | `false`     |
| `[Boolean, false]` | `false` | `true`                    | `false`     |
| `[Boolean, true]`  | `true`  | `true`                    | `false`     |

Writing `true` writes `""`. Writing `false` removes the attribute where absence already means `false`,
and writes `"false"` where it does not, so `:host([disabled])` stays exact.

### fallbacks

A fallback belongs to the element that holds it, and it is written through the prop's own function at
construction, so what the generator reads has already been parsed.

- **copied** with `structuredClone`, deeply: any object-shaped value, so an array, a plain object, a
  `Map`, a `Set`, a `Date`, and any nested object inside them.
- **shared**: primitives, functions and `Template`s. A template is already shared by every render of
  its literal, and copying one would cost each element a parse-cache miss.

```typescript
{
	tags:   [asTagList, []],                                 // copied per element
	footer: [asHtml, html`<footer>made with <3</footer>`],    // shared
	onSave: [asCallback, () => {}],                           // shared, a function is a value here
}
```

A fallback `structuredClone` cannot reproduce (a class instance, an object holding a function)
throws at define time and names the remedy: put the default **inside** the function, where it runs
once per element.

```typescript
{
	selection: (incoming) => incoming ?? new SelectionRange(0, 0);
}
```

So does a fallback the prop's own function refuses (`[asNonEmptyList, []]`); the check calls the
function once, before any element exists. The fallback itself is **not** type-checked against the
entry. The type layer cannot see inside a function, and a define-time throw is clearer than the
compile error a correlated type would produce.

What the types do read is the shape: a bare entry is `T | undefined`, `[entry, fallback]` is `T`, and
a bare `Boolean` is `boolean`. The visible fallback is the only way to promise a value.

### props(element, schema)

The same schema read once, imperatively, from a plain `HTMLElement` that never went through
`component`, or for reading something deliberately left unobserved. It returns a snapshot and
re-normalizes the schema on every call, so it is the reduced spelling, not the primary one. An own
property under the prop name wins over the attribute (case intact); with neither, the prop's function
answers absence.

```typescript
import { props as readProps } from "grundlage";

const figureProps = { label: [String, ""] };

const { label } = readProps(document.querySelector("figure"), figureProps);
```

The rename is not required, but the export and the conventional name for a schema object collide, so
a module doing both has to give one of them another name.

## helpers

### load

`load(host, fetcher, options?)` is for data that is needed before the first render. On the server the fetcher
runs and its result is serialized into the markup; on the client that value is replayed **once** during
hydration so the fetcher doesn't run and every call after that runs normally. It returns a promise, so
`yield` it (or `await` it in an async generator):

```typescript
import { component, html, load } from "grundlage";

customElements.define(
	"user-name",
	component(function* ({ host }) {
		const user = yield load(host, () =>
			fetch("/api/user").then((response) => response.json()),
		);
		yield () => html`<p>${user.name}</p>`;
	}),
);
```

`options` is `{ key?, skipSsr? }`, or a bare string as shorthand for the key:

- `key`: a stable identity for the replay. Unkeyed replay is **positional** (first payload to first
  `load`), so a conditional or reordered `load` can hand the wrong data to the wrong call; a key pins
  each payload to its call. Grundlage warns when a payload goes unclaimed on hydration.
- `skipSsr`: nothing is serialized for replay. The fetcher still runs on the server, and the client always fetches.

## tools

### prerender plugin

- a Vite plugin that server-renders the project's components into `index.html`, in dev and in build
- opt in per element with a sentinel attribute (`ssr` by default), so only the marked instances prerender
- components are discovered by importing the project's source files and reading the element registry back
- anything it can't serialize is left untouched and rendered on the client

It ships as its own package, `vite-plugin-grundlage`, versioned separately and younger than the library:

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

There is no tag-to-module map to maintain. By default every source file under the Vite root is imported and the
tags those modules registered are read back from `customElements`, so module side effects do run at build time
(`node_modules`, `dist`, `build`, declaration files, test/spec/bench files and `*.config.*` are always skipped).
`include`/`exclude` globs narrow that down when needed: `include` replaces the default "everything" pattern,
`exclude` is added to the built-in skip list:

```typescript
prerenderWebcomponents({
	include: ["src/components/**/*.ts"],
	exclude: ["**/*.stories.ts"],
});
```

Component modules are loaded through Vite's own SSR pipeline, so TypeScript, extensionless and directory
imports, aliases and the project's own plugin transforms all work the way they do in the app. The plugin boots a
throwaway Vite server that re-runs the project's `vite.config`. That means the config is evaluated a second time per
build, so a plugin with heavy or one-shot side effects in `config`/`buildStart` sees them run twice; switch
to `componentLoader: "isolated"` for a bare loader that only inherits the `resolve` settings. Either way, a
module that throws while loading is reported and skipped rather than failing the build.

The plugin then scans `index.html` for elements carrying the sentinel attribute, and prerenders the ones
whose tag a scanned module actually defined:

```html
<click-counter start="3" ssr></click-counter>
<!-- prerendered into the page -->
<click-counter start="3"></click-counter>
<!-- left alone, rendered on the client -->
```

Light-DOM children are kept as they were written, next to the inlined shadow root, the browser projects
them into their `<slot>`s while parsing, so slotted content is styled and laid out at first paint too:

```html
<user-card ssr>
	<h2 slot="name">Ada</h2>
</user-card>
```

The children are attached to the host **before** the component mounts, so a component that reads its own
light DOM (`host.children`, `slot.assignedNodes()`) sees the real thing during prerender. A registered
component sitting in that light DOM is rendered along with its parent, sentinel or not.

**options**

| option                | default            | effect                                                                               |
| --------------------- | ------------------ | ------------------------------------------------------------------------------------ |
| `include`             | every source file  | globs (relative to the Vite root) of the modules to import for component definitions |
| `exclude`             | n/a                | globs added to the built-in skip list                                                |
| `componentLoader`     | `"project-config"` | `"isolated"` loads component modules without re-running the project's `vite.config`  |
| `sentinelAttribute`   | `"ssr"`            | the marker attribute that opts an element in                                         |
| `firstYieldTimeoutMs` | `5000`             | how long to wait for the first paint before giving up and leaving it for the client  |

The plugin degrades to client render whenever it can't serialize: a
`{ mode: "closed" }` root (happy-dom can't serialize it), a first-yield timeout, a tag no scanned module
defines, or any throw during prerender. Each case logs a `[prerender]` warning and ships a working page.

## antipatterns

Things the mental model makes tempting that tend to backfire:

- **imperative methods or state on `host`** (`host.save = …`, `host.close()`): state belongs in generator-local
  variables, communication outward happens with events, and a public API is added by subclassing
  ([see extending](#extending)). A property assigned in the generator only exists after `connectedCallback` ran, so
  other code can reach the element before the method is there.
- **mutating a class instance or `Date` and expecting a render**: change detection hashes plain data, but
  reference-typed values are compared by identity, so an in-place mutation reads as unchanged. Replace the reference or
  pass plain data.
- **mutating a prop in place** (`el.items.push(x)`): assignment re-renders, mutation does not. Reassign or call
  `host.update()`. `el.items = el.items` is enough, since a value that could have been mutated behind
  its reference is never called unchanged.
- **writing to the props object** (`componentProps.count = 5`): that object is the store, so the write would
  land without being parsed, reflected or scheduled on. It is typed readonly for that reason;
  `componentProps.host.count = 5` is the spelling that does all three.
- **reading attributes directly** (`host.getAttribute("count")`): they are strings, they skip the parsing,
  defaults and refusal the schema gives, and an undeclared attribute does not re-render at all.
- **destructuring props in the generator body and expecting them to update**: the body runs once, so those
  values are seeds. Destructure the render function's parameter, or read off the object, for live values.
- **`while (true)` in the generator**: it runs once to completion so this would create an infinite loop; per-frame work
  is what `update()` is for.
