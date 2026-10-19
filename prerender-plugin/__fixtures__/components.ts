//loaded by the plugin through vite's ssr pipeline, never imported by the test file itself:
//it needs the happy-dom globals the plugin installs first
import { component, html } from "../../lib/src";
import { load } from "../../lib/src/load";
import { TAGS } from "./tags";

customElements.define(
	TAGS.loadSingle,
	component(function* () {
		const value = yield* load(() => Promise.resolve({ name: "Ada" }));
		yield function* view() {
			yield html`<p>${value.name}</p>`;
		};
	}),
);

customElements.define(
	TAGS.loadShared,
	component(function* ({ host }) {
		const id = host.getAttribute("data-id") ?? "?";
		//per-host serialization — each instance gets its own data-ssr script in its shadow root
		const value = yield* load(() => Promise.resolve(`payload-${id}`));
		yield function* view() {
			yield html`<p>${id}:${value}</p>`;
		};
	}),
);

customElements.define(
	TAGS.simple,
	component(function* () {
		yield function* view() {
			yield html`<p>simple-first</p>`;
		};
		yield function* view() {
			yield html`<p>simple-second</p>`;
		};
	}),
);

//touches web APIs outside the old hand-picked global list — a ReferenceError here means registration regressed
customElements.define(
	TAGS.wideWebApi,
	component(function* ({ host }) {
		host.dispatchEvent(new CustomEvent("mounted"));
		const display = getComputedStyle(host).display;
		yield function* view() {
			yield html`<p>display=${display || "block"}</p>`;
		};
	}),
);

customElements.define(
	TAGS.withAttrs,
	component(function* ({ host }) {
		yield function* view() {
			yield html`<p>label=${host.getAttribute("data-label") ?? "none"}</p>`;
		};
	}),
);

customElements.define(
	TAGS.asyncPreYield,
	component(function* () {
		const value: string = yield Promise.resolve("resolved-value");
		yield function* view() {
			yield html`<p>${value}</p>`;
		};
	}),
);

customElements.define(
	TAGS.falsePositive,
	component(function* () {
		yield function* view() {
			yield html`<p>should-not-render</p>`;
		};
	}),
);

customElements.define(
	TAGS.multiInstance,
	component(function* ({ host }) {
		yield function* view() {
			yield html`<p>${host.getAttribute("data-id") ?? "?"}</p>`;
		};
	}),
);

//the serializer leaves its root out either way: the mark on its host is what shows a server run
customElements.define(
	TAGS.optedOut,
	component(function* ({ host }) {
		host.setAttribute("data-ran", "");
		yield function* view() {
			yield html`<p>opted-out-rendered</p>`;
		};
	}),
);

customElements.define(
	TAGS.neverYields,
	component(function* () {
		//parks before the first paint — the prerender must time out, not hang
		yield new Promise(() => {});
		yield function* view() {
			yield html`<p>unreachable</p>`;
		};
	}),
);

customElements.define(
	TAGS.quotedAttrs,
	component(function* ({ host }) {
		const expr = host.getAttribute("data-expr") ?? "none";
		const note = host.getAttribute("data-note") ?? "none";
		yield function* view() {
			yield html`<p>expr=${expr} note=${note}</p>`;
		};
	}),
);

customElements.define(
	TAGS.slotted,
	component(function* () {
		yield function* view() {
			yield html`<div class="wrap"><slot></slot></div>`;
		};
	}),
);

//reads its light DOM at mount — proves children are attached before the generator runs
customElements.define(
	TAGS.slotCounting,
	component(function* ({ host }) {
		const childCount = host.children.length;
		yield function* view() {
			yield html`<p>children=${childCount}</p>
				<slot></slot>`;
		};
	}),
);

customElements.define(
	TAGS.nestedChild,
	component(function* () {
		yield function* view() {
			yield html`<em>nested-rendered</em>`;
		};
	}),
);

customElements.define(
	TAGS.commented,
	component(function* () {
		yield function* view() {
			yield html`<p>commented-rendered</p>`;
		};
	}),
);

customElements.define(
	TAGS.selfNesting,
	component(function* ({ host }) {
		const depth = host.getAttribute("data-depth") ?? "?";
		yield function* view() {
			yield html`<p>depth=${depth}</p>
				<slot></slot>`;
		};
	}),
);

customElements.define(
	TAGS.closedRoot,
	component(
		function* () {
			yield function* view() {
				yield html`<p>closed-rendered</p>`;
			};
		},
		{ mode: "closed" },
	),
);

//an open root the serializer must still leave out — the same shape every foreign web component
//has, since nothing but grundlage opts into `serializable`
customElements.define(
	TAGS.nonSerializableRoot,
	component(
		function* () {
			yield function* view() {
				yield html`<p>non-serializable-rendered</p>`;
			};
		},
		{ serializable: false },
	),
);

//light-DOM only, like many foreign custom elements: nothing to serialize, and connecting it would
//run its code for nothing
customElements.define(
	TAGS.withoutShadowRoot,
	class extends HTMLElement {
		connectedCallback() {
			(
				globalThis as { withoutShadowRootConnected?: boolean }
			).withoutShadowRootConnected = true;
		}
	},
);

customElements.define(
	TAGS.templatePrefixed,
	component(function* () {
		yield function* view() {
			yield html`<p>template-prefixed-rendered</p>`;
		};
	}),
);

//stands in for a component that touches what a server lacks, a canvas context or matchMedia
customElements.define(
	TAGS.throwsBeforePaint,
	component(function* () {
		throw new Error("server-thrown");
	}),
);

customElements.define(
	TAGS.rejectsBeforePaint,
	component(function* () {
		yield Promise.reject(new Error("server-rejected"));
		yield html`<p>unreachable</p>`;
	}),
);

//the tags are written out: a static template is what the parent clones, a dynamic tag is not
customElements.define(
	TAGS.throwerParent,
	component(function* () {
		yield html`<section>
			<ssr-throws-before-paint></ssr-throws-before-paint>
			<ssr-nested-child></ssr-nested-child>
		</section>`;
	}),
);

customElements.define(
	TAGS.paintsNestedChild,
	component(function* () {
		yield html`<div><ssr-nested-child></ssr-nested-child></div>`;
	}),
);

customElements.define(
	TAGS.rootWithoutFocusOrCloning,
	component(
		function* () {
			yield html`<p>without-focus-or-cloning-rendered</p>`;
		},
		{ delegatesFocus: false, clonable: false },
	),
);

customElements.define(
	TAGS.waitingChild,
	component(function* ({ host }) {
		const depth = Number(host.getAttribute("data-depth") ?? "1");
		yield new Promise((resolve) => setTimeout(resolve, 20));
		//a second level, so the plugin also waits for a child that only exists once its parent waited
		const grandchild =
			depth === 1
				? html`<ssr-waiting-child data-depth="2"></ssr-waiting-child>`
				: null;
		yield html`<b>${`waiting-child-${depth}`}</b>${grandchild}`;
	}),
);

customElements.define(
	TAGS.waitsForChild,
	component(function* () {
		yield html`<section><ssr-waiting-child></ssr-waiting-child></section>`;
	}),
);

customElements.define(
	TAGS.optsChildrenOut,
	component(function* () {
		yield html`<section>
			<ssr-opted-out ssr="false"></ssr-opted-out>
			<div ssr="false">
				<ssr-nested-child></ssr-nested-child>
				<ssr-multi-instance ssr data-id="opted-back-in"></ssr-multi-instance>
			</div>
		</section>`;
	}),
);

customElements.define(
	TAGS.holdsNeverYieldingChild,
	component(function* () {
		yield html`<section>
			<ssr-never-yields></ssr-never-yields>
			<ssr-nested-child></ssr-nested-child>
		</section>`;
	}),
);

//a loading container, as the pending-task protocol suggests: it stops the tasks of what it holds
customElements.define(
	TAGS.stopsPendingTasks,
	component(function* ({ host }) {
		host.addEventListener("pending-task", (event) => event.stopPropagation());
		yield html`<section>
			<ssr-waiting-child data-depth="2"></ssr-waiting-child>
		</section>`;
	}),
);

//another library's element, which the server runs wherever it sits
customElements.define(
	TAGS.foreignPainter,
	class extends HTMLElement {
		connectedCallback() {
			this.attachShadow({ mode: "open", serializable: true }).innerHTML =
				"<p>foreign-painted</p>";
		}
	},
);

//another library's element that paints in a later task and announces no pending-task
customElements.define(
	TAGS.foreignLatePainter,
	class extends HTMLElement {
		#shadowRoot = this.attachShadow({ mode: "open", serializable: true });
		connectedCallback() {
			setTimeout(() => {
				this.#shadowRoot.innerHTML = "<p>foreign-painted-late</p>";
			});
		}
	},
);
