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

		// Move element to a new parent
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

		// Move to new parent
		const newParent = document.createElement("div");
		document.body.appendChild(newParent);
		newParent.appendChild(element);
		await sleep();

		// Should still be able to update after move
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

		const MyElement = component(function* (el) {
			yield () => html`<span>${el.getAttribute("data-label") ?? "none"}</span>`;
		});

		customElements.define(tag, MyElement);
		const element = mount(tag);
		await sleep();

		expect(element.shadowRoot?.querySelector("span")?.textContent).toContain(
			"none",
		);

		element.setAttribute("data-label", "updated");
		// MutationObserver fires asynchronously
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

		// After cleanup, update should be a no-op (render is nulled for errored components,
		// but for disconnected ones the render still exists — update just runs silently)
		count = 99;
		await element.update();
		await sleep();

		// The element still has its last rendered state
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

		// Three sync update() calls should batch into one re-render via the
		// `await Promise.resolve()` in update(): the first transitions IDLE → SCHEDULED
		// and the next two short-circuit on the SCHEDULED guard.
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
			// A bare HTMLTemplate yield installs a TEMPLATE_SOURCE_TYPE.STATIC source —
			// update() should do nothing for it (no re-render, no generator restart).
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

		// With mode: "closed", shadowRoot is not accessible from outside
		expect(element.shadowRoot).toBeNull();

		cleanup(element);
	});
});

describe.skipIf("happyDOM" in globalThis)(
	"deferred custom-element upgrade",
	() => {
		//the realistic SSR / lazy-define scenario: createElement and DOM insertion happen before customElements.define, then the upgrade fires retroactively
		//we want to make sure constructor + connectedCallback run in the right order and that rendering proceeds normally without a separate code path
		//happy-dom does not implement retroactive upgrade — these tests only run against the real-browser project
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
			//setAttribute before upgrade is fine because the MutationObserver only attaches in connectedCallback (post-upgrade)
			//=> the first render reads the attribute through getAttribute as if it had always been there
			const tag = uniqueTag();

			const element = document.createElement(tag);
			element.setAttribute("data-label", "pre-define");
			document.body.appendChild(element);

			const MyElement = component(function* (host) {
				yield () =>
					html`<span>${host.getAttribute("data-label") ?? "none"}</span>`;
			});
			customElements.define(tag, MyElement);

			await sleep();

			expect(element.shadowRoot?.querySelector("span")?.textContent).toBe(
				"pre-define",
			);

			element.remove();
		});

		test("update() called before define is a no-op and does not throw post-upgrade", async () => {
			//if the user grabs the element via createElement and calls a method that doesn't exist yet (because the class hasn't been defined), the call should be ignored quietly
			//after define the element upgrades and renders fresh — the prior call should not have broken anything
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
			//now update() is on the prototype
			await (element as InstanceType<typeof MyElement>).update();
			await sleep();
			expect(element.shadowRoot?.querySelector("p")?.textContent).toBe("after");

			element.remove();
		});
	},
);

describe("MutationObserver and update() interleaving", () => {
	//the renderer batches updates through the scheduler's flushPromise/dirty pair: the first update() opens a flush, any update() arriving while flushPromise is open just flags dirty and rides the same promise
	//we have separate tests for "MO triggers re-render" and "update() coalesces", but nothing pins what happens when both arrive in the same task
	//these tests pin the contract: setAttribute on the host inside an update flush does not cause an extra render to land, because the MO callback's update() rides the open flushPromise instead of opening a second one
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
		//we trigger a render via update() and inside that render we observe whether a same-tick setAttribute (queued in user code right before update()) caused a second pass
		//the contract we pin: a MutationObserver callback firing while a flush is open rides the existing flushPromise (flagging dirty) rather than opening a second one, so the queued attribute mutation does not cause a duplicate render in the same task
		const tag = uniqueTag();
		let renderCount = 0;

		const MyElement = component(function* (host) {
			yield () => {
				renderCount++;
				return html`<span>${host.getAttribute("data-label") ?? "none"}</span>`;
			};
		});
		customElements.define(tag, MyElement);

		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();
		expect(renderCount).toBe(1);

		//both lines are sync — the MutationObserver microtask is queued; update() then opens the flush (sets flushPromise) in the same task
		element.setAttribute("data-label", "racy");
		element.update();
		await sleep(50);

		//we accept one extra render: the MO microtask's update() and the explicit update() both resolve to the one open flushPromise — the second just flags dirty, and runFlushLoop clears dirty at the top of the iteration that renders the already-mutated DOM
		//either ordering yields a single re-render, not two
		expect(renderCount).toBe(2);
		expect(element.shadowRoot?.querySelector("span")?.textContent).toContain(
			"racy",
		);

		element.remove();
	});

	test("setAttribute outside any active render still triggers exactly one re-render", async () => {
		//this is the lower bound: an attribute mutation arriving with the renderer fully idle must produce exactly one re-render (not zero, not multiple)
		//paired with the test above, the two pin both ends of the coalescing contract: idle-mutation = one render; mutation-during-update = one render
		const tag = uniqueTag();
		let renderCount = 0;

		const MyElement = component(function* (host) {
			yield () => {
				renderCount++;
				return html`<span>${host.getAttribute("data-label") ?? "none"}</span>`;
			};
		});
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
