import { describe, test, expect } from "vitest";
import { render, html } from "./index";

describe("component lifecycle", () => {
	let tagId = 0;

	/** generates a unique tag name per test to avoid collisions from customElements.define */
	const uniqueTag = () => `test-el-${tagId++}-${Date.now()}`;

	const mount = (tag: string): HTMLElement => {
		const el = document.createElement(tag);
		document.body.appendChild(el);
		return el;
	};

	const cleanup = (el: HTMLElement) => {
		el.remove();
	};

	test("mounts and renders into shadow DOM", async () => {
		const tag = uniqueTag();

		const MyEl = render(function* (el) {
			yield () => html`<p>hello</p>`;
		});

		customElements.define(tag, MyEl);
		const el = mount(tag);

		// wait for connectedCallback + initial render
		await new Promise((r) => setTimeout(r, 0));

		const p = el.shadowRoot?.querySelector("p");
		expect(p).not.toBeNull();
		expect(p?.textContent).toBe("hello");

		cleanup(el);
	});

	test("update() re-renders with new state", async () => {
		const tag = uniqueTag();
		let count = 0;

		const Counter = render(function* (el) {
			yield () => html`<span>${count}</span>`;
		});

		customElements.define(tag, Counter);
		const el = mount(tag) as InstanceType<typeof Counter>;

		await new Promise((r) => setTimeout(r, 0));
		expect(el.shadowRoot?.querySelector("span")?.textContent).toBe("0");

		count = 5;
		await el.update();
		// update batches via microtask, wait for it to flush
		await new Promise((r) => setTimeout(r, 0));

		expect(el.shadowRoot?.querySelector("span")?.textContent).toBe("5");

		cleanup(el);
	});

	test("disconnectedCallback cleans up", async () => {
		const tag = uniqueTag();
		let cleaned = false;

		const MyEl = render(function* (el) {
			yield () => html`<p>temp</p>`;
			return () => {
				cleaned = true;
			};
		});

		customElements.define(tag, MyEl);
		const el = mount(tag);

		await new Promise((r) => setTimeout(r, 0));
		cleanup(el);

		// disconnectedCallback waits a microtask before cleanup
		await new Promise((r) => setTimeout(r, 0));

		expect(cleaned).toBe(true);
	});
});
