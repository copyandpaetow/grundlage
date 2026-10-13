import { describe, expect, test } from "vitest";
import { html, component } from "../../src/index";

const sleep = (duration = 0) =>
	new Promise((resolve) => setTimeout(resolve, duration));

describe("component lifecycle", () => {
	let tagId = 0;

	const uniqueTag = () => `test-lifecycle-${tagId++}-${Date.now()}`;

	const mount = (tag: string): HTMLElement => {
		const element = document.createElement(tag);
		document.body.appendChild(element);
		return element;
	};

	const cleanup = (element: HTMLElement) => {
		element.remove();
	};

	test("mounts and renders into shadow DOM", async () => {
		const tag = uniqueTag();

		const MyElement = component(function* () {
			yield () => html`<p>hello</p>`;
		});

		customElements.define(tag, MyElement);
		const element = mount(tag);

		await sleep();

		const p = element.shadowRoot?.querySelector("p");
		expect(p).not.toBeNull();
		expect(p?.textContent).toBe("hello");

		cleanup(element);
	});

	test("update() re-renders with new state", async () => {
		const tag = uniqueTag();
		let count = 0;

		const Counter = component(function* () {
			yield () => html`<span>${count}</span>`;
		});

		customElements.define(tag, Counter);
		const element = mount(tag) as InstanceType<typeof Counter>;

		await sleep();
		expect(element.shadowRoot?.querySelector("span")?.textContent).toBe("0");

		count = 5;
		await element.update();
		await sleep();

		expect(element.shadowRoot?.querySelector("span")?.textContent).toBe("5");

		cleanup(element);
	});

	test("disconnectedCallback cleans up", async () => {
		const tag = uniqueTag();
		let cleaned = false;

		const MyElement = component(function* () {
			yield () => html`<p>temp</p>`;
			return () => {
				cleaned = true;
			};
		});

		customElements.define(tag, MyElement);
		const element = mount(tag);

		await sleep();
		cleanup(element);

		await sleep();

		expect(cleaned).toBe(true);
	});

	test("moving element in DOM does not trigger cleanup", async () => {
		const tag = uniqueTag();
		let cleaned = false;

		const MyElement = component(function* () {
			yield () => html`<p>movable</p>`;
			return () => {
				cleaned = true;
			};
		});

		customElements.define(tag, MyElement);
		const element = mount(tag);
		await sleep();

		const newParent = document.createElement("div");
		document.body.appendChild(newParent);
		newParent.appendChild(element);

		await sleep();

		expect(cleaned).toBe(false);
		expect(element.shadowRoot?.querySelector("p")?.textContent).toBe("movable");

		newParent.remove();
	});

	test("moving element preserves render state", async () => {
		const tag = uniqueTag();
		let count = 0;

		const Counter = component(function* () {
			yield () => html`<span>${count}</span>`;
		});

		customElements.define(tag, Counter);
		const element = mount(tag) as InstanceType<typeof Counter>;
		await sleep();

		count = 10;
		await element.update();
		await sleep();
		expect(element.shadowRoot?.querySelector("span")?.textContent).toBe("10");

		const newParent = document.createElement("div");
		document.body.appendChild(newParent);
		newParent.appendChild(element);
		await sleep();

		count = 20;
		await element.update();
		await sleep();
		expect(element.shadowRoot?.querySelector("span")?.textContent).toBe("20");

		newParent.remove();
	});

	test("yields a static HTMLTemplate (not a function)", async () => {
		const tag = uniqueTag();

		const MyElement = component(function* () {
			yield html`<p>static template</p>`;
		});

		customElements.define(tag, MyElement);
		const element = mount(tag);
		await sleep();

		expect(element.shadowRoot?.querySelector("p")?.textContent).toBe(
			"static template",
		);

		cleanup(element);
	});

	test("attribute mutation triggers re-render", async () => {
		const tag = uniqueTag();

		const MyElement = component(
			function* ({ host: el }) {
				yield () =>
					html`<span>${el.getAttribute("data-label") ?? "none"}</span>`;
			},
			{ props: { "data-label": String } },
		);

		customElements.define(tag, MyElement);
		const element = mount(tag);
		await sleep();

		expect(element.shadowRoot?.querySelector("span")?.textContent).toContain(
			"none",
		);

		element.setAttribute("data-label", "updated");
		await sleep(50);

		expect(element.shadowRoot?.querySelector("span")?.textContent).toContain(
			"updated",
		);

		cleanup(element);
	});

	test("update() with changed template structure re-mounts DOM", async () => {
		const tag = uniqueTag();
		let useList = false;

		const MyElement = component(function* () {
			yield () =>
				useList
					? html`<ul>
							<li>item</li>
						</ul>`
					: html`<p>paragraph</p>`;
		});

		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		expect(element.shadowRoot?.querySelector("p")).not.toBeNull();
		expect(element.shadowRoot?.querySelector("ul")).toBeNull();

		useList = true;
		await element.update();
		await sleep();

		expect(element.shadowRoot?.querySelector("p")).toBeNull();
		expect(element.shadowRoot?.querySelector("ul")).not.toBeNull();
		expect(element.shadowRoot?.querySelector("li")?.textContent).toBe("item");

		cleanup(element);
	});

	test("update() is a no-op after disconnect", async () => {
		const tag = uniqueTag();
		let count = 0;

		const MyElement = component(function* () {
			yield () => html`<span>${count}</span>`;
			return () => {};
		});

		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		cleanup(element);
		await sleep();

		//after cleanup, update should be a no-op (render is nulled for errored components,
		//but for disconnected ones the render still exists — update just runs silently)
		count = 99;
		await element.update();
		await sleep();

		//the element still has its last rendered state
		expect(element.shadowRoot?.querySelector("span")?.textContent).toBe("0");
	});

	test("multiple sync yields replace render functions in sequence", async () => {
		const tag = uniqueTag();

		const MyElement = component(function* () {
			yield () => html`<p>first</p>`;
			yield () => html`<p>second</p>`;
			yield () => html`<p>third</p>`;
		});

		customElements.define(tag, MyElement);
		const element = mount(tag);
		await sleep();

		expect(element.shadowRoot?.querySelector("p")?.textContent).toBe("third");

		cleanup(element);
	});

	test("generator receives the host element from yield", async () => {
		const tag = uniqueTag();
		let receivedHost: HTMLElement | null = null;

		const MyElement = component(function* () {
			const host = yield () => html`<p>hello</p>`;
			receivedHost = host as HTMLElement;
		});

		customElements.define(tag, MyElement);
		const element = mount(tag);
		await sleep();

		expect(receivedHost).toBe(element);

		cleanup(element);
	});

	test("update() coalesces rapid calls into a single re-render", async () => {
		const tag = uniqueTag();
		let renderCount = 0;

		const ComponentClass = component(function* () {
			yield () => {
				renderCount++;
				return html`<span>${renderCount}</span>`;
			};
		});
		customElements.define(tag, ComponentClass);

		const element = mount(tag) as InstanceType<typeof ComponentClass>;
		await sleep();
		expect(renderCount).toBe(1);

		//three sync update() calls should batch into one re-render via the
		//`await Promise.resolve()` in update(): the first transitions IDLE → SCHEDULED
		//and the next two short-circuit on the SCHEDULED guard
		const first = element.update();
		const second = element.update();
		const third = element.update();
		await Promise.all([first, second, third]);
		await sleep();

		expect(renderCount).toBe(2);
		cleanup(element);
	});

	test("update() is a no-op for a static (non-renderer) yield", async () => {
		const tag = uniqueTag();
		let timesGeneratorRan = 0;

		const ComponentClass = component(function* () {
			timesGeneratorRan++;
			//a bare HTMLTemplate yield installs a TEMPLATE_SOURCE_TYPE.STATIC source —
			//update() should do nothing for it (no re-render, no generator restart)
			yield html`<p>static-content</p>`;
		});
		customElements.define(tag, ComponentClass);

		const element = mount(tag) as InstanceType<typeof ComponentClass>;
		await sleep();
		expect(timesGeneratorRan).toBe(1);
		expect(element.shadowRoot?.querySelector("p")?.textContent).toBe(
			"static-content",
		);

		await element.update();
		await element.update();
		await sleep();

		expect(timesGeneratorRan).toBe(1);
		expect(element.shadowRoot?.querySelector("p")?.textContent).toBe(
			"static-content",
		);
		cleanup(element);
	});

	test("custom shadow root options are applied", async () => {
		const tag = uniqueTag();

		const MyElement = component(
			function* () {
				yield () => html`<p>closed</p>`;
			},
			{ mode: "closed", delegatesFocus: false },
		);

		customElements.define(tag, MyElement);
		const element = mount(tag);
		await sleep();

		//with mode: "closed", shadowRoot is not accessible from outside
		expect(element.shadowRoot).toBeNull();

		cleanup(element);
	});
});

describe.skipIf("happyDOM" in globalThis)(
	"deferred custom-element upgrade",
	() => {
		//the lazy-define shape: createElement and insertion happen before the define, and the upgrade
		//fires retroactively. happy-dom does not implement that, so only the real-browser project runs
		//these
		let tagId = 0;
		const uniqueTag = () => `test-upgrade-${tagId++}-${Date.now()}`;

		const sleep = (duration = 0) =>
			new Promise((resolve) => setTimeout(resolve, duration));

		test("element created and inserted before define is upgraded and renders", async () => {
			const tag = uniqueTag();

			const element = document.createElement(tag);
			document.body.appendChild(element);

			//before upgrade: no shadowRoot, no rendered content
			expect(element.shadowRoot).toBeNull();

			const MyElement = component(function* () {
				yield () => html`<p>upgraded</p>`;
			});
			customElements.define(tag, MyElement);

			await sleep();

			expect(element.shadowRoot?.querySelector("p")?.textContent).toBe(
				"upgraded",
			);

			element.remove();
		});

		test("attributes set before upgrade are visible to the generator on first render", async () => {
			//attributeChangedCallback replays every pre-existing attribute during upgrade, before
			//connectedCallback — update()'s early return absorbs those, so the first render is the
			//one that reads them and there is exactly one of it
			const tag = uniqueTag();
			let renderCount = 0;

			const element = document.createElement(tag);
			element.setAttribute("data-label", "pre-define");
			document.body.appendChild(element);

			const MyElement = component(
				//the count sits in the render function, not the body: an absorbed replay would re-call
				//this one, where the body runs once per mount whether the early return holds or not
				function* (componentProps) {
					yield () => {
						renderCount++;
						return html`<span>${componentProps["data-label"] ?? "none"}</span>`;
					};
				},
				{ props: { "data-label": String } },
			);
			customElements.define(tag, MyElement);

			await sleep();

			expect(element.shadowRoot?.querySelector("span")?.textContent).toBe(
				"pre-define",
			);
			expect(renderCount).toBe(1);

			element.remove();
		});

		test("update() called before define is a no-op and does not throw post-upgrade", async () => {
			//a method called before the class is defined does not exist yet and the call is ignored
			//quietly; the upgrade that follows still renders fresh
			const tag = uniqueTag();

			const element = document.createElement(tag) as HTMLElement & {
				update?: () => Promise<void>;
			};
			document.body.appendChild(element);

			//no .update() yet — the prototype has not been swapped in
			expect(element.update).toBeUndefined();

			const MyElement = component(function* () {
				yield () => html`<p>after</p>`;
			});
			customElements.define(tag, MyElement);

			await sleep();

			expect(element.shadowRoot?.querySelector("p")?.textContent).toBe("after");
			await (element as InstanceType<typeof MyElement>).update();
			await sleep();
			expect(element.shadowRoot?.querySelector("p")?.textContent).toBe("after");

			element.remove();
		});
	},
);

describe("MutationObserver and update() interleaving", () => {
	//the first update() opens a flush and any update() arriving while it is open only flags dirty and
	//rides the same promise. What these pin is the two arriving in one task: a setAttribute on the
	//host inside an open flush lands no extra render, because the MutationObserver callback's
	//update() rides that flush
	let tagId = 0;
	const uniqueTag = () => `test-observer-race-${tagId++}-${Date.now()}`;

	const sleep = (duration = 0) =>
		new Promise((resolve) => setTimeout(resolve, duration));

	const mount = (tag: string): HTMLElement => {
		const element = document.createElement(tag);
		document.body.appendChild(element);
		return element;
	};

	test("setAttribute fired while a sync update() is mid-flight does not double-render", async () => {
		//a same-tick setAttribute queued right before update(): its MutationObserver callback fires
		//while the flush is open, flags dirty and rides it, so the mutation lands no duplicate render
		const tag = uniqueTag();
		let renderCount = 0;

		const MyElement = component(
			function* ({ host }) {
				yield () => {
					renderCount++;
					return html`<span
						>${host.getAttribute("data-label") ?? "none"}</span
					>`;
				};
			},
			{ props: { "data-label": String } },
		);
		customElements.define(tag, MyElement);

		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();
		expect(renderCount).toBe(1);

		//both lines are synchronous: the MutationObserver microtask queues, then update() opens the
		//flush in the same task
		element.setAttribute("data-label", "racy");
		element.update();
		await sleep(50);

		//one extra render is accepted: both update() calls resolve to the single open flush, the second
		//only flags dirty, and the loop clears dirty at the top of the iteration that renders the
		//already-mutated DOM
		//either ordering yields a single re-render, not two
		expect(renderCount).toBe(2);
		expect(element.shadowRoot?.querySelector("span")?.textContent).toContain(
			"racy",
		);

		element.remove();
	});

	test("setAttribute outside any active render still triggers exactly one re-render", async () => {
		//the lower bound: a mutation arriving with the renderer idle produces exactly one re-render,
		//neither zero nor several. With the test above it pins both ends of coalescing
		const tag = uniqueTag();
		let renderCount = 0;

		const MyElement = component(
			function* ({ host }) {
				yield () => {
					renderCount++;
					return html`<span
						>${host.getAttribute("data-label") ?? "none"}</span
					>`;
				};
			},
			{ props: { "data-label": String } },
		);
		customElements.define(tag, MyElement);

		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();
		expect(renderCount).toBe(1);

		element.setAttribute("data-label", "settled");
		await sleep(50);

		expect(renderCount).toBe(2);
		expect(element.shadowRoot?.querySelector("span")?.textContent).toContain(
			"settled",
		);

		element.remove();
	});
});
