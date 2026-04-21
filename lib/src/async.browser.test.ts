import { describe, expect, test, vi } from "vitest";
import { html, render } from "./index";

const sleep = (duration = 0) =>
	new Promise((resolve) => setTimeout(resolve, duration));

describe("async generator components", () => {
	let tagId = 0;
	const uniqueTag = () => `test-async-${tagId++}-${Date.now()}`;

	const mount = (tag: string): HTMLElement => {
		const element = document.createElement(tag);
		document.body.appendChild(element);
		return element;
	};

	const cleanup = (element: HTMLElement) => {
		element.remove();
	};

	test("mounts and renders from an async generator", async () => {
		const tag = uniqueTag();

		const MyElement = render(async function* () {
			yield () => html`<p>async hello</p>`;
		});

		customElements.define(tag, MyElement);
		const element = mount(tag);
		await sleep();

		const p = element.shadowRoot?.querySelector("p");
		expect(p).not.toBeNull();
		expect(p?.textContent).toBe("async hello");

		cleanup(element);
	});

	test("update() re-renders with new state", async () => {
		const tag = uniqueTag();
		let count = 0;

		const Counter = render(async function* () {
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

	test("yields a promise to await async work before rendering", async () => {
		const tag = uniqueTag();
		let data = "loading";

		const MyElement = render(async function* () {
			yield new Promise<void>((resolve) => {
				setTimeout(() => {
					data = "loaded";
					resolve();
				}, 10);
			});
			yield () => html`<p>${data}</p>`;
		});

		customElements.define(tag, MyElement);
		const element = mount(tag);

		await sleep(50);

		const p = element.shadowRoot?.querySelector("p");
		expect(p).not.toBeNull();
		expect(p?.textContent).toBe("loaded");

		cleanup(element);
	});

	test("disconnectedCallback cleans up", async () => {
		const tag = uniqueTag();
		let cleaned = false;

		const MyElement = render(async function* () {
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

	test("replaces multiple render functions in sequence", async () => {
		const tag = uniqueTag();

		const MyElement = render(async function* () {
			yield () => html`<p>first</p>`;
			yield () => html`<p>second</p>`;
		});

		customElements.define(tag, MyElement);
		const element = mount(tag);
		await sleep();

		expect(element.shadowRoot?.querySelector("p")?.textContent).toBe("second");

		cleanup(element);
	});

	test("yields multiple promises in sequence", async () => {
		const tag = uniqueTag();
		const order: string[] = [];

		const MyElement = render(async function* () {
			yield new Promise<void>((resolve) => {
				setTimeout(() => {
					order.push("first");
					resolve();
				}, 10);
			});
			yield new Promise<void>((resolve) => {
				setTimeout(() => {
					order.push("second");
					resolve();
				}, 10);
			});
			yield () => html`<p>${order.join(",")}</p>`;
		});

		customElements.define(tag, MyElement);
		const element = mount(tag);
		await sleep(100);

		expect(order).toEqual(["first", "second"]);
		expect(element.shadowRoot?.querySelector("p")?.textContent).toContain(
			"first,second",
		);

		cleanup(element);
	});

	test("yields a static HTMLTemplate from async generator", async () => {
		const tag = uniqueTag();

		const MyElement = render(async function* () {
			yield html`<p>async static</p>`;
		});

		customElements.define(tag, MyElement);
		const element = mount(tag);
		await sleep();

		expect(element.shadowRoot?.querySelector("p")?.textContent).toBe(
			"async static",
		);

		cleanup(element);
	});

	test("yields promise then render function", async () => {
		const tag = uniqueTag();
		let data = "loading";

		const MyElement = render(async function* () {
			// Show nothing initially, wait for data
			yield new Promise<void>((resolve) => {
				setTimeout(() => {
					data = "ready";
					resolve();
				}, 10);
			});
			// Then show render function with loaded data
			yield () => html`<p>${data}</p>`;
		});

		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep(50);

		expect(element.shadowRoot?.querySelector("p")?.textContent).toContain(
			"ready",
		);

		// Verify updates still work after async init
		data = "updated";
		await element.update();
		await sleep();

		expect(element.shadowRoot?.querySelector("p")?.textContent).toContain(
			"updated",
		);

		cleanup(element);
	});

	test("async generator receives element as argument", async () => {
		const tag = uniqueTag();
		let receivedElement: HTMLElement | null = null;

		const MyElement = render(async function* (el) {
			receivedElement = el;
			yield () => html`<p>check</p>`;
		});

		customElements.define(tag, MyElement);
		const element = mount(tag);
		await sleep();

		expect(receivedElement).toBe(element);

		cleanup(element);
	});

	test("async cleanup runs on disconnect", async () => {
		const tag = uniqueTag();
		const cleanupOrder: string[] = [];

		const MyElement = render(async function* () {
			yield new Promise<void>((resolve) => setTimeout(resolve, 10));
			yield () => html`<p>content</p>`;
			return () => {
				cleanupOrder.push("cleaned");
			};
		});

		customElements.define(tag, MyElement);
		const element = mount(tag);
		await sleep(50);

		expect(element.shadowRoot?.querySelector("p")?.textContent).toBe("content");

		cleanup(element);
		await sleep();

		expect(cleanupOrder).toEqual(["cleaned"]);
	});
});

describe("error handling", () => {
	let tagId = 0;
	const uniqueTag = () => `test-err-${tagId++}-${Date.now()}`;

	const mount = (tag: string): HTMLElement => {
		const element = document.createElement(tag);
		document.body.appendChild(element);
		return element;
	};

	const cleanup = (element: HTMLElement) => {
		element.remove();
	};

	test("sync generator: render function error is shown in shadow DOM", async () => {
		const tag = uniqueTag();
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

		const MyElement = render(function* () {
			yield () => {
				throw new Error("sync render error");
			};
		});

		customElements.define(tag, MyElement);
		const element = mount(tag);
		await sleep();

		expect(element.shadowRoot?.textContent).toContain("sync render error");
		warnSpy.mockRestore();
		cleanup(element);
	});

	test("async generator: render function error is shown in shadow DOM", async () => {
		const tag = uniqueTag();
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

		const MyElement = render(async function* () {
			yield () => {
				throw new Error("async render error");
			};
		});

		customElements.define(tag, MyElement);
		const element = mount(tag);
		await sleep();

		expect(element.shadowRoot?.textContent).toContain("async render error");
		warnSpy.mockRestore();
		cleanup(element);
	});

	test("sync generator: error in second yield is shown after first renders", async () => {
		const tag = uniqueTag();
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

		const MyElement = render(function* () {
			yield () => html`<p>works</p>`;
			yield () => {
				throw new Error("second yield error");
			};
		});

		customElements.define(tag, MyElement);
		const element = mount(tag);
		await sleep();

		expect(element.shadowRoot?.textContent).toContain("second yield error");
		warnSpy.mockRestore();
		cleanup(element);
	});

	test("async generator: error in second yield is shown after first renders", async () => {
		const tag = uniqueTag();
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

		const MyElement = render(async function* () {
			yield () => html`<p>works</p>`;
			yield () => {
				throw new Error("second yield error");
			};
		});

		customElements.define(tag, MyElement);
		const element = mount(tag);
		await sleep();

		expect(element.shadowRoot?.textContent).toContain("second yield error");
		warnSpy.mockRestore();
		cleanup(element);
	});

	test("error in update() is shown in shadow DOM", async () => {
		const tag = uniqueTag();
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		let shouldThrow = false;

		const MyElement = render(function* () {
			yield () => {
				if (shouldThrow) throw new Error("update error");
				return html`<p>ok</p>`;
			};
		});

		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		expect(element.shadowRoot?.querySelector("p")?.textContent).toBe("ok");

		shouldThrow = true;
		await element.update();
		await sleep();

		expect(element.shadowRoot?.textContent).toContain("update error");
		warnSpy.mockRestore();
		cleanup(element);
	});

	test("rejected yielded promise is shown in shadow DOM", async () => {
		const tag = uniqueTag();
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

		const MyElement = render(function* () {
			yield Promise.reject(new Error("promise rejection"));
		});

		customElements.define(tag, MyElement);
		const element = mount(tag);
		await sleep();

		expect(element.shadowRoot?.textContent).toContain("promise rejection");
		warnSpy.mockRestore();
		cleanup(element);
	});

	test("error stops further updates", async () => {
		const tag = uniqueTag();
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

		const MyElement = render(function* () {
			yield () => {
				throw new Error("fatal");
			};
		});

		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		expect(element.shadowRoot?.textContent).toContain("fatal");

		// further updates should be no-ops since #render was nulled
		await element.update();
		await sleep();

		expect(element.shadowRoot?.textContent).toContain("fatal");
		warnSpy.mockRestore();
		cleanup(element);
	});
});
