import { afterEach, describe, expect, test, vi } from "vitest";
import { html, component, ComponentErrorEvent } from "../../index";

//engine-level invariants that are narrower than the integration oracles but are not pure-step
//properties: the terminal logs exactly once along the linear recover-then-fail path, and a
//torn-down generation neither paints nor resolves a late update() past disconnect. Driven through
//the public component() surface.

let counter = 0;
const uniqueTag = () => `test-engine-${counter++}-${Date.now()}`;
const sleep = (duration = 0) =>
	new Promise((resolve) => setTimeout(resolve, duration));

const mount = (constructor: CustomElementConstructor): HTMLElement => {
	const tag = uniqueTag();
	customElements.define(tag, constructor);
	const element = document.createElement(tag);
	document.body.appendChild(element);
	return element;
};

afterEach(() => {
	vi.restoreAllMocks();
});

describe("engine terminal", () => {
	test("an uncaught error logs exactly one console error", async () => {
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => {});
		const element = mount(
			component(function* () {
				yield function* () {
					{
						throw new Error("once");
					}
				};
			}),
		);
		await sleep();

		expect(element.shadowRoot?.textContent).toContain("once");
		expect(consoleError).toHaveBeenCalledTimes(1);
		element.remove();
	});

	test("a fatal error displays in closed shadow mode (host.shadowRoot is null)", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		const attachShadow = HTMLElement.prototype.attachShadow;
		let closedRoot: ShadowRoot | undefined;
		vi.spyOn(HTMLElement.prototype, "attachShadow").mockImplementation(
			function (this: HTMLElement, init: ShadowRootInit) {
				closedRoot = attachShadow.call(this, init);
				return closedRoot;
			},
		);

		const element = mount(
			component(
				function* () {
					yield function* () {
						throw new Error("closed-boom");
					};
				},
				{ mode: "closed" },
			),
		);
		await sleep();

		expect(element.shadowRoot).toBeNull(); //closed: the host exposes no root
		//...yet the engine still displayed the error into the closed root it holds privately
		expect(closedRoot?.textContent).toContain("closed-boom");
		element.remove();
	});

	test("update() after a terminal error is a no-op (the runner was stopped)", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		let shouldThrow = true;
		const element = mount(
			component(function* () {
				yield function* () {
					if (shouldThrow) throw new Error("boom");
					yield html`<p>recovered</p>`;
				};
			}),
		) as HTMLElement & { update(): Promise<void> };
		await sleep();
		expect(element.shadowRoot?.textContent).toContain("boom");

		shouldThrow = false;
		await element.update(); //must resolve (not hang) and must NOT run again
		expect(element.shadowRoot?.textContent).toContain("boom");
		element.remove();
	});

	test("reconnect after a fatal error remounts instead of patching the detached error text", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		let boom = false;
		const element = mount(
			component(function* () {
				yield function* () {
					if (boom) throw new Error("late-boom");
					yield html`<p>alive</p>`;
				};
			}),
		) as HTMLElement & { update(): Promise<void> };
		await sleep();
		expect(element.shadowRoot?.textContent).toContain("alive");

		boom = true;
		await element.update(); //fatal: the shadow shows the error, the stale instance is dropped
		expect(element.shadowRoot?.textContent).toContain("late-boom");

		boom = false;
		element.remove();
		document.body.appendChild(element); //reconnect restarts the engine on the same element
		await sleep();
		//same-hash paint must not patch the detached error text; it must remount live DOM
		expect(element.shadowRoot?.textContent).toContain("alive");
		expect(element.shadowRoot?.textContent).not.toContain("late-boom");
		element.remove();
	});

	test("an outer parked on a yielded promise cannot catch its inner's failure", async () => {
		//the yield a throw would land at is owned by the pending promise: catching there would let
		//that promise step the generator a second time, from a position it had already left
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => {});
		let rejectInnerPromise: (error: Error) => void = () => {};
		const innerPromise = new Promise((_resolve, reject) => {
			rejectInnerPromise = reject;
		});
		let resolveGate: (value: string) => void = () => {};
		const gate = new Promise<string>((resolve) => {
			resolveGate = resolve;
		});
		let caughtAtTheGate = 0;
		let resumedPastTheGate = 0;

		const element = mount(
			component(function* () {
				yield function* () {
					yield innerPromise;
				};
				try {
					yield gate;
					resumedPastTheGate++;
				} catch {
					caughtAtTheGate++;
				}
			}),
		);
		await sleep();

		rejectInnerPromise(new Error("inner-promise-rejected"));
		await sleep();

		expect(caughtAtTheGate).toBe(0);
		expect(element.shadowRoot?.textContent).toContain("inner-promise-rejected");
		expect(consoleError).toHaveBeenCalledTimes(1);

		resolveGate("late");
		await sleep();
		expect(resumedPastTheGate).toBe(0); //nor does the gate resume the torn-down outer
		element.remove();
	});
});

describe("the component error event", () => {
	test("reaches the document naming the failing tag, with the thrown error", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		const thrown = new Error("reported");
		const received: Array<ComponentErrorEvent> = [];
		const recordEvent = (event: ComponentErrorEvent) => received.push(event);
		document.addEventListener(ComponentErrorEvent.eventName, recordEvent);
		const element = mount(
			component(function* () {
				yield function* () {
					throw thrown;
				};
			}),
		);
		await sleep();
		document.removeEventListener(ComponentErrorEvent.eventName, recordEvent);

		expect(received).toHaveLength(1);
		expect(received[0].error).toBe(thrown);
		expect(received[0].tagName).toBe(element.localName);
		element.remove();
	});

	test("the listener sees an already emptied shadow root", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		let shouldThrow = false;
		const element = mount(
			component(function* () {
				yield function* () {
					if (shouldThrow) throw new Error("late");
					yield html`<p>alive</p>`;
				};
			}),
		) as HTMLElement & { update(): Promise<void> };
		await sleep();
		let childCountDuringTheListener = -1;
		element.addEventListener(ComponentErrorEvent.eventName, () => {
			childCountDuringTheListener = element.shadowRoot?.childNodes.length ?? -1;
		});

		shouldThrow = true;
		await element.update();

		expect(childCountDuringTheListener).toBe(0);
		element.remove();
	});

	test("preventDefault skips the console error and the error text", async () => {
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => {});
		const tag = uniqueTag();
		customElements.define(
			tag,
			component(function* () {
				yield function* () {
					throw new Error("handled");
				};
			}),
		);
		const element = document.createElement(tag);
		element.addEventListener(ComponentErrorEvent.eventName, (event) =>
			event.preventDefault(),
		);
		document.body.appendChild(element);
		await sleep();

		expect(consoleError).not.toHaveBeenCalled();
		expect(element.shadowRoot?.childNodes.length).toBe(0);
		element.remove();
	});
});

describe("a prop resolver that throws", () => {
	const refusingResolver = (value: unknown) => {
		if (value === "refused") throw new Error("refused");
		return value;
	};
	const mountWithRefusingProp = () =>
		mount(
			component(
				function* () {
					yield function* () {
						yield html`<p>alive</p>`;
					};
				},
				{ props: { label: refusingResolver } },
			),
		) as HTMLElement & { label: unknown };
	//a child writing back into the component that paints it: user code in the middle of that paint
	customElements.define(
		"refusing-child",
		class extends HTMLElement {
			set owner(owner: { label: unknown }) {
				owner.label = "refused";
			}
		},
	);

	test("from an attribute, ends the component through the error event", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		const element = mountWithRefusingProp();
		await sleep();
		const received: Array<unknown> = [];
		element.addEventListener(ComponentErrorEvent.eventName, (event) =>
			received.push(event.error),
		);

		expect(() => element.setAttribute("label", "refused")).not.toThrow();
		expect(received).toHaveLength(1);
		expect(element.shadowRoot?.textContent).toContain("refused");
		element.remove();
	});

	test("from a property, ends the component instead of throwing at the assignment", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		const element = mountWithRefusingProp();
		await sleep();
		const received: Array<unknown> = [];
		element.addEventListener(ComponentErrorEvent.eventName, (event) =>
			received.push(event.error),
		);

		expect(() => (element.label = "refused")).not.toThrow();
		expect(received).toHaveLength(1);
		element.remove();
	});

	test("from the body's own write, the body stops instead of painting over the error", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		const element = mount(
			component(
				function* ({ host }) {
					host.label = "refused";
					yield html`<p>painted after the error</p>`;
				},
				{ props: { label: refusingResolver } },
			),
		);
		await sleep();

		expect(element.shadowRoot?.textContent).toContain("refused");
		expect(element.shadowRoot?.textContent).not.toContain("painted after");
		element.remove();
	});

	test("from the body's own write, the body's finally block runs once its step is over", async () => {
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => {});
		let hasFinallyRun = false;
		const element = mount(
			component(
				function* ({ host }) {
					try {
						host.label = "refused";
						yield html`<p>painted after the error</p>`;
					} finally {
						hasFinallyRun = true;
					}
				},
				{ props: { label: refusingResolver } },
			),
		);
		await sleep();

		expect(hasFinallyRun).toBe(true);
		//the error display's own line, and no report of a generator returned while it ran
		expect(consoleError).toHaveBeenCalledOnce();
		element.remove();
	});

	test("from an update generator's own write, the cleanup it returns in the same step runs", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		const cleanup = vi.fn();
		const element = mount(
			component(
				function* ({ host }) {
					yield function* () {
						host.label = "refused";
						return cleanup;
					};
				},
				{ props: { label: refusingResolver } },
			),
		);
		await sleep();

		expect(cleanup).toHaveBeenCalledOnce();
		element.remove();
	});

	test("from the body's own write, a throw later in the step does not end the component a second time", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		const tag = uniqueTag();
		customElements.define(
			tag,
			component(
				function* ({ host }) {
					host.label = "refused";
					throw new Error("thrown after the error");
				},
				{ props: { label: refusingResolver } },
			),
		);
		const element = document.createElement(tag);
		const received: Array<unknown> = [];
		element.addEventListener(ComponentErrorEvent.eventName, (event) =>
			received.push(event.error),
		);
		document.body.appendChild(element);
		await sleep();

		expect(received).toHaveLength(1);
		expect(element.shadowRoot?.textContent).toContain("refused");
		element.remove();
	});

	test("from an update generator's own write, the promise it yields next does not resume it", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		let isResumed = false;
		const element = mount(
			component(
				function* ({ host }) {
					yield function* () {
						host.label = "refused";
						yield Promise.resolve();
						isResumed = true;
						yield html`<p>painted after the error</p>`;
					};
				},
				{ props: { label: refusingResolver } },
			),
		);
		await sleep();

		expect(element.shadowRoot?.textContent).toContain("refused");
		expect(isResumed).toBe(false);
		element.remove();
	});

	test("from the paint's own host binding, a finally block that waits is left to the teardown", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		let hasFinallyGoneOn = false;
		const element = mount(
			component(
				function* () {
					yield function* () {
						try {
							yield html`<template label=${"refused"}><p>alive</p></template>`;
						} finally {
							yield Promise.resolve();
							hasFinallyGoneOn = true;
						}
					};
				},
				{ props: { label: refusingResolver } },
			),
		);
		const hasFinallyGoneOnDuringMount = hasFinallyGoneOn;
		await sleep();

		expect(hasFinallyGoneOnDuringMount).toBe(false);
		expect(hasFinallyGoneOn).toBe(true);
		element.remove();
	});

	test("from the paint's own host binding, the rest of that paint does not cover the error", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		const element = mount(
			component(
				function* () {
					yield function* () {
						yield html`<template label=${"refused"}
							><p>painted after the error</p></template
						>`;
					};
				},
				{ props: { label: refusingResolver } },
			),
		);
		await sleep();

		expect(element.shadowRoot?.textContent).toContain("refused");
		expect(element.shadowRoot?.textContent).not.toContain("painted after");
		element.remove();
	});

	test("from the host binding an update paints, a re-insertion paints again", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		let label = "accepted";
		const element = mount(
			component(
				function* () {
					yield function* () {
						yield html`<template label=${label}
							><p>painted ${label}</p></template
						>`;
					};
				},
				{ props: { label: refusingResolver } },
			),
		) as HTMLElement & { update(): Promise<void> };
		await sleep();
		label = "refused";
		await element.update();
		label = "accepted again";
		element.remove();
		document.body.appendChild(element);
		await sleep();

		expect(element.shadowRoot?.textContent).toContain("painted accepted again");
		element.remove();
	});

	test("from the host binding a hydrating paint commits, a re-insertion paints again", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		let label = "refused";
		const tag = uniqueTag();
		//created before the definition, so the upgrade finds a root to hydrate
		const element = document.createElement(tag);
		element.attachShadow({ mode: "open" }).innerHTML =
			"<p>painted on the server</p>";
		document.body.appendChild(element);
		customElements.define(
			tag,
			component(
				function* () {
					yield function* () {
						yield html`<template label=${label}
							><p>painted in the browser</p></template
						>`;
					};
				},
				{ props: { label: refusingResolver } },
			),
		);
		await sleep();
		const textAfterError = element.shadowRoot?.textContent;
		label = "accepted";
		element.remove();
		document.body.appendChild(element);
		await sleep();

		expect(textAfterError).toContain("refused");
		expect(element.shadowRoot?.textContent).toContain("painted in the browser");
		element.remove();
	});

	test("from the cleanup the body's template runs, the template is not painted", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		let isPainted = false;
		//a paint reads the iterator in a hole, so reading it marks the paint
		function* paintedRows() {
			isPainted = true;
			yield "painted after the error";
		}
		const element = mount(
			component(
				function* ({ host }) {
					yield function* () {
						yield html`<p>alive</p>`;
						return () => {
							host.label = "refused";
						};
					};
					yield html`<p>${paintedRows()}</p>`;
				},
				{ props: { label: refusingResolver } },
			),
		);
		await sleep();

		expect(element.shadowRoot?.textContent).toContain("refused");
		expect(isPainted).toBe(false);
		element.remove();
	});

	test("from the cleanup an update runs, the update does not call the update generator again", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		let isRefusing = false;
		let callCount = 0;
		const element = mount(
			component(
				function* ({ host }) {
					//counted by a parameter default, which runs at the call, before any step
					yield function* (_props: unknown, _call = callCount++) {
						yield html`<p>alive</p>`;
						return () => {
							if (isRefusing) host.label = "refused";
						};
					};
				},
				{ props: { label: refusingResolver } },
			),
		) as HTMLElement & { update(): Promise<void> };
		await sleep();
		isRefusing = true;
		await element.update();

		expect(element.shadowRoot?.textContent).toContain("refused");
		expect(callCount).toBe(1);
		element.remove();
	});

	test("from an update generator's parameter default, that update generator does not run", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		let hasRun = false;
		const element = mount(
			component(
				function* ({ host }) {
					yield function* (
						_props: unknown,
						_refusal = (host.label = "refused"),
					) {
						hasRun = true;
						yield html`<p>painted after the error</p>`;
					};
				},
				{ props: { label: refusingResolver } },
			),
		);
		await sleep();

		expect(element.shadowRoot?.textContent).toContain("refused");
		expect(hasRun).toBe(false);
		element.remove();
	});

	test("from an update generator's parameter default that then throws, the throw is reported instead of ending the component again", async () => {
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => {});
		const failure = new Error("thrown after the refusal");
		let isCaughtByBody = false;
		const tag = uniqueTag();
		customElements.define(
			tag,
			component(
				function* ({ host }) {
					try {
						yield function* (
							_props: unknown,
							_refusal = (host.label = "refused"),
							_failure = (() => {
								throw failure;
							})(),
						) {
							yield html`<p>painted after the error</p>`;
						};
					} catch {
						isCaughtByBody = true;
					}
				},
				{ props: { label: refusingResolver } },
			),
		);
		const element = document.createElement(tag);
		const received: Array<unknown> = [];
		element.addEventListener(ComponentErrorEvent.eventName, (event) =>
			received.push(event.error),
		);
		document.body.appendChild(element);
		await sleep();

		expect(received).toHaveLength(1);
		expect(element.shadowRoot?.textContent).toContain("refused");
		expect(isCaughtByBody).toBe(false);
		expect(consoleError).toHaveBeenCalledWith(failure);
		element.remove();
	});

	test("from a child's setter in the paint, a hole that throws later in that paint is reported instead of thrown at the yield", async () => {
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => {});
		const failure = new Error("thrown later in the paint");
		//a paint reads the iterator in a hole, so its throw is the paint's
		function* failingRows() {
			throw failure;
		}
		let isCaughtByBody = false;
		const tag = uniqueTag();
		customElements.define(
			tag,
			component(
				function* ({ host }) {
					try {
						yield html`<refusing-child owner=${host}></refusing-child>
							<p>${failingRows()}</p>`;
					} catch {
						isCaughtByBody = true;
					}
				},
				{ props: { label: refusingResolver } },
			),
		);
		const element = document.createElement(tag);
		const received: Array<unknown> = [];
		element.addEventListener(ComponentErrorEvent.eventName, (event) =>
			received.push(event.error),
		);
		document.body.appendChild(element);
		await sleep();

		expect(received).toHaveLength(1);
		expect(element.shadowRoot?.textContent).toContain("refused");
		expect(isCaughtByBody).toBe(false);
		expect(consoleError).toHaveBeenCalledWith(failure);
		element.remove();
	});

	test("from an update generator's own write, the body does not go on past its yield", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		let hasBodyGoneOn = false;
		const element = mount(
			component(
				function* ({ host }) {
					yield function* () {
						host.label = "refused";
					};
					hasBodyGoneOn = true;
				},
				{ props: { label: refusingResolver } },
			),
		);
		await sleep();

		expect(element.shadowRoot?.textContent).toContain("refused");
		expect(hasBodyGoneOn).toBe(false);
		element.remove();
	});

	test("from an update generator's own write, its finally block runs before the body's", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		const finallyOrder: Array<string> = [];
		const element = mount(
			component(
				function* ({ host }) {
					try {
						yield function* () {
							try {
								host.label = "refused";
								yield html`<p>painted after the error</p>`;
							} finally {
								finallyOrder.push("update generator");
							}
						};
					} finally {
						finallyOrder.push("body");
					}
				},
				{ props: { label: refusingResolver } },
			),
		);
		await sleep();

		expect(finallyOrder).toEqual(["update generator", "body"]);
		element.remove();
	});

	test("from the body's parameter default, the body does not run", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		const element = mount(
			component(
				function* ({ host }, _refusal = (host.label = "refused")) {
					yield html`<p>painted after the error</p>`;
				},
				{ props: { label: refusingResolver } },
			),
		);
		await sleep();

		expect(element.shadowRoot?.textContent).toContain("refused");
		expect(element.shadowRoot?.textContent).not.toContain("painted after");
		element.remove();
	});

	test("from the finally block of a failing update generator, the body does not go on to catch the failure, which is reported", async () => {
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => {});
		let isCaughtByBody = false;
		let hasFinallyGoneOn = false;
		const element = mount(
			component(
				function* ({ host }) {
					try {
						yield function* () {
							try {
								yield function* () {};
							} finally {
								host.label = "refused";
							}
						};
					} catch {
						isCaughtByBody = true;
					} finally {
						yield Promise.resolve();
						hasFinallyGoneOn = true;
					}
				},
				{ props: { label: refusingResolver } },
			),
		);
		await sleep();

		expect(element.shadowRoot?.textContent).toContain("refused");
		expect(isCaughtByBody).toBe(false);
		expect(consoleError).toHaveBeenCalledWith(
			expect.objectContaining({
				message: expect.stringContaining("One level of nesting only"),
			}),
		);
		expect(hasFinallyGoneOn).toBe(true);
		element.remove();
	});
});

describe("dismissed child errors", () => {
	test("outer catching a child error by returning: never fatal, cleanup deferred to disconnect, update() a no-op", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		let cleanupCalls = 0;
		const element = mount(
			component(function* () {
				try {
					yield function* () {
						{
							throw new Error("child-boom");
						}
					};
				} catch {
					return () => {
						cleanupCalls++;
					};
				}
			}),
		) as HTMLElement & { update(): Promise<void> };
		await sleep();

		//the outer swallowed the error: never a fatal, and cleanup is not run yet
		expect(warn).not.toHaveBeenCalled();
		expect(cleanupCalls).toBe(0);

		//the failed update generator was dropped: update() no-ops (does not re-run/re-throw)
		await element.update();
		expect(warn).not.toHaveBeenCalled();
		expect(cleanupCalls).toBe(0);

		//cleanup runs exactly once, at disconnect
		element.remove();
		await sleep();
		expect(cleanupCalls).toBe(1);
	});
});

describe("the refire enters the driver loop", () => {
	test("the outer generator is not stepped again on update", async () => {
		//a refire re-runs the update generator only; the body ran to completion at mount and
		//stepping it again would allocate an iterator result per update on the hot path
		let timesResumedPastTheYield = 0;
		let runs = 0;
		const element = mount(
			component(function* () {
				yield function* () {
					yield html`<p>${++runs}</p>`;
				};
				timesResumedPastTheYield++;
			}),
		) as HTMLElement & { update(): Promise<void> };
		await sleep();
		expect(timesResumedPastTheYield).toBe(1);

		await element.update();
		await element.update();
		await element.update();

		expect(runs).toBe(4);
		expect(timesResumedPastTheYield).toBe(1);
		expect(element.shadowRoot?.textContent).toContain("4");
		element.remove();
	});

	test("the cleanup captured at mount survives every update", async () => {
		let cleanupCalls = 0;
		const element = mount(
			component(function* () {
				yield function* () {
					yield html`<p>x</p>`;
				};
				return () => {
					cleanupCalls++;
				};
			}),
		) as HTMLElement & { update(): Promise<void> };
		await sleep();

		await element.update();
		await element.update();
		expect(cleanupCalls).toBe(0);

		element.remove();
		await sleep();
		expect(cleanupCalls).toBe(1);
	});

	//the two ways a throwing cleanup was observable before it was guarded: the paint it precedes
	//never happened, and the sibling cleanup queued behind it never ran
	test("a branch cleanup that throws does not eat the paint that tore it down", async () => {
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => {});
		const element = mount(
			component(function* () {
				yield function* () {
					yield html`<p>branch</p>`;
					return () => {
						throw new Error("branch-cleanup-threw");
					};
				};
				yield function* () {
					yield html`<p>component</p>`;
				};
			}),
		);
		await sleep();

		expect(element.shadowRoot?.textContent).toContain("component");
		expect(consoleError).toHaveBeenCalledOnce();
		element.remove();
	});

	test("a branch cleanup that throws does not skip the component's own cleanup", async () => {
		vi.spyOn(console, "warn").mockImplementation(() => {});
		let cleanupCalls = 0;
		const element = mount(
			component(function* () {
				yield function* () {
					yield html`<p>branch</p>`;
					return () => {
						throw new Error("branch-cleanup-threw");
					};
				};
				return () => {
					cleanupCalls++;
				};
			}),
		);
		await sleep();

		element.remove();
		await sleep();
		expect(cleanupCalls).toBe(1);
	});

	test("a re-installed branch does not step the completed outer past its cleanup", async () => {
		//an install steps the outer to hand its yield the host, but a refire installs from a
		//position the outer has already left — stepping a returned generator there would replace
		//the cleanup it captured with the undefined of a second return
		let cleanupCalls = 0;
		let branchRuns = 0;
		const branch = function* () {
			branchRuns++;
			yield html`<p>branch ${branchRuns}</p>`;
		};
		const element = mount(
			component(function* () {
				yield branch;
				return () => {
					cleanupCalls++;
				};
			}),
		) as HTMLElement & { update(): Promise<void> };
		await sleep();
		expect(branchRuns).toBe(1);

		await element.update();
		expect(branchRuns).toBe(2); //the same branch is still torn down and re-run
		expect(cleanupCalls).toBe(0);

		element.remove();
		await sleep();
		expect(cleanupCalls).toBe(1);
	});

	test("update() while the outer is suspended on a yielded promise does not disturb it", async () => {
		let resolveGate: (value: string) => void = () => {};
		const gate = new Promise<string>((resolve) => {
			resolveGate = resolve;
		});
		const element = mount(
			component(function* () {
				const label = yield gate;
				yield function* () {
					yield html`<p>${label}</p>`;
				};
			}),
		) as HTMLElement & { update(): Promise<void> };
		await sleep();
		expect(element.shadowRoot?.textContent).toBe("");

		//nothing is refirable yet: the body has not yielded an update generator
		await element.update(); //must resolve rather than hang, and must not step the outer
		expect(element.shadowRoot?.textContent).toBe("");

		resolveGate("late");
		await sleep();
		expect(element.shadowRoot?.textContent).toContain("late");
		element.remove();
	});

	test("a refire past a suspended outer paints without stepping it", async () => {
		//the other suspended shape: a record is set, so update() refires and the paint lands on a
		//SUSPENDED outer — which must be left parked for its own promise to resume
		let resolveGate: (value: string) => void = () => {};
		const gate = new Promise<string>((resolve) => {
			resolveGate = resolve;
		});
		let runs = 0;
		let resumed = 0;
		const element = mount(
			component(function* () {
				yield function* () {
					yield html`<p>run ${++runs}</p>`;
				};
				yield gate;
				resumed++;
			}),
		) as HTMLElement & { update(): Promise<void> };
		await sleep();
		expect(runs).toBe(1);
		expect(resumed).toBe(0);

		await element.update();
		expect(runs).toBe(2);
		expect(element.shadowRoot?.textContent).toContain("run 2");
		expect(resumed).toBe(0); //the refire must not resume the parked generator

		resolveGate("go");
		await sleep();
		expect(resumed).toBe(1); //the gate's own resolution still does
		element.remove();
	});

	test("an update queued before the body paints its own template still settles", async () => {
		//the template drops the update generator the update was queued for, and the queued update
		//goes with it
		let updateSettled = false;
		let runs = 0;
		const element = mount(
			component(function* ({ host }) {
				yield function* () {
					yield html`<p>run ${++runs}</p>`;
				};
				void host.update().then(() => {
					updateSettled = true;
				});
				yield html`<p>final</p>`;
			}),
		);
		await sleep();

		expect(runs).toBe(1); //a plain yielded template leaves nothing the update could re-fire
		expect(element.shadowRoot?.textContent).toContain("final");
		expect(updateSettled).toBe(true);
		element.remove();
	});

	test("an update generator yielded after another one is what the refire re-runs", async () => {
		//the two refire routes have separate fields now; the last yield decides which one answers
		let innerRuns = 0;
		let outerRuns = 0;
		const element = mount(
			component(function* () {
				yield function* () {
					innerRuns++;
					yield html`<p>inner</p>`;
				};
				yield function* () {
					yield html`<p>outer ${++outerRuns}</p>`;
				};
			}),
		) as HTMLElement & { update(): Promise<void> };
		await sleep();
		expect(innerRuns).toBe(1);
		expect(outerRuns).toBe(1);

		await element.update();
		expect(outerRuns).toBe(2);
		expect(innerRuns).toBe(1); //the installed generator must NOT be restarted as well
		expect(element.shadowRoot?.textContent).toContain("outer 2");
		element.remove();
	});

	test("an update generator yielded before another one is not re-run by the refire", async () => {
		let innerRuns = 0;
		let outerRuns = 0;
		const element = mount(
			component(function* () {
				yield function* () {
					yield html`<p>outer ${++outerRuns}</p>`;
				};
				yield function* () {
					innerRuns++;
					yield html`<p>inner ${innerRuns}</p>`;
				};
			}),
		) as HTMLElement & { update(): Promise<void> };
		await sleep();
		expect(outerRuns).toBe(1);
		expect(innerRuns).toBe(1);

		await element.update();
		expect(innerRuns).toBe(2);
		expect(outerRuns).toBe(1); //the outer's stale record must not answer the refire
		expect(element.shadowRoot?.textContent).toContain("inner 2");
		element.remove();
	});

	test("a paint throw during an update logs exactly one console error and is fatal", async () => {
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => {});
		let bad = false;
		const element = mount(
			component(function* () {
				yield function* () {
					yield bad ? html`<p>${Symbol("x")}</p>` : html`<p>fine</p>`;
				};
			}),
		) as HTMLElement & { update(): Promise<void> };
		await sleep();
		expect(element.shadowRoot?.textContent).toContain("fine");

		bad = true;
		await element.update(); //must not be swallowed by the DONE outer falling through to NOOP
		expect(consoleError).toHaveBeenCalledTimes(1);
		element.remove();
	});
});
