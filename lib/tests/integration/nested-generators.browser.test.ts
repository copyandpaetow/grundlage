import { describe, expect, test, vi } from "vitest";
import { html, render } from "../../src/index";
import { BaseComponent, ComponentGenerator } from "../../src/types";

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
		expect(events).toEqual(["inner-start", "inner-cleanup", "inner-start"]);

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
		// error contract: #mountedTemplate (the static) persists and the captured outer
		// cleanup runs synchronously inside #onError.
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

describe("yield resumes the generator with the host element", () => {
	test("outer yielding a static template resumes with host", async () => {
		const tag = uniqueTag("outer-static-host");
		let received: unknown = null;

		customElements.define(
			tag,
			render(function* () {
				received = yield html`<p>static</p>`;
			}),
		);

		const element = mount(tag);
		await sleep();

		expect(received).toBe(element);
		element.remove();
	});

	test("outer yielding a renderer resumes with host", async () => {
		const tag = uniqueTag("outer-renderer-host");
		let received: unknown = null;

		customElements.define(
			tag,
			render(function* () {
				received = yield () => html`<p>renderer</p>`;
			}),
		);

		const element = mount(tag);
		await sleep();

		expect(received).toBe(element);
		element.remove();
	});

	test("outer yielding a generator function resumes with host", async () => {
		const tag = uniqueTag("outer-generator-host");
		let received: unknown = null;

		customElements.define(
			tag,
			render(function* () {
				received = yield function* () {
					yield () => html`<p>inner</p>`;
				};
			}),
		);

		const element = mount(tag);
		await sleep();

		expect(received).toBe(element);
		element.remove();
	});

	test("outer yield of a non-renderable value still passes through unchanged", async () => {
		const tag = uniqueTag("outer-passthrough");
		let received: unknown = null;

		customElements.define(
			tag,
			render(function* () {
				// A resolved promise is unwrapped by the driver; the resolved
				// value flows back as the yield result without being treated as
				// a render target. Confirms host-replacement only fires on
				// renderable yields.
				received = yield Promise.resolve("payload");
				yield () => html`<p>ok</p>`;
			}),
		);

		const element = mount(tag);
		await sleep();

		expect(received).toBe("payload");
		element.remove();
	});

	test("inner yielding a static template resumes with host", async () => {
		const tag = uniqueTag("inner-static-host");
		let received: unknown = null;

		customElements.define(
			tag,
			render(function* () {
				yield function* () {
					received = yield html`<p>inner-static</p>`;
				};
			}),
		);

		const element = mount(tag);
		await sleep();

		expect(received).toBe(element);
		element.remove();
	});

	test("inner yielding a renderer resumes with host", async () => {
		const tag = uniqueTag("inner-renderer-host");
		let received: unknown = null;

		customElements.define(
			tag,
			render(function* () {
				yield function* () {
					received = yield () => html`<p>inner-renderer</p>`;
				};
			}),
		);

		const element = mount(tag);
		await sleep();

		expect(received).toBe(element);
		element.remove();
	});

	test("host received from yield exposes the BaseComponent surface (update / setProperty)", async () => {
		const tag = uniqueTag("host-api");
		let counter = 0;

		const ComponentClass = render(async function* () {
			const host = (yield () => html`<span>${counter}</span>`) as BaseComponent;
			// Re-rendering through the received host proves it really is the
			// element instance and not just structurally similar.
			counter = 99;
			await host.update();
		});
		customElements.define(tag, ComponentClass);

		const element = mount(tag);
		await sleep();

		expect(element.shadowRoot?.querySelector("span")?.textContent).toBe("99");
		element.remove();
	});
});

describe("renderer and inner generator receive the host as their first argument", () => {
	test("outer renderer is invoked with the host element", async () => {
		const tag = uniqueTag("outer-renderer-arg");
		const received: unknown[] = [];

		customElements.define(
			tag,
			render(function* () {
				yield (host: BaseComponent) => {
					received.push(host);
					return html`<p>${host.tagName.toLowerCase()}</p>`;
				};
			}),
		);

		const element = mount(tag);
		await sleep();

		expect(received).toEqual([element]);
		expect(element.shadowRoot?.querySelector("p")?.textContent).toBe(tag);
		element.remove();
	});

	test("renderer receives the same host on every update", async () => {
		const tag = uniqueTag("renderer-arg-stable");
		const received: unknown[] = [];

		const ComponentClass = render(function* () {
			yield (host: BaseComponent) => {
				received.push(host);
				return html`<span>${received.length}</span>`;
			};
		});
		customElements.define(tag, ComponentClass);

		const element = mount(tag) as InstanceType<typeof ComponentClass>;
		await sleep();
		await element.update();
		await sleep();
		await element.update();
		await sleep();

		expect(received.length).toBe(3);
		expect(received[0]).toBe(element);
		expect(received[1]).toBe(element);
		expect(received[2]).toBe(element);
		element.remove();
	});

	test("inner renderer (yielded from inner generator) is invoked with the host element", async () => {
		const tag = uniqueTag("inner-renderer-arg");
		const received: unknown[] = [];

		customElements.define(
			tag,
			render(function* () {
				yield function* () {
					yield (host: BaseComponent) => {
						received.push(host);
						return html`<p>inner</p>`;
					};
				};
			}),
		);

		const element = mount(tag);
		await sleep();

		expect(received).toEqual([element]);
		element.remove();
	});

	test("inner generator function is invoked with the host element", async () => {
		const tag = uniqueTag("inner-gen-arg");
		let received: unknown = null;

		customElements.define(
			tag,
			render(function* () {
				yield function* (host: BaseComponent) {
					received = host;
					yield () => html`<p>${host.tagName.toLowerCase()}</p>`;
				};
			}),
		);

		const element = mount(tag);
		await sleep();

		expect(received).toBe(element);
		expect(element.shadowRoot?.querySelector("p")?.textContent).toBe(tag);
		element.remove();
	});

	test("inner async generator function is invoked with the host element", async () => {
		const tag = uniqueTag("inner-async-gen-arg");
		let received: unknown = null;

		customElements.define(
			tag,
			render(function* () {
				yield async function* (host: BaseComponent) {
					received = host;
					yield () => html`<p>async</p>`;
				};
			}),
		);

		const element = mount(tag);
		await sleep();

		expect(received).toBe(element);
		element.remove();
	});

	test("inner generator receives the host on every restart caused by update()", async () => {
		const tag = uniqueTag("inner-gen-arg-restart");
		const received: unknown[] = [];

		const ComponentClass = render(function* () {
			yield function* (host: BaseComponent) {
				received.push(host);
				yield () => html`<span>${received.length}</span>`;
			};
		});
		customElements.define(tag, ComponentClass);

		const element = mount(tag) as InstanceType<typeof ComponentClass>;
		await sleep();
		await element.update();
		await sleep();
		await element.update();
		await sleep();

		expect(received.length).toBe(3);
		expect(received.every((host) => host === element)).toBe(true);
		element.remove();
	});
});

describe("identity and isolation", () => {
	test("two host instances using the same nested generator render independently", async () => {
		// Inner generator is restarted on every update by design, so any state
		// held inside it does not survive an update. Isolation here is about
		// per-instance shadow roots, not retained inner state.
		const tag = uniqueTag("isolated");
		const innerGen: ComponentGenerator = function* (element) {
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

describe("inner generator post-yield work and cancellation", () => {
	// Async generators paused at an internal `await` cannot be force-unblocked
	// by .return() — the queued return only takes effect after the awaited
	// promise settles. Userland post-yield work that needs to react to a
	// disconnect must therefore use try/finally; the registered return-cleanup
	// only runs on a graceful completion.
	test("inner generator finally fires after disconnect once the pending await settles", async () => {
		const tag = uniqueTag("post-yield-finally");
		const events: string[] = [];
		let resolveAwait: (() => void) | null = null;

		customElements.define(
			tag,
			render(function* () {
				yield async function* () {
					yield () => html`<p>ready</p>`;
					try {
						await new Promise<void>((resolve) => {
							resolveAwait = resolve;
						});
						events.push("body-after-await");
					} finally {
						events.push("inner-finally");
					}
				};
			}),
		);

		const element = mount(tag);
		await sleep();
		expect(element.shadowRoot?.querySelector("p")?.textContent).toBe("ready");

		element.remove();
		await sleep();
		// Disconnect alone cannot unblock the pending await — finally has not
		// run yet. This documents the framework's contract: cancelGenerator() queues
		// a return on the async generator but does not abort in-flight awaits.
		expect(events).toEqual([]);

		resolveAwait?.();
		await sleep();
		// Once the await settles, the queued return processes and finally fires.
		// The body line after the await is skipped (queued return short-circuits).
		expect(events).toEqual(["body-after-await", "inner-finally"]);
	});

	test("post-yield cleanup is captured and runs when generator completes before disconnect", async () => {
		const tag = uniqueTag("post-yield-complete");
		const events: string[] = [];

		customElements.define(
			tag,
			render(function* () {
				yield async function* () {
					yield () => html`<p>ready</p>`;
					await Promise.resolve();
					events.push("post-yield-ran");
					return () => events.push("cleanup");
				};
			}),
		);

		const element = mount(tag);
		// Two macrotasks: one for outer install, one for the resolved
		// microtask + final return that captures cleanup.
		await sleep();
		await sleep();
		expect(events).toContain("post-yield-ran");

		element.remove();
		await sleep();
		expect(events).toContain("cleanup");
	});

	test("update() restart cancels an in-flight inner await; late resolution does not render", async () => {
		const tag = uniqueTag("restart-cancels-inflight");
		const events: string[] = [];
		let resolveSlow: (() => void) | null = null;
		let attempt = 0;

		const ComponentClass = render(function* () {
			yield async function* () {
				const id = ++attempt;
				yield () => html`<span>attempt-${id}</span>`;
				// Only the first attempt blocks on a slow promise we control;
				// subsequent restarts return after the first yield. That
				// keeps gen2's lifecycle short so the assertion targets the
				// stale path and not gen2's own progression.
				if (id === 1) {
					await new Promise<void>((resolve) => {
						resolveSlow = resolve;
					});
					// If this ever renders, the framework failed to suppress
					// stale resumption from the cancelled gen1.
					yield () => html`<span>late-1</span>`;
					events.push("completed-1");
				}
			};
		});
		customElements.define(tag, ComponentClass);

		const element = mount(tag) as InstanceType<typeof ComponentClass>;
		await sleep();
		expect(element.shadowRoot?.querySelector("span")?.textContent).toBe(
			"attempt-1",
		);

		await element.update();
		await sleep();
		expect(element.shadowRoot?.querySelector("span")?.textContent).toBe(
			"attempt-2",
		);

		resolveSlow?.();
		await sleep(20);

		expect(element.shadowRoot?.querySelector("span")?.textContent).toBe(
			"attempt-2",
		);
		expect(events).not.toContain("completed-1");

		element.remove();
	});

	test("try/finally in inner generator fires on update() restart", async () => {
		const tag = uniqueTag("inner-finally-restart");
		const events: string[] = [];

		const ComponentClass = render(function* () {
			yield function* () {
				try {
					yield () => html`<p>parked</p>`;
				} finally {
					events.push("inner-finally");
				}
			};
		});
		customElements.define(tag, ComponentClass);

		const element = mount(tag) as InstanceType<typeof ComponentClass>;
		await sleep();
		expect(events).toEqual(["inner-finally"]);

		await element.update();
		await sleep();
		// Restart cancels the prior inner — its finally fires, then a fresh
		// inner is parked at its own try/finally.
		expect(events).toEqual(["inner-finally", "inner-finally"]);

		element.remove();
	});

	test("async outer generator can host a nested inner generator", async () => {
		const tag = uniqueTag("async-outer-with-inner");

		customElements.define(
			tag,
			render(async function* () {
				yield function* () {
					yield () => html`<p>inner-from-async-outer</p>`;
				};
			}),
		);

		const element = mount(tag);
		await sleep();
		expect(element.shadowRoot?.querySelector("p")?.textContent).toBe(
			"inner-from-async-outer",
		);
		element.remove();
	});
});

// The website's generator-nesting demo (and any inner async generator with
// post-yield work) hits this pattern: user calls update() while an inner
// async generator is parked at an await. Today, #restartGenerator reuses the
// same source object and resets terminated=false. The cancelled generator's queued
// return eventually resolves and re-enters advanceGenerator() on that same source —
// and can mark the freshly restarted source terminated before its second yield lands.
describe("rapid restart with in-flight inner async work", () => {
	test("late resolution of cancelled inner await must not silence the restarted generator's later yields", async () => {
		const tag = uniqueTag("restart-stale-resolution");
		let resolveOldAwait: (() => void) | null = null;
		let attempt = 0;

		const ComponentClass = render(function* () {
			yield async function* () {
				const id = ++attempt;
				if (id === 1) {
					yield () => html`<span>attempt-${id}</span>`;
					await new Promise<void>((resolve) => {
						resolveOldAwait = resolve;
					});
					// Cancelled before this lands.
					yield () => html`<span>attempt-${id}-late</span>`;
				} else {
					// Second attempt does its own async work AFTER its first
					// yield. The window between this yield and the second yield
					// is when the cancelled gen1's queued return can fire.
					yield () => html`<span>attempt-${id}-first</span>`;
					await new Promise((resolve) => setTimeout(resolve, 20));
					yield () => html`<span>attempt-${id}-second</span>`;
				}
			};
		});
		customElements.define(tag, ComponentClass);

		const element = mount(tag) as InstanceType<typeof ComponentClass>;
		await sleep();
		expect(element.shadowRoot?.querySelector("span")?.textContent).toBe(
			"attempt-1",
		);

		// Restart while gen1 is parked at its await.
		await element.update();
		await sleep();
		expect(element.shadowRoot?.querySelector("span")?.textContent).toBe(
			"attempt-2-first",
		);

		// Resolve gen1's await: its queued return now drives the shared source.
		// If the bug is present, this flips source.terminated=true on gen2's source,
		// and gen2's next yield (attempt-2-second) is silently dropped.
		resolveOldAwait?.();
		await sleep(40);

		expect(element.shadowRoot?.querySelector("span")?.textContent).toBe(
			"attempt-2-second",
		);

		element.remove();
	});

	test("multiple stacked restarts: each cancelled generator's late resolution is contained", async () => {
		// Second-order version of the same bug. After two restarts, two
		// cancelled generators both have queued returns parked behind awaits
		// that share a single resolution channel. When they resolve, both fire
		// advanceGenerator(source, ...) on the current (third) source.
		const tag = uniqueTag("restart-stacked");
		let resolveAll: Array<() => void> = [];
		let attempt = 0;

		const ComponentClass = render(function* () {
			yield async function* () {
				const id = ++attempt;
				yield () => html`<span>attempt-${id}-first</span>`;
				if (id < 3) {
					await new Promise<void>((resolve) => {
						resolveAll.push(resolve);
					});
					yield () => html`<span>attempt-${id}-late</span>`;
				} else {
					await new Promise((resolve) => setTimeout(resolve, 20));
					yield () => html`<span>attempt-${id}-second</span>`;
				}
			};
		});
		customElements.define(tag, ComponentClass);

		const element = mount(tag) as InstanceType<typeof ComponentClass>;
		await sleep();
		await element.update();
		await sleep();
		await element.update();
		await sleep();
		expect(element.shadowRoot?.querySelector("span")?.textContent).toBe(
			"attempt-3-first",
		);

		// Drain the cancelled generators' awaits. Each queued return fires
		// advanceGenerator() on the shared source — gen3 must survive both.
		for (const resolve of resolveAll) resolve();
		await sleep(40);

		expect(element.shadowRoot?.querySelector("span")?.textContent).toBe(
			"attempt-3-second",
		);

		element.remove();
	});
});

// Documents the cleanup-on-cancel contract end-to-end. The website demo
// (lib/website/src/components/generator-nesting.ts) returns a cleanup that
// calls controller.abort() — and discovers, on disconnect, that it never
// runs unless the awaited promise settles first. These tests pin that
// behavior so a future change is a deliberate one.
describe("cleanup contract for inner async generators on cancel", () => {
	test("`return cleanupFn` does NOT run when the inner generator is cancelled mid-await", async () => {
		const tag = uniqueTag("cleanup-on-cancel");
		const cleanupSpy = vi.fn();
		let resolveAwait: (() => void) | null = null;

		customElements.define(
			tag,
			render(function* () {
				yield async function* () {
					yield () => html`<span>parked</span>`;
					await new Promise<void>((resolve) => {
						resolveAwait = resolve;
					});
					return cleanupSpy;
				};
			}),
		);

		const element = mount(tag);
		await sleep();
		expect(element.shadowRoot?.querySelector("span")?.textContent).toBe(
			"parked",
		);

		element.remove();
		await sleep();
		expect(cleanupSpy).not.toHaveBeenCalled();

		// Even once the await settles, the queued .return() short-circuits past
		// the explicit `return cleanupFn` line. Cleanup is never captured.
		resolveAwait?.();
		await sleep();
		expect(cleanupSpy).not.toHaveBeenCalled();
	});

	test("try/finally IS the supported path for cancellation cleanup of post-yield work", async () => {
		const tag = uniqueTag("finally-on-cancel");
		const cleanupSpy = vi.fn();
		let resolveAwait: (() => void) | null = null;

		customElements.define(
			tag,
			render(function* () {
				yield async function* () {
					yield () => html`<span>parked</span>`;
					try {
						await new Promise<void>((resolve) => {
							resolveAwait = resolve;
						});
					} finally {
						cleanupSpy();
					}
				};
			}),
		);

		const element = mount(tag);
		await sleep();

		element.remove();
		await sleep();
		// Same constraint as "inner generator finally fires after disconnect once
		// the pending await settles" above — finally requires the await to
		// settle for the queued return to drain through it.
		expect(cleanupSpy).not.toHaveBeenCalled();

		resolveAwait?.();
		await sleep();
		expect(cleanupSpy).toHaveBeenCalledTimes(1);
	});

	test("`return cleanupFn` from a sync inner generator that completes BEFORE disconnect runs on disconnect", async () => {
		// Counterpart to the cancel-mid-await case: when the inner generator
		// completes naturally, its cleanup IS captured, and disconnect fires it.
		// Confirms the surface is consistent: cleanup-via-return only works on
		// natural completion; cleanup-via-finally works on cancellation too.
		const tag = uniqueTag("cleanup-natural");
		const cleanupSpy = vi.fn();

		customElements.define(
			tag,
			render(function* () {
				yield function* () {
					yield () => html`<span>done</span>`;
					return cleanupSpy;
				};
			}),
		);

		const element = mount(tag);
		await sleep();
		expect(cleanupSpy).not.toHaveBeenCalled();

		element.remove();
		await sleep();
		expect(cleanupSpy).toHaveBeenCalledTimes(1);
	});
});
