import { afterEach, describe, expect, test, vi } from "vitest";
import { html, component } from "../../index";

//engine-level invariants that are narrower than the integration oracles but are not pure-step
//properties: the terminal warns exactly once along the linear recover-then-fail path, and a
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
	test("an uncaught error warns exactly once", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const element = mount(
			component(function* () {
				yield function* () {
					yield () => {
						throw new Error("once");
					};
				};
			}),
		);
		await sleep();

		expect(element.shadowRoot?.textContent).toContain("once");
		expect(warn).toHaveBeenCalledTimes(1);
		element.remove();
	});

	test("a fatal error displays in closed shadow mode (host.shadowRoot is null)", async () => {
		vi.spyOn(console, "warn").mockImplementation(() => {});
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
					yield () => {
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

	test("update() after a terminal error is a no-op (the renderer was cleared)", async () => {
		vi.spyOn(console, "warn").mockImplementation(() => {});
		let shouldThrow = true;
		const element = mount(
			component(function* () {
				yield () => {
					if (shouldThrow) throw new Error("boom");
					return html`<p>recovered</p>`;
				};
			}),
		) as HTMLElement & { update(): Promise<void> };
		await sleep();
		expect(element.shadowRoot?.textContent).toContain("boom");

		shouldThrow = false;
		await element.update(); //must resolve (not hang) and must NOT re-render
		expect(element.shadowRoot?.textContent).toContain("boom");
		element.remove();
	});

	test("reconnect after a fatal error remounts instead of patching the detached error text", async () => {
		vi.spyOn(console, "warn").mockImplementation(() => {});
		let boom = false;
		const element = mount(
			component(function* () {
				yield () => {
					if (boom) throw new Error("late-boom");
					return html`<p>alive</p>`;
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
		//same-hash re-render must not patch the detached error text; it must remount live DOM
		expect(element.shadowRoot?.textContent).toContain("alive");
		expect(element.shadowRoot?.textContent).not.toContain("late-boom");
		element.remove();
	});

	test("an outer parked on a yielded promise cannot catch its inner's failure", async () => {
		//the yield a throw would land at is owned by the pending promise: catching there would let
		//that promise step the generator a second time, from a position it had already left
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		let rejectInnerRender: (error: Error) => void = () => {};
		const innerRender = new Promise((_resolve, reject) => {
			rejectInnerRender = reject;
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
					yield () => innerRender;
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

		rejectInnerRender(new Error("inner-render-rejected"));
		await sleep();

		expect(caughtAtTheGate).toBe(0);
		expect(element.shadowRoot?.textContent).toContain("inner-render-rejected");
		expect(warn).toHaveBeenCalledTimes(1);

		resolveGate("late");
		await sleep();
		expect(resumedPastTheGate).toBe(0); //nor does the gate resume the torn-down outer
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
						yield () => {
							throw new Error("child-boom");
						};
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

		//the dead child renderer was dropped: update() no-ops (does not re-run/re-throw)
		await element.update();
		expect(warn).not.toHaveBeenCalled();
		expect(cleanupCalls).toBe(0);

		//cleanup runs exactly once, at disconnect
		element.remove();
		await sleep();
		expect(cleanupCalls).toBe(1);
	});
});

describe("the refire enters the task loop", () => {
	test("the outer generator is not stepped again on update", async () => {
		//a refire re-calls the render function only; the generator ran to completion at mount and
		//stepping it again would allocate an iterator result per update on the hot path
		let timesResumedPastTheYield = 0;
		let renders = 0;
		const element = mount(
			component(function* () {
				yield () => html`<p>${++renders}</p>`;
				timesResumedPastTheYield++;
			}),
		) as HTMLElement & { update(): Promise<void> };
		await sleep();
		expect(timesResumedPastTheYield).toBe(1);

		await element.update();
		await element.update();
		await element.update();

		expect(renders).toBe(4);
		expect(timesResumedPastTheYield).toBe(1);
		expect(element.shadowRoot?.textContent).toContain("4");
		element.remove();
	});

	test("the cleanup captured at mount survives every update", async () => {
		let cleanupCalls = 0;
		const element = mount(
			component(function* () {
				yield () => html`<p>x</p>`;
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
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const element = mount(
			component(function* () {
				yield function* () {
					yield () => html`<p>branch</p>`;
					return () => {
						throw new Error("branch-cleanup-threw");
					};
				};
				yield () => html`<p>component</p>`;
			}),
		);
		await sleep();

		expect(element.shadowRoot?.textContent).toContain("component");
		expect(warn).toHaveBeenCalledOnce();
		element.remove();
	});

	test("a branch cleanup that throws does not skip the component's own cleanup", async () => {
		vi.spyOn(console, "warn").mockImplementation(() => {});
		let cleanupCalls = 0;
		const element = mount(
			component(function* () {
				yield function* () {
					yield () => html`<p>branch</p>`;
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
			yield () => html`<p>branch ${branchRuns}</p>`;
		};
		const element = mount(
			component(function* () {
				yield () => branch;
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
				yield () => html`<p>${label}</p>`;
			}),
		) as HTMLElement & { update(): Promise<void> };
		await sleep();
		expect(element.shadowRoot?.textContent).toBe("");

		//nothing is refirable yet: no render function recorded, no generator installed
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
		let renders = 0;
		let resumed = 0;
		const element = mount(
			component(function* () {
				yield () => html`<p>render ${++renders}</p>`;
				yield gate;
				resumed++;
			}),
		) as HTMLElement & { update(): Promise<void> };
		await sleep();
		expect(renders).toBe(1);
		expect(resumed).toBe(0);

		await element.update();
		expect(renders).toBe(2);
		expect(element.shadowRoot?.textContent).toContain("render 2");
		expect(resumed).toBe(0); //the refire must not resume the parked generator

		resolveGate("go");
		await sleep();
		expect(resumed).toBe(1); //the gate's own resolution still does
		element.remove();
	});

	test("a render function yielded after an inner generator wins the refire", async () => {
		//the two refire routes have separate fields now; the last yield decides which one answers
		let innerRuns = 0;
		let renders = 0;
		const element = mount(
			component(function* () {
				yield function* () {
					innerRuns++;
					yield () => html`<p>inner</p>`;
				};
				yield () => html`<p>outer ${++renders}</p>`;
			}),
		) as HTMLElement & { update(): Promise<void> };
		await sleep();
		expect(innerRuns).toBe(1);
		expect(renders).toBe(1);

		await element.update();
		expect(renders).toBe(2);
		expect(innerRuns).toBe(1); //the installed generator must NOT be restarted as well
		expect(element.shadowRoot?.textContent).toContain("outer 2");
		element.remove();
	});

	test("an inner generator yielded after a render function wins the refire", async () => {
		let innerRuns = 0;
		let renders = 0;
		const element = mount(
			component(function* () {
				yield () => html`<p>outer ${++renders}</p>`;
				yield function* () {
					innerRuns++;
					yield () => html`<p>inner ${innerRuns}</p>`;
				};
			}),
		) as HTMLElement & { update(): Promise<void> };
		await sleep();
		expect(renders).toBe(1);
		expect(innerRuns).toBe(1);

		await element.update();
		expect(innerRuns).toBe(2);
		expect(renders).toBe(1); //the outer's stale record must not answer the refire
		expect(element.shadowRoot?.textContent).toContain("inner 2");
		element.remove();
	});

	test("a paint throw during an update warns exactly once and is fatal", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		let bad = false;
		const element = mount(
			component(function* () {
				yield () => (bad ? html`<p>${Symbol("x")}</p>` : html`<p>fine</p>`);
			}),
		) as HTMLElement & { update(): Promise<void> };
		await sleep();
		expect(element.shadowRoot?.textContent).toContain("fine");

		bad = true;
		await element.update(); //must not be swallowed by the DONE outer falling through to NOOP
		expect(warn).toHaveBeenCalledTimes(1);
		element.remove();
	});
});
