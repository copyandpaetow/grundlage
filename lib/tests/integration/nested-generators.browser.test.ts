import { describe, expect, test, vi } from "vitest";
import { html, render } from "../../src/index";
import { BaseComponent, GeneratorFn } from "../../src/types";

const sleep = (duration = 0) =>
	new Promise((resolve) => setTimeout(resolve, duration));

let tagId = 0;
const uniqueTag = (prefix: string) =>
	`test-nested-gen-${prefix}-${tagId++}-${Date.now()}`;

const mount = (tag: string): HTMLElement => {
	const element = document.createElement(tag);
	document.body.appendChild(element);
	return element;
};

describe("outer yields a generator function (nested generator)", () => {
	test("inner generator renders its template", async () => {
		const tag = uniqueTag("render");
		customElements.define(
			tag,
			render(function* () {
				yield function* () {
					yield () => html`<p>inner</p>`;
				};
			}),
		);

		const element = mount(tag);
		await sleep();

		expect(element.shadowRoot?.querySelector("p")?.textContent).toBe("inner");
		element.remove();
	});

	test("inner generator can yield a static HTMLTemplate", async () => {
		const tag = uniqueTag("static");
		customElements.define(
			tag,
			render(function* () {
				yield function* () {
					yield html`<p>inner-static</p>`;
				};
			}),
		);

		const element = mount(tag);
		await sleep();

		expect(element.shadowRoot?.querySelector("p")?.textContent).toBe(
			"inner-static",
		);
		element.remove();
	});

	test("inner async generator awaits a promise then renders", async () => {
		const tag = uniqueTag("async-inner");
		customElements.define(
			tag,
			render(function* () {
				yield async function* () {
					yield new Promise<void>((resolve) => setTimeout(resolve, 10));
					yield () => html`<p>async-ready</p>`;
				};
			}),
		);

		const element = mount(tag);
		await sleep(40);

		expect(element.shadowRoot?.querySelector("p")?.textContent).toBe(
			"async-ready",
		);
		element.remove();
	});

	test("outer can install a nested generator after a static template", async () => {
		const tag = uniqueTag("static-then-gen");
		customElements.define(
			tag,
			render(function* () {
				yield html`<p>outer-static</p>`;
				yield function* () {
					yield () => html`<p>inner</p>`;
				};
			}),
		);

		const element = mount(tag);
		await sleep();

		expect(element.shadowRoot?.querySelector("p")?.textContent).toBe("inner");
		element.remove();
	});

	test("inner generator yielding a generator function throws and surfaces the error", async () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		const tag = uniqueTag("inner-yields-gen");

		customElements.define(
			tag,
			render(function* () {
				yield function* () {
					yield function* () {
						yield () => html`<p>too-deep</p>`;
					};
				};
			}),
		);

		const element = mount(tag);
		await sleep();

		expect(element.shadowRoot?.textContent).toContain(
			"Inner generators cannot yield generator functions",
		);
		warnSpy.mockRestore();
		element.remove();
	});
});

describe("update() with an active inner generator", () => {
	test("update() restarts the inner generator each time", async () => {
		const tag = uniqueTag("restart");
		const innerStarts: number[] = [];
		let counter = 0;

		const ComponentClass = render(function* () {
			yield function* () {
				const id = ++counter;
				innerStarts.push(id);
				yield () => html`<span>${id}</span>`;
			};
		});
		customElements.define(tag, ComponentClass);

		const element = mount(tag) as InstanceType<typeof ComponentClass>;
		await sleep();
		expect(element.shadowRoot?.querySelector("span")?.textContent).toBe("1");
		expect(innerStarts).toEqual([1]);

		await element.update();
		await sleep();
		expect(element.shadowRoot?.querySelector("span")?.textContent).toBe("2");

		await element.update();
		await sleep();
		expect(element.shadowRoot?.querySelector("span")?.textContent).toBe("3");
		expect(innerStarts).toEqual([1, 2, 3]);

		element.remove();
	});

	test("inner generator's per-restart cleanup runs before each restart", async () => {
		const tag = uniqueTag("inner-cleanup");
		const events: string[] = [];

		const ComponentClass = render(function* () {
			yield function* () {
				events.push("inner-start");
				yield () => html`<span>x</span>`;
				return () => events.push("inner-cleanup");
			};
		});
		customElements.define(tag, ComponentClass);

		const element = mount(tag) as InstanceType<typeof ComponentClass>;
		await sleep();
		expect(events).toEqual(["inner-start"]);

		await element.update();
		await sleep();
		expect(events).toEqual([
			"inner-start",
			"inner-cleanup",
			"inner-start",
		]);

		element.remove();
		await sleep();
		expect(events[events.length - 1]).toBe("inner-cleanup");
	});
});

describe("disconnect cleanup with nested generators", () => {
	test("both outer and inner cleanups run on disconnect", async () => {
		const tag = uniqueTag("dual-cleanup");
		const events: string[] = [];

		customElements.define(
			tag,
			render(function* () {
				yield function* () {
					yield () => html`<span>x</span>`;
					return () => events.push("inner-cleanup");
				};
				return () => events.push("outer-cleanup");
			}),
		);

		const element = mount(tag);
		await sleep();
		element.remove();
		await sleep();

		expect(events).toContain("inner-cleanup");
		expect(events).toContain("outer-cleanup");
	});
});

describe("inner generator error contracts", () => {
	test("outer try/catch around the inner can recover by yielding new content", async () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		const tag = uniqueTag("recover");

		customElements.define(
			tag,
			render(function* () {
				try {
					yield function* () {
						yield () => {
							throw new Error("inner-failed");
						};
					};
				} catch {
					yield () => html`<p>recovered</p>`;
				}
			}),
		);

		const element = mount(tag);
		await sleep();

		expect(element.shadowRoot?.querySelector("p")?.textContent).toBe(
			"recovered",
		);
		// recovery path is silent — no console.warn
		expect(warnSpy).not.toHaveBeenCalled();
		warnSpy.mockRestore();
		element.remove();
	});

	test("outer catches and returns a cleanup: prior view persists, cleanup runs immediately", async () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		const tag = uniqueTag("catch-return");
		const events: string[] = [];

		// Outer commits a static view first, then installs an inner that
		// throws. Outer is parked at the inner-install yield when the error
		// propagates, so its catch fires and it returns a cleanup. Per the
		// error contract: #view (the static) persists and the captured outer
		// cleanup runs synchronously inside handleError.
		customElements.define(
			tag,
			render(function* () {
				try {
					yield html`<p>before</p>`;
					yield function* () {
						yield () => {
							throw new Error("inner-failed");
						};
					};
				} catch {
					return () => events.push("outer-cleanup-after-catch");
				}
			}),
		);

		const element = mount(tag);
		await sleep();

		expect(element.shadowRoot?.querySelector("p")?.textContent).toBe("before");
		expect(events).toEqual(["outer-cleanup-after-catch"]);
		// Recovery path is silent — no terminal warning.
		expect(warnSpy).not.toHaveBeenCalled();

		warnSpy.mockRestore();
		element.remove();
	});

	test("uncaught inner error becomes a terminal: warning + error text in shadow", async () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		const tag = uniqueTag("terminal");

		customElements.define(
			tag,
			render(function* () {
				yield function* () {
					yield () => {
						throw new Error("uncaught-inner");
					};
				};
			}),
		);

		const element = mount(tag);
		await sleep();

		expect(element.shadowRoot?.textContent).toContain("uncaught-inner");
		const sawWarning = warnSpy.mock.calls.some((call) =>
			String(call[0]).includes("uncaught-inner"),
		);
		expect(sawWarning).toBe(true);

		warnSpy.mockRestore();
		element.remove();
	});

	test("after a terminal error, update() is a no-op", async () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		const tag = uniqueTag("terminal-noop");
		let shouldThrow = true;

		const ComponentClass = render(function* () {
			yield function* () {
				yield () => {
					if (shouldThrow) throw new Error("terminal-boom");
					return html`<p>recovered</p>`;
				};
			};
		});
		customElements.define(tag, ComponentClass);

		const element = mount(tag) as InstanceType<typeof ComponentClass>;
		await sleep();
		expect(element.shadowRoot?.textContent).toContain("terminal-boom");

		shouldThrow = false;
		await element.update();
		await sleep();
		// outer was nulled; no recovery on subsequent update
		expect(element.shadowRoot?.textContent).toContain("terminal-boom");

		warnSpy.mockRestore();
		element.remove();
	});
});

describe("identity and isolation", () => {
	test("two host instances using the same nested generator render independently", async () => {
		// Inner generator is restarted on every update by design, so any state
		// held inside it does not survive an update. Isolation here is about
		// per-instance shadow roots, not retained inner state.
		const tag = uniqueTag("isolated");
		const innerGen: GeneratorFn = function* (element) {
			yield () => html`<span>${element.getAttribute("label") ?? "?"}</span>`;
		};

		customElements.define(
			tag,
			render(function* () {
				yield innerGen;
			}),
		);

		const first = mount(tag) as BaseComponent;
		first.setAttribute("label", "alpha");
		const second = mount(tag) as BaseComponent;
		second.setAttribute("label", "beta");
		await sleep(50);

		expect(first.shadowRoot).not.toBe(second.shadowRoot);
		expect(first.shadowRoot?.querySelector("span")?.textContent).toBe("alpha");
		expect(second.shadowRoot?.querySelector("span")?.textContent).toBe("beta");

		first.remove();
		second.remove();
	});
});
