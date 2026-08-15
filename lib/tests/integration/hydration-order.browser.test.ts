import { describe, expect, test } from "vitest";
import { component, html } from "../../src/index";

//a prop the attribute cannot carry is applied by the parent's hydration pass, so a child defined
//before its parent mounts with the prop absent. Needs a real browser: declarative shadow roots and
//shadow-including upgrade order are the two platform behaviours under test, and happy-dom has
//neither

const sleep = (duration = 0) =>
	new Promise((resolve) => setTimeout(resolve, duration));

//resolve as soon as first-yield content lands; a fixed sleep flakes on slower settle times
const waitForShadowContent = async (element: Element, timeoutMs = 200) => {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (element.shadowRoot && element.shadowRoot.childNodes.length > 0) return;
		await sleep(0);
	}
};

class Quote {
	constructor(public text: string) {}
}

//the placeholder is built here rather than handed over as the fallback: a class instance is a
//fallback structuredClone cannot copy per element, and that throws at define time. The declared
//fallback is the string it is built from, which is what keeps the prop typed `Quote`
const asQuote = (incoming: unknown): Quote =>
	incoming instanceof Quote ? incoming : new Quote(String(incoming));

const QUOTE_TEXT = "the unexamined life is not worth living";
//what the child paints while nothing has supplied the prop yet
const NO_QUOTE_YET = "…";

describe.skipIf("happyDOM" in globalThis)("hydration order", () => {
	let tagId = 0;
	const uniqueSuffix = () => `${tagId++}-${Date.now()}`;

	const defineChildComponent = (childTag: string) =>
		customElements.define(
			childTag,
			component(
				//the parameter is destructured inside the render function, not in the parameter list:
				//the prop arrives after the first paint, and the live read is what picks it up
				function* (componentProps) {
					yield () =>
						html`<blockquote>${componentProps.quote.text}</blockquote>`;
				},
				{ props: { quote: [asQuote, NO_QUOTE_YET] } },
			),
		);

	const defineParentComponent = (parentTag: string, childTag: string) =>
		customElements.define(
			parentTag,
			component(function* () {
				const quote = new Quote(QUOTE_TEXT);
				yield () =>
					html`<article><${childTag} quote=${quote}></${childTag}></article>`;
			}),
		);

	//the returned tags are undefined, so each test drives the define order itself. The server pass
	//has to define its own tags to render at all, so the client tags are distinct names and the
	//serialized child tag is rewritten to match
	const prerenderParentWithChild = async (): Promise<{
		markup: string;
		parentTag: string;
		childTag: string;
	}> => {
		const suffix = uniqueSuffix();
		const serverChildTag = `hydration-order-child-server-${suffix}`;
		const serverParentTag = `hydration-order-parent-server-${suffix}`;
		const clientChildTag = `hydration-order-child-${suffix}`;
		const clientParentTag = `hydration-order-parent-${suffix}`;

		(globalThis as { __grundlage_ssr__?: boolean }).__grundlage_ssr__ = true;
		try {
			defineChildComponent(serverChildTag);
			defineParentComponent(serverParentTag, serverChildTag);

			const element = document.createElement(serverParentTag);
			document.body.appendChild(element);
			await waitForShadowContent(element);
			const child = element.shadowRoot?.querySelector(serverChildTag);
			if (child) await waitForShadowContent(child);

			const serialized = element.getHTML({ serializableShadowRoots: true });
			element.remove();
			//let the async disconnectedCallback drain before the next define
			await sleep();

			return {
				markup:
					`<${clientParentTag}>${serialized}</${clientParentTag}>`.replaceAll(
						serverChildTag,
						clientChildTag,
					),
				parentTag: clientParentTag,
				childTag: clientChildTag,
			};
		} finally {
			(globalThis as { __grundlage_ssr__?: boolean }).__grundlage_ssr__ = false;
		}
	};

	const parseServerMarkup = (markup: string): HTMLElement => {
		const wrapper = document.createElement("div");
		wrapper.setHTMLUnsafe(markup);
		const element = wrapper.firstElementChild as HTMLElement;
		document.body.appendChild(element);
		return element;
	};

	const childOf = (parent: HTMLElement, childTag: string): HTMLElement =>
		parent.shadowRoot?.querySelector(childTag) as HTMLElement;

	test("customElements.define upgrades elements already inside a parsed declarative shadow root, innermost define first", async () => {
		const suffix = uniqueSuffix();
		const outerTag = `upgrade-outer-${suffix}`;
		const innerTag = `upgrade-inner-${suffix}`;

		const holder = document.createElement("div");
		document.body.appendChild(holder);
		holder.setHTMLUnsafe(
			`<${outerTag}><template shadowrootmode="open"><${innerTag}></${innerTag}></template></${outerTag}>`,
		);

		const connectionLog: Array<string> = [];
		customElements.define(
			innerTag,
			class extends HTMLElement {
				connectedCallback() {
					connectionLog.push("inner");
				}
			},
		);

		//the whole bug depends on this being synchronous and on it happening at all
		expect(connectionLog).toEqual(["inner"]);

		customElements.define(
			outerTag,
			class extends HTMLElement {
				connectedCallback() {
					connectionLog.push("outer");
				}
			},
		);
		expect(connectionLog).toEqual(["inner", "outer"]);

		holder.remove();
	});

	test("server output carries the child's rendered value even though the prop itself is unserializable", async () => {
		const { markup, childTag } = await prerenderParentWithChild();

		expect(markup).toContain(QUOTE_TEXT);
		expect(markup).toContain(childTag);
		//parent root plus child root — the child was rendered on the server, not left empty
		expect(markup.match(/<template shadowrootmode=/g)?.length).toBe(2);
		expect(markup).not.toContain(NO_QUOTE_YET);
	});

	test("parent defined first hydrates cleanly", async () => {
		const { markup, parentTag, childTag } = await prerenderParentWithChild();
		const parent = parseServerMarkup(markup);

		defineParentComponent(parentTag, childTag);
		await sleep();
		defineChildComponent(childTag);
		await sleep();

		const child = childOf(parent, childTag);
		expect(child.shadowRoot?.textContent).toContain(QUOTE_TEXT);
		expect(child.shadowRoot?.textContent).not.toContain(NO_QUOTE_YET);

		parent.remove();
	});

	//the natural bundler order: a parent module imports its children, so child modules evaluate and
	//self-register first. Nothing is required, so nothing can be absent — the child paints its
	//fallback and the parent's hydration pass settles the second render on the real value
	test("child defined first hydrates to the parent's value", async () => {
		const { markup, parentTag, childTag } = await prerenderParentWithChild();
		const parent = parseServerMarkup(markup);

		defineChildComponent(childTag);
		await sleep();
		defineParentComponent(parentTag, childTag);
		await sleep();

		const child = childOf(parent, childTag);
		expect((child as HTMLElement & { quote?: Quote }).quote?.text).toBe(
			QUOTE_TEXT,
		);
		expect(child.shadowRoot?.textContent).toContain(QUOTE_TEXT);

		parent.remove();
	});

	//the prop nothing supplies is no longer an error, so the remaining question is what the
	//child shows: its own fallback, not a failure display
	test("a prop absent with no parent to supply it reads its fallback", async () => {
		const childTag = `hydration-order-orphan-${uniqueSuffix()}`;
		defineChildComponent(childTag);

		const child = document.createElement(childTag);
		document.body.appendChild(child);
		await sleep();

		expect(child.shadowRoot?.textContent).toContain(NO_QUOTE_YET);

		child.remove();
	});

	//two constraints: no microtask before the first paint, and connectedCallback stays synchronous.
	//what pins each is what is not between the DOM insertion and the assertion — no await, no
	//sleep, no tick
	describe("mount timing", () => {
		//each level logs three moments: the generator body running, its render function running,
		//and the body resuming past the yield — which only happens once that element has painted
		const defineNestedTrio = (
			trace: Array<string>,
			{ isOuterRenderAsync = false } = {},
		) => {
			const suffix = uniqueSuffix();
			const tags = {
				outer: `mount-a-${suffix}`,
				middle: `mount-b-${suffix}`,
				inner: `mount-c-${suffix}`,
			};

			const defineLevel = (
				name: string,
				tag: string,
				childTag: string | null,
			) => {
				const renderLevel = () => {
					trace.push(`${name}:render`);
					return childTag === null
						? html`<span>${name}</span>`
						: html`<${childTag}></${childTag}>`;
				};
				const isAsync = isOuterRenderAsync && childTag === tags.middle;
				customElements.define(
					tag,
					component(function* () {
						trace.push(`${name}:body`);
						yield isAsync ? async () => renderLevel() : renderLevel;
						trace.push(`${name}:painted`);
					}),
				);
			};

			defineLevel("a", tags.outer, tags.middle);
			defineLevel("b", tags.middle, tags.inner);
			defineLevel("c", tags.inner, null);
			return tags;
		};

		//deliberately not an async test, so it cannot accidentally await: a failure here means the
		//first paint moved behind a microtask. Renders run outer-in and bodies resume inner-out,
		//because each level's replaceChildren connects the next and that mount completes before it
		//returns
		test("CSR: the whole subtree mounts and paints inside the appendChild frame", () => {
			const trace: Array<string> = [];
			const tags = defineNestedTrio(trace);

			const outer = document.createElement(tags.outer);
			document.body.appendChild(outer);

			expect(trace).toEqual([
				"a:body",
				"a:render",
				"b:body",
				"b:render",
				"c:body",
				"c:render",
				"c:painted",
				"b:painted",
				"a:painted",
			]);

			outer.remove();
		});

		//the async render function has no await in it, so its body runs to completion in the append
		//frame and "a:render" lands synchronously. What defers is the paint, because the driver
		//awaits the returned promise: the microtask is the driver's, not the author's, and
		//everything below `a` waits on it
		test("CSR: an async render function at the top defers the subtree, not its own body", async () => {
			const trace: Array<string> = [];
			const tags = defineNestedTrio(trace, { isOuterRenderAsync: true });

			const outer = document.createElement(tags.outer);
			document.body.appendChild(outer);
			expect(trace).toEqual(["a:body", "a:render"]);
			expect(outer.shadowRoot?.childNodes.length).toBe(0);

			//the exact tick count is not the contract and is not asserted — synchronous vs not is
			await sleep();
			expect(trace).toEqual([
				"a:body",
				"a:render",
				"b:body",
				"b:render",
				"c:body",
				"c:render",
				"c:painted",
				"b:painted",
				"a:painted",
			]);

			outer.remove();
		});

		//serialization reads the element with no await, so the paint has to have happened by then.
		//the missing ":painted" entries are the server cancelling every task at the first paint
		test("SSR: the server run paints the whole subtree synchronously", () => {
			const trace: Array<string> = [];
			(globalThis as { __grundlage_ssr__?: boolean }).__grundlage_ssr__ = true;
			try {
				const tags = defineNestedTrio(trace);
				const outer = document.createElement(tags.outer);
				document.body.appendChild(outer);

				const serialized = outer.getHTML({ serializableShadowRoots: true });
				expect(serialized.match(/<template shadowrootmode=/g)?.length).toBe(3);
				expect(trace).toEqual([
					"a:body",
					"a:render",
					"b:body",
					"b:render",
					"c:body",
					"c:render",
				]);

				outer.remove();
			} finally {
				(globalThis as { __grundlage_ssr__?: boolean }).__grundlage_ssr__ =
					false;
			}
		});

		//a bundled parent module importing its children defines both in one task, so the parent's
		//hydration assigns the property before that task ends. This is the natural case, not a
		//lucky one
		test("hydration: with both defines in one task, the parent assigns the property before the task ends", async () => {
			const { markup, parentTag, childTag } = await prerenderParentWithChild();
			const parent = parseServerMarkup(markup);

			defineChildComponent(childTag);
			defineParentComponent(parentTag, childTag); //no await between

			const child = childOf(parent, childTag);
			expect((child as HTMLElement & { quote?: Quote }).quote?.text).toBe(
				QUOTE_TEXT,
			);

			parent.remove();
		});

		//the bound on that fix, and what defer-hydration does with it. A lazily-defined parent is
		//a whole task later, so no amount of microtask deferral reaches it. The mark turns that
		//from a wrong render into no render: the server's correct markup stays on screen and the
		//child sits inert for as long as the parent tag stays undefined
		test("hydration: a child whose parent never defines stays parked on the server's markup", async () => {
			//the parent tag is deliberately never defined — that is the case
			const { markup, childTag } = await prerenderParentWithChild();
			const parent = parseServerMarkup(markup);

			defineChildComponent(childTag);
			await sleep();

			const child = childOf(parent, childTag);
			//upgraded, so the store holds the fallback, but the generator never ran
			expect((child as HTMLElement & { quote?: Quote }).quote?.text).toBe(
				NO_QUOTE_YET,
			);
			expect(child.hasAttribute("defer-hydration")).toBe(true);
			expect(child.shadowRoot?.textContent).toContain(QUOTE_TEXT);

			parent.remove();
		});

		//why deferring is safe on the hydration path and nowhere else: the correct DOM is already
		//on screen, so a child that has not rendered yet still shows the server's markup and a
		//deferral has nothing to flash. In CSR the same deferral shows an empty shadow root
		test("hydration: the child's server markup is already correct before either tag is defined", async () => {
			const { markup, parentTag, childTag } = await prerenderParentWithChild();
			const parent = parseServerMarkup(markup);

			const child = childOf(parent, childTag);
			expect(child.shadowRoot?.textContent).toContain(QUOTE_TEXT);
			expect(customElements.get(parentTag)).toBeUndefined();

			parent.remove();
		});

		//the language rule the synchronous-mount guarantee rests on: an await that is never
		//evaluated never suspends, so the driver can be written as an async function and still run
		//a synchronous component to its paint inside the append frame
		test("a skipped await does not suspend", () => {
			const guardedTrace: Array<string> = [];
			const runGuarded = async (value: unknown) => {
				if (value instanceof Promise) value = await value;
				guardedTrace.push("body");
			};

			guardedTrace.push("before");
			void runGuarded(1);
			guardedTrace.push("after");
			expect(guardedTrace).toEqual(["before", "body", "after"]);

			const unguardedTrace: Array<string> = [];
			const runUnguarded = async (value: unknown) => {
				value = await value;
				unguardedTrace.push("body");
			};

			unguardedTrace.push("before");
			void runUnguarded(1);
			unguardedTrace.push("after");
			expect(unguardedTrace).toEqual(["before", "after"]);
		});
	});

	//the server marks a child it owes a value the attribute cannot carry, and the parent removes
	//the mark once its own hydration has made every assignment. What these pin is the order, not
	//the end state: the tests above already settle on the parent's value one render later, and
	//what the mark adds is that the child never renders without it
	describe("defer-hydration", () => {
		const defineCountingChild = (
			childTag: string,
		): { bodyRunsOf: () => number } => {
			let bodyRuns = 0;
			customElements.define(
				childTag,
				component(
					function* (componentProps) {
						bodyRuns++;
						yield () =>
							html`<blockquote>${componentProps.quote.text}</blockquote>`;
					},
					{ props: { quote: [asQuote, NO_QUOTE_YET] } },
				),
			);
			return { bodyRunsOf: () => bodyRuns };
		};

		test("the server writes the mark onto the child it owes a value", async () => {
			const { markup, parentTag, childTag } = await prerenderParentWithChild();
			const parent = parseServerMarkup(markup);

			expect(customElements.get(parentTag)).toBeUndefined();
			expect(childOf(parent, childTag).hasAttribute("defer-hydration")).toBe(
				true,
			);

			parent.remove();
		});

		//without the mark the count reads 1 here: the child mounts on its fallback and heals on the
		//parent's assignment one render later, which is the flash the mark removes
		test("a child defined first does not run until the parent has hydrated", async () => {
			const { markup, parentTag, childTag } = await prerenderParentWithChild();
			const parent = parseServerMarkup(markup);

			const { bodyRunsOf } = defineCountingChild(childTag);
			await sleep();
			expect(bodyRunsOf()).toBe(0);

			defineParentComponent(parentTag, childTag);
			await sleep();

			expect(bodyRunsOf()).toBe(1);
			const child = childOf(parent, childTag);
			expect(child.shadowRoot?.textContent).toContain(QUOTE_TEXT);
			expect(child.hasAttribute("defer-hydration")).toBe(false);

			parent.remove();
		});

		//the reverse order has to keep working, and it is the one a release-by-event would break:
		//by the time the child upgrades the mark is already gone, so nothing is waited on
		test("a parent defined first releases the mark before the child ever upgrades", async () => {
			const { markup, parentTag, childTag } = await prerenderParentWithChild();
			const parent = parseServerMarkup(markup);

			defineParentComponent(parentTag, childTag);
			await sleep();
			expect(childOf(parent, childTag).hasAttribute("defer-hydration")).toBe(
				false,
			);

			const { bodyRunsOf } = defineCountingChild(childTag);
			await sleep();

			expect(bodyRunsOf()).toBe(1);
			expect(childOf(parent, childTag).shadowRoot?.textContent).toContain(
				QUOTE_TEXT,
			);

			parent.remove();
		});

		test("a child owed only a stringable value is never marked and hydrates at define time", async () => {
			const suffix = uniqueSuffix();
			const serverChildTag = `defer-none-child-server-${suffix}`;
			const serverParentTag = `defer-none-parent-server-${suffix}`;
			const clientChildTag = `defer-none-child-${suffix}`;

			const defineLabelChild = (tag: string) =>
				customElements.define(
					tag,
					component(
						function* (componentProps) {
							yield () => html`<span>${componentProps.label}</span>`;
						},
						{ props: { label: [String, "none"] } },
					),
				);

			(globalThis as { __grundlage_ssr__?: boolean }).__grundlage_ssr__ = true;
			let markup: string;
			try {
				defineLabelChild(serverChildTag);
				customElements.define(
					serverParentTag,
					component(function* () {
						yield () =>
							html`<${serverChildTag} label=${"written"}></${serverChildTag}>`;
					}),
				);
				const element = document.createElement(serverParentTag);
				document.body.appendChild(element);
				await waitForShadowContent(element);
				markup = element
					.getHTML({ serializableShadowRoots: true })
					.replaceAll(serverChildTag, clientChildTag);
				element.remove();
				await sleep();
			} finally {
				(globalThis as { __grundlage_ssr__?: boolean }).__grundlage_ssr__ =
					false;
			}

			expect(markup).not.toContain("defer-hydration");
		});
	});
});
