//loaded by the plugin through vite's ssr pipeline, never imported by the test file itself:
//it needs the happy-dom globals the plugin installs first
import { component, html } from "../../lib/src";
import { load } from "../../lib/src/load";
import { TAGS } from "./tags";

customElements.define(
	TAGS.loadSingle,
	component(async function* (host) {
		const value = await load(host, () => Promise.resolve({ name: "Ada" }));
		yield () => html`<p>${value.name}</p>`;
	}),
);

customElements.define(
	TAGS.loadShared,
	component(async function* (host) {
		const id = host.getAttribute("data-id") ?? "?";
		//per-host serialization — each instance gets its own data-ssr script in its shadow root
		const value = await load(host, () => Promise.resolve(`payload-${id}`));
		yield () => html`<p>${id}:${value}</p>`;
	}),
);

customElements.define(
	TAGS.simple,
	component(function* () {
		yield () => html`<p>simple-first</p>`;
		yield () => html`<p>simple-second</p>`;
	}),
);

//touches web APIs outside the old hand-picked global list — a ReferenceError here means registration regressed
customElements.define(
	TAGS.wideWebApi,
	component(function* (host) {
		host.dispatchEvent(new CustomEvent("mounted"));
		const display = getComputedStyle(host).display;
		yield () => html`<p>display=${display || "block"}</p>`;
	}),
);

customElements.define(
	TAGS.withAttrs,
	component(function* (host) {
		yield () => html`<p>label=${host.getAttribute("data-label") ?? "none"}</p>`;
	}),
);

customElements.define(
	TAGS.asyncPreYield,
	component(function* () {
		const value = yield Promise.resolve("resolved-value");
		yield () => html`<p>${value as string}</p>`;
	}),
);

customElements.define(
	TAGS.falsePositive,
	component(function* () {
		yield () => html`<p>should-not-render</p>`;
	}),
);

customElements.define(
	TAGS.multiInstance,
	component(function* (host) {
		yield () => html`<p>${host.getAttribute("data-id") ?? "?"}</p>`;
	}),
);

customElements.define(
	TAGS.customSentinel,
	component(function* () {
		yield () => html`<p>custom-rendered</p>`;
	}),
);

customElements.define(
	TAGS.unmarked,
	component(function* () {
		yield () => html`<p>unmarked-rendered</p>`;
	}),
);

customElements.define(
	TAGS.noSentinel,
	component(function* () {
		yield () => html`<p>no-sentinel-rendered</p>`;
	}),
);

customElements.define(
	TAGS.neverYields,
	component(function* () {
		//parks before the first render yield — the prerender must time out, not hang
		yield new Promise(() => {});
		yield () => html`<p>unreachable</p>`;
	}),
);

customElements.define(
	TAGS.quotedAttrs,
	component(function* (host) {
		const expr = host.getAttribute("data-expr") ?? "none";
		const note = host.getAttribute("data-note") ?? "none";
		yield () => html`<p>expr=${expr} note=${note}</p>`;
	}),
);

customElements.define(
	TAGS.slotted,
	component(function* () {
		yield () => html`<div class="wrap"><slot></slot></div>`;
	}),
);

//reads its light DOM at mount — proves children are attached before the generator runs
customElements.define(
	TAGS.slotCounting,
	component(function* (host) {
		const childCount = host.children.length;
		yield () =>
			html`<p>children=${childCount}</p>
				<slot></slot>`;
	}),
);

customElements.define(
	TAGS.nestedChild,
	component(function* () {
		yield () => html`<em>nested-rendered</em>`;
	}),
);

customElements.define(
	TAGS.commented,
	component(function* () {
		yield () => html`<p>commented-rendered</p>`;
	}),
);

customElements.define(
	TAGS.selfNesting,
	component(function* (host) {
		const depth = host.getAttribute("data-depth") ?? "?";
		yield () =>
			html`<p>depth=${depth}</p>
				<slot></slot>`;
	}),
);

customElements.define(
	TAGS.closedRoot,
	component(
		function* () {
			yield () => html`<p>closed-rendered</p>`;
		},
		{ mode: "closed" },
	),
);
