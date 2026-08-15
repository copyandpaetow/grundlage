import { describe, expect, test, vi } from "vitest";
import { html, component } from "../../src/index";
import {
	BaseComponent,
	ComponentGenerator,
	ComponentProps,
} from "../../src/types";

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
			component(function* () {
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
			component(function* () {
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
			component(function* () {
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
			component(function* () {
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
			component(function* () {
				yield function* () {
					yield function* () {
						yield () => html`<p>too-deep</p>`;
					};
				};
			}),
		);

		const element = mount(tag);
		await sleep();

		expect(element.shadowRoot?.textContent).toContain("grundlage");
		warnSpy.mockRestore();
		element.remove();
	});
});

describe("update() with an active inner generator", () => {
	test("update() restarts the inner generator each time", async () => {
		const tag = uniqueTag("restart");
		const innerStarts: number[] = [];
		let counter = 0;

		const ComponentClass = component(function* () {
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

		const ComponentClass = component(function* () {
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
			component(function* () {
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
			component(function* () {
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
		//recovery path is silent — no console.warn
		expect(warnSpy).not.toHaveBeenCalled();
		warnSpy.mockRestore();
		element.remove();
	});

	test("outer catches and returns a cleanup: prior view persists, cleanup deferred to disconnect", async () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		const tag = uniqueTag("catch-return");
		const events: string[] = [];

		//outer commits a static view first, then installs an inner that
		//throws. Outer is parked at the inner-install yield when the error
		//propagates, so its catch fires and it returns a cleanup. Per the
		//error contract: the static view persists, the outer completes like any
		//returning generator, and its captured cleanup is deferred to disconnect
		customElements.define(
			tag,
			component(function* () {
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
		//cleanup is captured but not run while still mounted
		expect(events).toEqual([]);
		//recovery path is silent — no terminal warning
		expect(warnSpy).not.toHaveBeenCalled();

		element.remove();
		await sleep();
		//cleanup runs once, at disconnect
		expect(events).toEqual(["outer-cleanup-after-catch"]);

		warnSpy.mockRestore();
	});

	test("uncaught inner error becomes a terminal: warning + error text in shadow", async () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		const tag = uniqueTag("terminal");

		customElements.define(
			tag,
			component(function* () {
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

		const ComponentClass = component(function* () {
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
		//outer was nulled; no recovery on subsequent update
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
			component(function* () {
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
			component(function* () {
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
			component(function* () {
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
			component(function* () {
				//a resolved promise is unwrapped by the driver; the resolved
				//value flows back as the yield result without being treated as
				//a render target. Confirms host-replacement only fires on
				//renderable yields
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
			component(function* () {
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
			component(function* () {
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

	test("host received from yield exposes the BaseComponent surface (update / setProp)", async () => {
		const tag = uniqueTag("host-api");
		let counter = 0;

		const ComponentClass = component(async function* () {
			const host = (yield () => html`<span>${counter}</span>`) as BaseComponent;
			//re-rendering through the received host proves it really is the
			//element instance and not just structurally similar
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

describe("renderer and inner generator receive the props object", () => {
	test("outer renderer is invoked with the host element", async () => {
		const tag = uniqueTag("outer-renderer-arg");
		const received: unknown[] = [];

		customElements.define(
			tag,
			component(function* () {
				yield ({ host }: ComponentProps) => {
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

		const ComponentClass = component(function* () {
			yield ({ host }: ComponentProps) => {
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
			component(function* () {
				yield function* () {
					yield ({ host }: ComponentProps) => {
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
			component(function* () {
				yield function* ({ host }: ComponentProps) {
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
			component(function* () {
				yield async function* ({ host }: ComponentProps) {
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

		const ComponentClass = component(function* () {
			yield function* ({ host }: ComponentProps) {
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
		//inner generator is restarted on every update by design, so any state
		//held inside it does not survive an update. Isolation here is about
		//per-instance shadow roots, not retained inner state
		const tag = uniqueTag("isolated");
		const innerGen: ComponentGenerator = function* ({ host: element }) {
			yield () => html`<span>${element.getAttribute("label") ?? "?"}</span>`;
		};

		customElements.define(
			tag,
			component(
				function* () {
					yield innerGen;
				},
				{ props: { label: String } },
			),
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
	//async generators paused at an internal `await` cannot be force-unblocked
	//by .return() — the queued return only takes effect after the awaited
	//promise settles. Userland post-yield work that needs to react to a
	//disconnect must therefore use try/finally; the registered return-cleanup
	//only runs on a graceful completion
	test("inner generator finally fires after disconnect once the pending await settles", async () => {
		const tag = uniqueTag("post-yield-finally");
		const events: string[] = [];
		let resolveAwait: (() => void) | null = null;

		customElements.define(
			tag,
			component(function* () {
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
		//disconnect alone cannot unblock the pending await — finally has not
		//run yet. This documents the framework's contract: cancelGenerator() queues
		//a return on the async generator but does not abort in-flight awaits
		expect(events).toEqual([]);

		resolveAwait!();
		await sleep();
		//once the await settles, the queued return processes and finally fires.
		//the body line after the await is skipped (queued return short-circuits)
		expect(events).toEqual(["body-after-await", "inner-finally"]);
	});

	test("post-yield cleanup is captured and runs when generator completes before disconnect", async () => {
		const tag = uniqueTag("post-yield-complete");
		const events: string[] = [];

		customElements.define(
			tag,
			component(function* () {
				yield async function* () {
					yield () => html`<p>ready</p>`;
					await Promise.resolve();
					events.push("post-yield-ran");
					return () => events.push("cleanup");
				};
			}),
		);

		const element = mount(tag);
		//two macrotasks: one for outer install, one for the resolved
		//microtask + final return that captures cleanup
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

		const ComponentClass = component(function* () {
			yield async function* () {
				const id = ++attempt;
				yield () => html`<span>attempt-${id}</span>`;
				//only the first attempt blocks on a controlled slow promise; later restarts return after
				//the first yield, which keeps gen2's lifecycle short so the assertion targets the stale
				//path rather than gen2's own progression
				if (id === 1) {
					await new Promise<void>((resolve) => {
						resolveSlow = resolve;
					});
					//if this ever renders, the framework failed to suppress
					//stale resumption from the cancelled gen1
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

		resolveSlow!();
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

		const ComponentClass = component(function* () {
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
		//restart cancels the prior inner — its finally fires, then a fresh
		//inner is parked at its own try/finally
		expect(events).toEqual(["inner-finally", "inner-finally"]);

		element.remove();
	});

	test("async outer generator can host a nested inner generator", async () => {
		const tag = uniqueTag("async-outer-with-inner");

		customElements.define(
			tag,
			component(async function* () {
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

//any inner async generator with post-yield work hits this: update() supersedes it while it is
//parked at an await, and the stopped run's queued resumption must go nowhere. A superseded run
//checks whether it is still the live one before resuming, so its late async work can neither paint
//stale markup nor signal "done" for the live run. update() resolves only once the fresh run
//finishes, so these tests drive the timeline by hand rather than awaiting it across a still-parked
//run, which would correctly not resolve
describe("rapid restart with in-flight inner async work", () => {
	test("a superseded inner run's late await neither paints nor silences the live run", async () => {
		const tag = uniqueTag("restart-stale-resolution");
		let releaseOld!: () => void;
		let releaseLive!: () => void;
		let attempt = 0;

		const ComponentClass = component(function* () {
			yield async function* () {
				const id = ++attempt;
				if (id === 1) {
					yield () => html`<span>attempt-1</span>`;
					await new Promise<void>((resolve) => {
						releaseOld = resolve;
					});
					//cancelled before this lands
					yield () => html`<span>attempt-1-late</span>`;
				} else {
					//the live run does its own async work between its two yields — the window in
					//which the superseded run's late resolution could wrongly silence it
					yield () => html`<span>attempt-2-first</span>`;
					await new Promise<void>((resolve) => {
						releaseLive = resolve;
					});
					yield () => html`<span>attempt-2-second</span>`;
				}
			};
		});
		customElements.define(tag, ComponentClass);

		const element = mount(tag) as InstanceType<typeof ComponentClass>;
		await sleep();
		expect(element.shadowRoot?.querySelector("span")?.textContent).toBe(
			"attempt-1",
		);

		//supersede gen1 (now stopped, parked at its await) with gen2. update() resolves on the
		//fresh run's completion, so hold the promise — gen2 is still mid-flight at its own await
		const flush = element.update();
		await sleep();
		expect(element.shadowRoot?.querySelector("span")?.textContent).toBe(
			"attempt-2-first",
		);

		//gen1's late await fires while gen2 is parked between its yields. it must not paint
		//"attempt-1-late", and must not stop gen2 from landing its second yield
		releaseOld();
		await sleep();
		expect(element.shadowRoot?.querySelector("span")?.textContent).toBe(
			"attempt-2-first",
		);

		//gen2 runs on to its end; the flush resolves there (completion contract)
		releaseLive();
		await flush;
		expect(element.shadowRoot?.querySelector("span")?.textContent).toBe(
			"attempt-2-second",
		);

		element.remove();
	});

	test("a superseded run's late await stays contained across a coalesced reflush", async () => {
		//the serialization makes the old "two stacked live restarts" shape unreachable: a
		//mid-flight update() coalesces into one reflush (with a fresh pull), it does not spawn a
		//second concurrent run. So the superseded mount run stays parked across the whole batch
		//(initial render -> reflush). When its late await finally fires it must paint nothing and
		//disturb neither the reflush nor its freshly pulled state
		const tag = uniqueTag("restart-stacked");
		let releaseOld!: () => void;
		let phase = "first";
		let attempt = 0;

		const ComponentClass = component(function* () {
			yield async function* () {
				const id = ++attempt;
				if (id === 1) {
					yield () => html`<span>mount</span>`;
					await new Promise<void>((resolve) => {
						releaseOld = resolve;
					});
					//cancelled before this lands
					yield () => html`<span>mount-late</span>`;
				} else {
					//later runs read fresh state and complete promptly
					const snapshot = phase;
					await sleep(10);
					yield () => html`<span>${snapshot}</span>`;
				}
			};
		});
		customElements.define(tag, ComponentClass);

		const element = mount(tag) as InstanceType<typeof ComponentClass>;
		await sleep();
		expect(element.shadowRoot?.querySelector("span")?.textContent).toBe(
			"mount",
		);

		//open a batch that supersedes the parked mount run, then a mid-flight update that
		//coalesces into exactly one reflush carrying the latest state
		phase = "second";
		const flush = element.update();
		await sleep(); // gen2 ("second") is mid-flight at its await
		phase = "third";
		element.update(); // RENDERING -> sets dirty, reflushes once after gen2 completes

		//the superseded mount run's late await fires while the batch is still in flight
		releaseOld();

		await flush; // resolves after the reflushed run ("third") lands
		expect(element.shadowRoot?.querySelector("span")?.textContent).toBe(
			"third",
		);
		expect(element.shadowRoot?.textContent).not.toContain("mount-late");

		element.remove();
	});
});

//a cleanup that calls controller.abort() never runs unless the awaited promise settles first, so a
//component relying on it to release resources on disconnect does not. Pinned so a change here is a
//deliberate one
describe("cleanup contract for inner async generators on cancel", () => {
	test("`return cleanupFn` does not run when the inner generator is cancelled mid-await", async () => {
		const tag = uniqueTag("cleanup-on-cancel");
		const cleanupSpy = vi.fn();
		let resolveAwait: (() => void) | null = null;

		customElements.define(
			tag,
			component(function* () {
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

		//even once the await settles, the queued .return() short-circuits past
		//the explicit `return cleanupFn` line. Cleanup is never captured
		resolveAwait!();
		await sleep();
		expect(cleanupSpy).not.toHaveBeenCalled();
	});

	test("try/finally is the supported path for cancellation cleanup of post-yield work", async () => {
		const tag = uniqueTag("finally-on-cancel");
		const cleanupSpy = vi.fn();
		let resolveAwait: (() => void) | null = null;

		customElements.define(
			tag,
			component(function* () {
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
		//same constraint as "inner generator finally fires after disconnect once
		//the pending await settles" above — finally requires the await to
		//settle for the queued return to drain through it
		expect(cleanupSpy).not.toHaveBeenCalled();

		resolveAwait!();
		await sleep();
		expect(cleanupSpy).toHaveBeenCalledTimes(1);
	});

	test("`return cleanupFn` from a sync inner generator that completes before disconnect runs on disconnect", async () => {
		//counterpart to the cancel-mid-await case: when the inner generator
		//completes naturally, its cleanup is captured, and disconnect fires it.
		//confirms the surface is consistent: cleanup-via-return only works on
		//natural completion; cleanup-via-finally works on cancellation too
		const tag = uniqueTag("cleanup-natural");
		const cleanupSpy = vi.fn();

		customElements.define(
			tag,
			component(function* () {
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

describe("the outer painting over a live inner generator abandons it", () => {
	test("the abandoned inner's pending await cannot paint over the outer's content", async () => {
		const tag = uniqueTag("abandoned-late-paint");
		let releaseGate: ((value: string) => void) | null = null;
		const gate = new Promise<string>((resolve) => {
			releaseGate = resolve;
		});

		customElements.define(
			tag,
			component(function* () {
				yield async function* () {
					yield () => html`<p>inner</p>`;
					const late = await gate;
					yield () => html`<p>${late}</p>`;
				};
				yield html`<p>outer took over</p>`;
			}),
		);

		const element = mount(tag);
		await sleep();
		expect(element.shadowRoot?.querySelector("p")?.textContent).toBe(
			"outer took over",
		);

		releaseGate!("late");
		await sleep(20);
		//the inner is no longer the live inner, so its resolved await is dropped rather than
		//painting into a shadow root the outer owns
		expect(element.shadowRoot?.querySelector("p")?.textContent).toBe(
			"outer took over",
		);
		element.remove();
	});

	test("the abandoned inner's pending render promise cannot paint over the outer's content", async () => {
		const tag = uniqueTag("abandoned-late-render");
		let releaseGate: ((value: string) => void) | null = null;
		const gate = new Promise<string>((resolve) => {
			releaseGate = resolve;
		});

		customElements.define(
			tag,
			component(function* () {
				yield function* () {
					yield async () => html`<p>${await gate}</p>`;
				};
				yield html`<p>outer took over</p>`;
			}),
		);

		const element = mount(tag);
		await sleep();
		expect(element.shadowRoot?.querySelector("p")?.textContent).toBe(
			"outer took over",
		);

		releaseGate!("late");
		await sleep(20);
		//the abandoned inner's render call is abandoned with it, on the other lane
		expect(element.shadowRoot?.querySelector("p")?.textContent).toBe(
			"outer took over",
		);
		element.remove();
	});

	test("the abandoned inner's captured cleanup runs at the outer's paint, not at disconnect", async () => {
		const tag = uniqueTag("abandoned-cleanup");
		const cleanupSpy = vi.fn();

		customElements.define(
			tag,
			component(function* () {
				yield function* () {
					yield () => html`<p>inner</p>`;
					return cleanupSpy;
				};
				yield html`<p>outer took over</p>`;
			}),
		);

		const element = mount(tag);
		await sleep();
		expect(element.shadowRoot?.querySelector("p")?.textContent).toBe(
			"outer took over",
		);
		//a ResizeObserver in the abandoned body would otherwise stay connected until disconnect
		expect(cleanupSpy).toHaveBeenCalledTimes(1);

		element.remove();
		await sleep();
		expect(cleanupSpy).toHaveBeenCalledTimes(1);
	});

	test("update() does not reinstall the generator the outer painted over", async () => {
		const tag = uniqueTag("abandoned-refire");
		let setups = 0;

		customElements.define(
			tag,
			component(function* () {
				yield function* () {
					setups++;
					yield () => html`<p>inner</p>`;
				};
				yield html`<p>outer took over</p>`;
			}),
		);

		const element = mount(tag) as HTMLElement & { update(): Promise<void> };
		await sleep();
		expect(setups).toBe(1);

		//the outer's last yield was a template, so there is nothing to re-run: reinstalling the
		//abandoned generator would clobber the outer's content on every update()
		await element.update();
		expect(setups).toBe(1);
		expect(element.shadowRoot?.querySelector("p")?.textContent).toBe(
			"outer took over",
		);
		element.remove();
	});
});

describe("an outer that recovers from a failed inner is handed back exactly once", () => {
	test("recovering into an async render does not let the install step it a second time", async () => {
		const tag = uniqueTag("recover-async");
		let stepsPastTheCatch = 0;

		customElements.define(
			tag,
			component(function* () {
				try {
					yield function* () {
						yield () => {
							throw new Error("inner-failed");
						};
					};
				} catch {
					//an async render leaves the outer parked at this yield, so the install frame the
					//failed inner unwound out of would step it again if it did not notice the handoff
					yield async () => {
						await sleep(5);
						return html`<p>recovered</p>`;
					};
				}
				stepsPastTheCatch++;
				yield html`<p>after</p>`;
			}),
		);

		const element = mount(tag);
		await sleep(40);
		expect(element.shadowRoot?.querySelector("p")?.textContent).toBe("after");
		expect(stepsPastTheCatch).toBe(1);
		element.remove();
	});
});

describe("an update() that installs a branch while the body awaits a promise", () => {
	test("the pending yield still resumes with the settled value", async () => {
		const tag = uniqueTag("install-while-awaiting");
		let showBranch = false;
		let resumedWith: unknown = null;

		customElements.define(
			tag,
			component(function* () {
				yield () =>
					showBranch
						? function* () {
								yield () => html`<p>branch</p>`;
							}
						: html`<p>read only</p>`;
				resumedWith = yield sleep(5).then(() => "settled");
				yield html`<p>done</p>`;
			}),
		);

		const element = mount(tag);
		await sleep();
		expect(element.shadowRoot?.querySelector("p")?.textContent).toBe(
			"read only",
		);

		//the body is parked at the promise, not at a renderable, so installing the branch the
		//refired render function returned has nowhere to resume it to
		showBranch = true;
		await (element as BaseComponent).update();
		expect(element.shadowRoot?.querySelector("p")?.textContent).toBe("branch");

		await sleep(40);
		expect(resumedWith).toBe("settled");
		element.remove();
	});
});
