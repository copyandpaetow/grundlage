import { describe, expect, test, vi } from "vitest";
import { html, component } from "../../src/index";

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

		const MyElement = component(async function* () {
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

		const Counter = component(async function* () {
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

		const MyElement = component(async function* () {
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

		const MyElement = component(async function* () {
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

		const MyElement = component(async function* () {
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

		const MyElement = component(async function* () {
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

		const MyElement = component(async function* () {
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

		const MyElement = component(async function* () {
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

		const MyElement = component(async function* ({ host: el }) {
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

		const MyElement = component(async function* () {
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

	//a rejected step bypasses the generator entirely and routes straight to the fatal display, so
	//unlike a resolved one it is not neutralized by the cancelled generator's return()
	test("an async step rejecting after disconnect paints nothing and stays silent", async () => {
		const tag = uniqueTag();
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

		customElements.define(
			tag,
			component(async function* () {
				yield () => html`<p>first</p>`;
				await sleep(40);
				throw new Error("async-step-rejected");
			}),
		);
		const element = mount(tag);
		await sleep(10);
		expect(element.shadowRoot?.querySelector("p")?.textContent).toBe("first");

		cleanup(element);
		await sleep(80);

		expect(element.shadowRoot?.innerHTML).toBe("<p>first</p>");
		expect(warnSpy).not.toHaveBeenCalled();
		warnSpy.mockRestore();
	});

	test("sync generator: render function error is shown in shadow DOM", async () => {
		const tag = uniqueTag();
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

		const MyElement = component(function* () {
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

		const MyElement = component(async function* () {
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

		const MyElement = component(function* () {
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

		const MyElement = component(async function* () {
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

		const MyElement = component(function* () {
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

		const MyElement = component(function* () {
			yield Promise.reject(new Error("promise rejection"));
		});

		customElements.define(tag, MyElement);
		const element = mount(tag);
		await sleep();

		expect(element.shadowRoot?.textContent).toContain("promise rejection");
		warnSpy.mockRestore();
		cleanup(element);
	});

	test("a rejected yielded promise is catchable with try/catch", async () => {
		//the try/catch form documented next to `yield fetch(url)` must intercept the
		//rejection so the generator can recover, not fail the whole component
		const tag = uniqueTag();
		let caught = false;

		const MyElement = component(function* () {
			try {
				yield Promise.reject(new Error("boom"));
			} catch {
				caught = true;
			}
			yield () => html`<p>recovered</p>`;
		});

		customElements.define(tag, MyElement);
		const element = mount(tag);
		await sleep();

		expect(caught).toBe(true);
		expect(element.shadowRoot?.textContent).toContain("recovered");
		expect(element.shadowRoot?.textContent).not.toContain("boom");

		cleanup(element);
	});

	test("error stops further updates", async () => {
		const tag = uniqueTag();
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

		const MyElement = component(function* () {
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

	test("an async render function renders after its microtask", async () => {
		const tag = uniqueTag();

		const MyElement = component(function* () {
			yield async () => {
				await sleep();
				return html`<p>awaited</p>`;
			};
		});

		customElements.define(tag, MyElement);
		const element = mount(tag);
		await sleep();

		expect(element.shadowRoot?.querySelector("p")?.textContent).toBe("awaited");
		cleanup(element);
	});

	test("an async render function re-fires on update() instead of painting its promise", async () => {
		const tag = uniqueTag();
		let renders = 0;

		const MyElement = component(function* () {
			yield async () => {
				renders++;
				await sleep();
				return html`<p>pass ${renders}</p>`;
			};
		});

		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();
		expect(element.shadowRoot?.textContent).toContain("pass 1");

		await element.update();
		await sleep();

		expect(renders).toBe(2);
		expect(element.shadowRoot?.textContent).toContain("pass 2");
		cleanup(element);
	});

	test("a rejected render promise is fatal and warns once", async () => {
		const tag = uniqueTag();
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

		const MyElement = component(function* () {
			yield async () => {
				await sleep();
				throw new Error("render-rejected");
			};
		});

		customElements.define(tag, MyElement);
		const element = mount(tag);
		await sleep();

		expect(element.shadowRoot?.textContent).toContain("render-rejected");
		expect(warnSpy).toHaveBeenCalledTimes(1);
		warnSpy.mockRestore();
		cleanup(element);
	});

	test("an async render function returning a generator function installs it", async () => {
		const tag = uniqueTag();

		const MyElement = component(function* () {
			yield async () => {
				await sleep();
				return function* body() {
					yield html`<p>installed-late</p>`;
				};
			};
		});

		customElements.define(tag, MyElement);
		const element = mount(tag);
		await sleep();

		expect(element.shadowRoot?.querySelector("p")?.textContent).toBe(
			"installed-late",
		);
		cleanup(element);
	});

	test("disconnecting before the render promise settles paints nothing", async () => {
		const tag = uniqueTag();

		const MyElement = component(function* () {
			yield async () => {
				await sleep(20);
				return html`<p>too-late</p>`;
			};
		});

		customElements.define(tag, MyElement);
		const element = mount(tag);
		cleanup(element);
		await sleep(40);

		expect(element.shadowRoot?.textContent).not.toContain("too-late");
	});

	test("a render function with a block body and no return warns about the missing return", async () => {
		const tag = uniqueTag();
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

		const MyElement = component(function* () {
			yield () => {
				html`<p>forgotten</p>`;
			};
		});

		customElements.define(tag, MyElement);
		const element = mount(tag);
		await sleep();

		expect(warnSpy).toHaveBeenCalledTimes(1);
		expect(String(warnSpy.mock.calls[0][0])).toContain("undefined");
		expect(element.shadowRoot?.querySelector("p")).toBeNull();
		warnSpy.mockRestore();
		cleanup(element);
	});
});

describe("a superseded render promise", () => {
	let tagId = 0;
	const uniqueTag = () => `test-superseded-${tagId++}-${Date.now()}`;

	const mount = (tag: string): HTMLElement => {
		const element = document.createElement(tag);
		document.body.appendChild(element);
		return element;
	};

	const cleanup = (element: HTMLElement) => {
		element.remove();
	};

	test("does not paint when it resolves after a newer call", async () => {
		const tag = uniqueTag();
		let calls = 0;

		const MyElement = component(function* () {
			yield async () => {
				const mine = ++calls;
				await sleep(mine === 1 ? 40 : 0);
				return html`<p>call ${mine}</p>`;
			};
		});

		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep(5);
		expect(element.shadowRoot?.textContent).toBe(""); //the first call is still pending

		element.update(); //supersedes it with a call that settles first
		await sleep(10);
		expect(element.shadowRoot?.textContent).toContain("call 2");

		await sleep(60); //the first call resolves late and must be dropped
		expect(element.shadowRoot?.textContent).toContain("call 2");
		expect(element.shadowRoot?.textContent).not.toContain("call 1");
		cleanup(element);
	});

	test("does not fail the component when it rejects after a newer call", async () => {
		const tag = uniqueTag();
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		let calls = 0;

		const MyElement = component(function* () {
			yield async () => {
				const mine = ++calls;
				if (mine === 1) {
					await sleep(40);
					throw new Error("superseded-rejection");
				}
				return html`<p>call ${mine}</p>`;
			};
		});

		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep(5);

		await element.update();
		expect(element.shadowRoot?.textContent).toContain("call 2");

		await sleep(60);
		//the stale rejection reaches a superseded render position: not fatal, not displayed
		expect(element.shadowRoot?.textContent).toContain("call 2");
		expect(element.shadowRoot?.textContent).not.toContain(
			"superseded-rejection",
		);
		expect(warnSpy).not.toHaveBeenCalled();
		warnSpy.mockRestore();
		cleanup(element);
	});

	test("await update() still resolves when dropping it leaves nothing else to", async () => {
		//the paint that used to resolve this promise was the stale one. with it dropped, the
		//outer's own COMPLETED has to resolve — it painted while DRIVING, so PAINT's guard did not
		const tag = uniqueTag();
		let calls = 0;

		const MyElement = component(function* () {
			yield async () => {
				const mine = ++calls;
				await sleep(mine === 1 ? 40 : 0);
				return html`<p>call ${mine}</p>`;
			};
		});

		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep(5); //the first call is still pending, the generator still parked at its yield

		await element.update(); //must resolve, and on the current content
		expect(element.shadowRoot?.textContent).toContain("call 2");
		cleanup(element);
	});

	test("a yielded promise is never treated as superseded", async () => {
		//the regression this guard invites: a refire bumps the generation while the generator is
		//parked at `yield promise`, and only that promise's resolution can resume it
		const tag = uniqueTag();
		let release: (value: string) => void = () => {};
		const gate = new Promise<string>((resolve) => {
			release = resolve;
		});
		let renders = 0;
		let resumed = false;

		const MyElement = component(function* () {
			yield () => html`<p>render ${++renders}</p>`;
			const label = yield gate;
			resumed = true;
			yield () => html`<p>${label}</p>`;
		});

		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();
		expect(renders).toBe(1);

		await element.update(); //bumps renderCallGeneration past the pending yielded promise
		expect(renders).toBe(2);
		expect(resumed).toBe(false);

		release("resumed");
		await sleep();
		expect(resumed).toBe(true);
		expect(element.shadowRoot?.textContent).toContain("resumed");
		cleanup(element);
	});
});
