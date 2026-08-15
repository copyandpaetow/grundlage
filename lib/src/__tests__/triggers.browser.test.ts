import { describe, expect, test } from "vitest";
import { component, html } from "../index";
import { BaseComponent } from "../types";

const sleep = (duration = 0) =>
	new Promise((resolve) => setTimeout(resolve, duration));

let tagId = 0;
const uniqueTag = () => `trigger-el-${tagId++}-${Date.now()}`;

const mount = (tag: string): BaseComponent => {
	const element = document.createElement(tag) as BaseComponent;
	document.body.appendChild(element);
	return element;
};

describe("what an attribute write reaches", () => {
	test("a declared attribute re-renders; an undeclared one does not", async () => {
		const tag = uniqueTag();
		let renderCount = 0;
		customElements.define(
			tag,
			component(
				function* ({ host }) {
					yield () => {
						renderCount++;
						return html`<p>${host.getAttribute("label") ?? "none"}</p>`;
					};
				},
				{ props: { label: String } },
			),
		);
		const element = mount(tag);
		await sleep();
		expect(renderCount).toBe(1);

		element.setAttribute("class", "card");
		element.setAttribute("data-state", "open");
		await sleep();
		expect(renderCount).toBe(1);

		element.setAttribute("label", "ada");
		await sleep();
		expect(renderCount).toBe(2);
		element.remove();
	});

	test("re-setting the same string is not a change", async () => {
		const tag = uniqueTag();
		let renderCount = 0;
		customElements.define(
			tag,
			component(
				function* () {
					yield () => {
						renderCount++;
						return html`<p>x</p>`;
					};
				},
				{ props: { label: String } },
			),
		);
		const element = mount(tag);
		await sleep();

		element.setAttribute("label", "ada");
		await sleep();
		expect(renderCount).toBe(2);

		element.setAttribute("label", "ada");
		await sleep();
		expect(renderCount).toBe(2);
		element.remove();
	});

	test("removing a declared attribute re-renders into its fallback", async () => {
		const tag = uniqueTag();
		customElements.define(
			tag,
			component(
				function* ({ host }) {
					yield () =>
						html`<p>${(host as unknown as Record<string, unknown>).label}</p>`;
				},
				{ props: { label: [String, "anon"] } },
			),
		);
		const element = mount(tag);
		element.setAttribute("label", "ada");
		await sleep();
		expect(element.shadowRoot?.textContent).toContain("ada");

		element.removeAttribute("label");
		await sleep();
		expect(element.shadowRoot?.textContent).toContain("anon");
		element.remove();
	});

	test("N writes in one task coalesce into one render", async () => {
		const tag = uniqueTag();
		let renderCount = 0;
		customElements.define(
			tag,
			component(
				function* () {
					yield () => {
						renderCount++;
						return html`<p>x</p>`;
					};
				},
				{ props: { label: String, other: String } },
			),
		);
		const element = mount(tag);
		await sleep();

		element.setAttribute("label", "a");
		element.setAttribute("other", "b");
		element.setAttribute("label", "c");
		await sleep();
		expect(renderCount).toBe(2);
		element.remove();
	});

	test("the paint lands one microtask after the write, not two", async () => {
		const tag = uniqueTag();
		customElements.define(
			tag,
			component(
				function* ({ host }) {
					yield () => html`<p>${host.getAttribute("label") ?? "none"}</p>`;
				},
				{ props: { label: String } },
			),
		);
		const element = mount(tag);
		await sleep();

		element.setAttribute("label", "painted");
		await Promise.resolve();
		await Promise.resolve();
		expect(element.shadowRoot?.textContent).toContain("painted");
		element.remove();
	});
});

describe("the update window before the first renderable", () => {
	test("an attribute changed during a pre-yield await lands in the first paint", async () => {
		const tag = uniqueTag();
		let renderCount = 0;
		let releaseAwait: (() => void) | null = null;
		const gate = new Promise<void>((resolve) => {
			releaseAwait = resolve;
		});

		customElements.define(
			tag,
			component(
				async function* ({ host }) {
					yield gate;
					yield () => {
						renderCount++;
						return html`<p>${host.getAttribute("label") ?? "none"}</p>`;
					};
				},
				{ props: { label: String } },
			),
		);
		const element = mount(tag);
		element.setAttribute("label", "before");
		await sleep();

		element.setAttribute("label", "after");
		releaseAwait!();
		await sleep();

		//the rendered text, not the resolved prop: a paint that computes the new value and writes
		//nothing would pass the weaker assertion
		expect(element.shadowRoot?.textContent).toContain("after");
		expect(renderCount).toBe(1);
		element.remove();
	});

	test("an attribute changed while a first async render is pending renders once", async () => {
		const tag = uniqueTag();
		let renderCalls = 0;
		let releaseRender: (() => void) | null = null;
		const gate = new Promise<void>((resolve) => {
			releaseRender = resolve;
		});

		customElements.define(
			tag,
			component(
				function* ({ host }) {
					yield async () => {
						renderCalls++;
						const label = host.getAttribute("label") ?? "none";
						if (renderCalls === 1) await gate;
						return html`<p>${label}</p>`;
					};
				},
				{ props: { label: String } },
			),
		);
		const element = mount(tag);
		await sleep();
		expect(renderCalls).toBe(1);

		element.setAttribute("label", "second");
		await sleep();
		expect(renderCalls).toBe(2);
		expect(element.shadowRoot?.textContent).toContain("second");

		releaseRender!();
		await sleep();

		//the superseded first call's result is discarded when it settles, however late
		expect(element.shadowRoot?.textContent).toContain("second");
		element.remove();
	});
});

describe("a component writing its own host attributes", () => {
	test("a self-referential host binding settles rather than hangs", async () => {
		const tag = uniqueTag();
		let renderCount = 0;
		customElements.define(
			tag,
			component(
				function* ({ host }) {
					yield () => {
						renderCount++;
						const label = host.getAttribute("label") ?? "";
						return html`<template label="${label}!"><p>${label}</p></template>`;
					};
				},
				{ props: { label: [String, ""] } },
			),
		);
		const element = mount(tag);
		await sleep(50);

		//without the flag each pass would feed the next one and the microtask queue never drains
		expect(renderCount).toBeLessThan(5);
		expect(element.getAttribute("label")).toBe("!");
		element.remove();
	});

	test("a user write after the host bindings settle still re-renders", async () => {
		const tag = uniqueTag();
		let renderCount = 0;
		customElements.define(
			tag,
			component(
				function* ({ host }) {
					yield () => {
						renderCount++;
						return html`<template class="card"
							><p>${host.getAttribute("label") ?? "none"}</p></template
						>`;
					};
				},
				{ props: { label: String } },
			),
		);
		const element = mount(tag);
		await sleep();
		expect(renderCount).toBe(1);

		element.setAttribute("label", "user-write");
		await sleep();
		expect(renderCount).toBe(2);
		expect(element.getAttribute("class")).toBe("card");
		element.remove();
	});
});

//under the flag there is a real DOM, so attributeChangedCallback fires on the server too — what
//makes that safe is the paint region's flag plus the cancel that follows the single server paint
describe("a server run", () => {
	test("schedules nothing from an attribute write after its one paint", async () => {
		const tag = uniqueTag();
		let renderCount = 0;
		const ssrGlobal = globalThis as { __grundlage_ssr__?: boolean };
		ssrGlobal.__grundlage_ssr__ = true;
		try {
			customElements.define(
				tag,
				component(
					function* ({ host }) {
						yield () => {
							renderCount++;
							return html`<p>${host.getAttribute("label") ?? "none"}</p>`;
						};
					},
					{ props: { label: String } },
				),
			);
			const element = mount(tag);
			await sleep();
			expect(renderCount).toBe(1);

			element.setAttribute("label", "after-the-paint");
			await sleep();
			expect(renderCount).toBe(1);
			element.remove();
		} finally {
			ssrGlobal.__grundlage_ssr__ = false;
		}
	});
});
