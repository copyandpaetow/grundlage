import { describe, expect, test, vi } from "vitest";
import { component, html } from "../index";
import { BaseComponent } from "../types";

//happy-dom neither upgrades an element in place — it builds a fresh instance and swaps it in,
//dropping the own property an author assigned before the definition arrived — nor paints a
//component nested inside another component's shadow root at all (true of 0.7.0 as well). Both
//are exactly what the pre-upgrade and parent-binding cases are about, so chromium carries them
const isRealBrowser =
	typeof (window as { happyDOM?: unknown }).happyDOM === "undefined";

const sleep = (duration = 0) =>
	new Promise((resolve) => setTimeout(resolve, duration));

let tagId = 0;
const uniqueTag = () => `declared-prop-${tagId++}-${Date.now()}`;

const asList = (incoming: unknown): Array<unknown> | undefined =>
	Array.isArray(incoming) ? incoming : undefined;
const asSlug = (incoming: unknown): string | undefined =>
	typeof incoming === "string" ? incoming : undefined;
const asCallback = (incoming: unknown): (() => void) | undefined =>
	typeof incoming === "function" ? (incoming as () => void) : undefined;

const mount = (tag: string): BaseComponent => {
	const element = document.createElement(tag) as BaseComponent;
	document.body.appendChild(element);
	return element;
};

const readProp = (element: BaseComponent, propName: string): unknown =>
	(element as unknown as Record<string, unknown>)[propName];

const writeProp = (
	element: BaseComponent,
	propName: string,
	value: unknown,
): void => {
	(element as unknown as Record<string, unknown>)[propName] = value;
};

describe("props the attribute cannot carry", () => {
	test("assigning through the accessor parses and re-renders", async () => {
		const tag = uniqueTag();
		customElements.define(
			tag,
			component(
				function* ({ host }) {
					yield () =>
						html`<p>${(readProp(host, "tags") as Array<string>).join()}</p>`;
				},
				{ props: { tags: [asList, ["a"]] } },
			),
		);
		const element = mount(tag);
		await sleep();
		expect(element.shadowRoot?.textContent).toContain("a");

		writeProp(element, "tags", ["b", "c"]);
		await element.update();
		expect(element.shadowRoot?.textContent).toContain("b,c");
		element.remove();
	});

	test("a refused value warns and leaves the previous one standing", async () => {
		const tag = uniqueTag();
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		customElements.define(
			tag,
			component(
				function* () {
					yield () => html`<p>x</p>`;
				},
				{ props: { tags: [asList, ["a"]] } },
			),
		);
		const element = mount(tag);
		await sleep();

		writeProp(element, "tags", "nope");
		expect(readProp(element, "tags")).toEqual(["a"]);
		expect(warn).toHaveBeenCalledWith(
			expect.stringContaining('prop "tags" refused a string'),
		);
		warn.mockRestore();
		element.remove();
	});

	test("assigning undefined is absence, which writes the fallback again", async () => {
		const tag = uniqueTag();
		customElements.define(
			tag,
			component(
				function* () {
					yield () => html`<p>x</p>`;
				},
				{ props: { tags: [asList, ["default"]] } },
			),
		);
		const element = mount(tag);
		await sleep();

		writeProp(element, "tags", ["mine"]);
		writeProp(element, "tags", undefined);
		expect(readProp(element, "tags")).toEqual(["default"]);
		element.remove();
	});

	test("a prop with no fallback reads undefined rather than failing", async () => {
		const tag = uniqueTag();
		customElements.define(
			tag,
			component(
				function* ({ host }) {
					yield () => html`<p>${String(readProp(host, "tags"))}</p>`;
				},
				{ props: { tags: asList } },
			),
		);
		const element = mount(tag);
		await sleep();
		expect(element.shadowRoot?.textContent).toContain("undefined");
		element.remove();
	});
});

describe("fallbacks", () => {
	test("a copied fallback belongs to the instance that holds it", async () => {
		const tag = uniqueTag();
		customElements.define(
			tag,
			component(
				function* () {
					yield () => html`<p>x</p>`;
				},
				{ props: { tags: [asList, []] } },
			),
		);
		const first = mount(tag);
		const second = mount(tag);
		await sleep();

		(readProp(first, "tags") as Array<string>).push("mine");
		expect(readProp(first, "tags")).toEqual(["mine"]);
		expect(readProp(second, "tags")).toEqual([]);
		first.remove();
		second.remove();
	});

	test("the fallback is written through the prop's own function", async () => {
		const tag = uniqueTag();
		const parse = vi.fn((incoming: unknown) => incoming);
		customElements.define(
			tag,
			component(
				function* () {
					yield () => html`<p>x</p>`;
				},
				{ props: { tags: [parse, ["seed"]] } },
			),
		);
		const element = mount(tag);
		await sleep();

		expect(readProp(element, "tags")).toEqual(["seed"]);
		expect(parse).toHaveBeenCalledWith(["seed"]);
		element.remove();
	});

	test("a function fallback is the value itself, not a factory", async () => {
		const tag = uniqueTag();
		const noop = () => {};
		customElements.define(
			tag,
			component(
				function* () {
					yield () => html`<p>x</p>`;
				},
				{ props: { onSelect: [asCallback, noop] } },
			),
		);
		const element = mount(tag);
		await sleep();
		expect(readProp(element, "onSelect")).toBe(noop);
		element.remove();
	});

	test("a per-element default lives inside the function", async () => {
		const tag = uniqueTag();
		customElements.define(
			tag,
			component(
				function* () {
					yield () => html`<p>x</p>`;
				},
				{ props: { openedAt: (incoming: unknown) => incoming ?? new Date() } },
			),
		);
		const first = mount(tag);
		const second = mount(tag);
		await sleep();

		expect(readProp(first, "openedAt")).toBeInstanceOf(Date);
		expect(readProp(first, "openedAt")).not.toBe(readProp(second, "openedAt"));
		first.remove();
		second.remove();
	});
});

describe("define-time checks", () => {
	test("a prop name already on the prototype chain is rejected", () => {
		expect(() =>
			component(
				function* () {
					yield () => html`<p>x</p>`;
				},
				{ props: { title: String } },
			),
		).toThrow(/already a property on the element/);
	});

	test('"host" is reserved', () => {
		expect(() =>
			component(
				function* () {
					yield () => html`<p>x</p>`;
				},
				{ props: { host: String } },
			),
		).toThrow(/"host" is reserved/);
	});

	test("two props differing only in case collide", () => {
		expect(() =>
			component(
				function* () {
					yield () => html`<p>x</p>`;
				},
				{ props: { userId: String, userid: String } },
			),
		).toThrow(/both map to the attribute "userid"/);
	});

	test("a fallback the prop's own function refuses is rejected", () => {
		expect(() =>
			component(
				function* () {
					yield () => html`<p>x</p>`;
				},
				{ props: { tags: [asList, "nope"] } },
			),
		).toThrow(/is not a value the prop accepts/);
	});

	test("a fallback that cannot be copied is rejected", () => {
		class Quote {
			constructor(readonly text: string) {}
		}
		expect(() =>
			component(
				function* () {
					yield () => html`<p>x</p>`;
				},
				{
					props: {
						quote: [(incoming: unknown) => incoming, new Quote("hi")],
					},
				},
			),
		).toThrow(/cannot be copied for each element/);
	});
});

describe("mount", () => {
	test("markup is read before the first render, without a seeding pass", async () => {
		const tag = uniqueTag();
		customElements.define(
			tag,
			component(
				function* ({ host }) {
					yield () => html`<p>${readProp(host, "label")}</p>`;
				},
				{ props: { label: [String, "anon"] } },
			),
		);
		const element = document.createElement(tag) as BaseComponent;
		element.setAttribute("label", "ada");
		document.body.appendChild(element);
		await sleep();

		expect(element.shadowRoot?.textContent).toContain("ada");
		element.remove();
	});

	test.skipIf(!isRealBrowser)(
		"a pre-upgrade own property is recovered through the accessor",
		async () => {
			const tag = uniqueTag();
			const parse = vi.fn((incoming: unknown) => incoming);
			const element = document.createElement(tag) as BaseComponent;
			writeProp(element, "tags", ["early"]);
			document.body.appendChild(element);

			customElements.define(
				tag,
				component(
					function* ({ host }) {
						yield () =>
							html`<p>${(readProp(host, "tags") as Array<string>).join()}</p>`;
					},
					{ props: { tags: parse } },
				),
			);
			await sleep();

			expect(Object.hasOwn(element, "tags")).toBe(false);
			expect(parse).toHaveBeenCalledWith(["early"]);
			expect(element.shadowRoot?.textContent).toContain("early");
			element.remove();
		},
	);
});

describe.skipIf(!isRealBrowser)(
	"a declared name routes through its accessor",
	() => {
		const childOf = (element: BaseComponent, tag: string): BaseComponent =>
			element.shadowRoot?.querySelector(tag) as BaseComponent;

		test("false against [Boolean, true] reads back false, not the fallback", async () => {
			customElements.define(
				"route-child-boolean",
				component(
					function* ({ host }) {
						yield () => html`<p>${String(readProp(host, "closable"))}</p>`;
					},
					{ props: { closable: [Boolean, true] } },
				),
			);
			const parentTag = uniqueTag();
			customElements.define(
				parentTag,
				component(function* () {
					yield () =>
						html`<route-child-boolean closable=${false}></route-child-boolean>`;
				}),
			);
			const parent = mount(parentTag);
			await sleep();

			const child = childOf(parent, "route-child-boolean");
			expect(child.shadowRoot?.textContent).toContain("false");
			//absence reads true for this shape, so removing the attribute would say the opposite
			expect(child.getAttribute("closable")).toBe("false");
			parent.remove();
		});

		test("a value the child's prop refuses warns in the parent's frame and paints on", async () => {
			const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
			customElements.define(
				"route-child-refusing",
				component(
					function* ({ host }) {
						yield () => html`<p>${String(readProp(host, "tags"))}</p>`;
					},
					{ props: { tags: asList } },
				),
			);
			const parentTag = uniqueTag();
			customElements.define(
				parentTag,
				component(function* () {
					yield () =>
						html`<route-child-refusing tags=${"oops"}></route-child-refusing>`;
				}),
			);
			const parent = mount(parentTag);
			await sleep();

			const child = childOf(parent, "route-child-refusing");
			expect(child.shadowRoot?.textContent).toContain("undefined");
			expect(warn).toHaveBeenCalledWith(
				expect.stringContaining('prop "tags" refused a string'),
			);
			warn.mockRestore();
			parent.remove();
		});

		test("a dropped binding writes absence, and the fallback comes back", async () => {
			customElements.define(
				"route-child-cleared",
				component(
					function* ({ host }) {
						yield () =>
							html`<p>${(readProp(host, "tags") as Array<string>).join()}</p>`;
					},
					{ props: { tags: [asList, ["default"]] } },
				),
			);
			const parentTag = uniqueTag();
			let tags: Array<string> | null = ["bound"];
			customElements.define(
				parentTag,
				component(function* () {
					yield () =>
						html`<route-child-cleared tags=${tags}></route-child-cleared>`;
				}),
			);
			const parent = mount(parentTag);
			await sleep();
			const child = childOf(parent, "route-child-cleared");
			expect(child.shadowRoot?.textContent).toContain("bound");

			tags = null;
			await parent.update();
			await sleep();

			expect(child.shadowRoot?.textContent).toContain("default");
			parent.remove();
		});

		test("a prop bound before its definition arrives survives to the first run", async () => {
			const parentTag = uniqueTag();
			customElements.define(
				parentTag,
				component(function* () {
					yield () => html`<route-child-late slug=${"ada"}></route-child-late>`;
				}),
			);
			const parent = mount(parentTag);
			await sleep();

			customElements.define(
				"route-child-late",
				component(
					function* ({ host }) {
						yield () => html`<p>${readProp(host, "slug")}</p>`;
					},
					{ props: { slug: [asSlug, "anon"] } },
				),
			);
			await sleep();

			const child = childOf(parent, "route-child-late");
			expect(child.shadowRoot?.textContent).toContain("ada");
			parent.remove();
		});

		test("false bound before its definition arrives does not read back as the fallback", async () => {
			const parentTag = uniqueTag();
			customElements.define(
				parentTag,
				component(function* () {
					yield () =>
						html`<route-child-late-boolean
							closable=${false}
						></route-child-late-boolean>`;
				}),
			);
			const parent = mount(parentTag);
			await sleep();

			customElements.define(
				"route-child-late-boolean",
				component(
					function* ({ host }) {
						yield () => html`<p>${String(readProp(host, "closable"))}</p>`;
					},
					{ props: { closable: [Boolean, true] } },
				),
			);
			await sleep();

			const child = childOf(parent, "route-child-late-boolean");
			expect(child.shadowRoot?.textContent).toContain("false");
			parent.remove();
		});
	},
);
