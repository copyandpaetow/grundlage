import { describe, expect, test } from "vitest";
import { html, render } from "./index";

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

		const MyElement = render(function* () {
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

		const Counter = render(function* () {
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

		const MyElement = render(function* () {
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

		const MyElement = render(function* () {
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

		const Counter = render(function* () {
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

		const MyElement = render(function* () {
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

		const MyElement = render(function* (el) {
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

		const MyElement = render(function* () {
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

		const MyElement = render(function* () {
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

		const MyElement = render(function* () {
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

	test("generator receives shadow root from yield", async () => {
		const tag = uniqueTag();
		let receivedRoot: ShadowRoot | null = null;

		const MyElement = render(function* () {
			const root = yield () => html`<p>hello</p>`;
			receivedRoot = root as ShadowRoot;
		});

		customElements.define(tag, MyElement);
		const element = mount(tag);
		await sleep();

		expect(receivedRoot).toBe(element.shadowRoot);

		cleanup(element);
	});

	test("custom shadow root options are applied", async () => {
		const tag = uniqueTag();

		const MyElement = render(
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
