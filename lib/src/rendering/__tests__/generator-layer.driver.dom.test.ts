import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { html } from "../../parser/html";
import { BaseComponent } from "../../types";
import { createPainter } from "../painter";
import {
	cancelRun,
	createRenderState,
	offerErrorToOuterGenerator,
	rerunCurrentRenderer,
	startOuterGenerator,
} from "../generator-layer";

/*
the generator-run mechanics (jobs A1/A4, D1–D4, E1, depth), formerly task.test.ts. since the merge, a
GeneratorRun is coupled to its RenderState — the driver reaches handleYieldedValue /
handleRendererError directly — so there are no behaviour hooks to stub: we drive REAL outer/inner runs
through a RenderState and observe what they write, finish, and tear down. the render state here uses a
recording `writeToDom` strategy (push the written value, don't touch the DOM) so a yield's effect is a
plain array assertion; the shadow DOM is only read on the abort path, where the render state writes the
error itself.
*/

const makeHost = (): BaseComponent => {
	const host = document.createElement("div");
	host.attachShadow({ mode: "open" });
	return host as unknown as BaseComponent;
};

//a render state whose writeToDom RECORDS instead of painting — the written values are the observable
const setup = () => {
	const host = makeHost();
	const committed: unknown[] = [];
	const state = createRenderState(
		createPainter(host, false),
		(_state, value) => {
			committed.push(value);
		},
	);
	return { host, state, committed };
};

//a generator parks the synchronous driver only when it suspends on a real Promise; deferred() gives
//us that Promise so a test can hold a run mid-flight and then cancel/resume it
const deferred = () => {
	let resolve!: (value?: unknown) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise((res, rej) => {
		resolve = res as (value?: unknown) => void;
		reject = rej;
	});
	return { promise, resolve, reject };
};

//async-generator hops are multiple microtasks; a macrotask turn drains them deterministically
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

let warnSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
	warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
	warnSpy.mockRestore();
});

describe("driving (A1/A4)", () => {
	test("a sync outer runs to completion inside startOuterGenerator, writing each renderable in order", () => {
		const { state, committed } = setup();
		const a = html`<p>${"a"}</p>`;
		const b = html`<p>${"b"}</p>`;
		startOuterGenerator(state, function* () {
			yield a;
			yield b;
		});

		expect(committed).toEqual([a, b]);
		expect(state.outerRun?.finished).toBe(true);
	});

	test("handleYieldedValue hands the host back as the yield expression's value", () => {
		const { state, host } = setup();
		let fedBack: unknown;
		startOuterGenerator(state, function* () {
			fedBack = yield html`<p>${"x"}</p>`;
		});

		expect(fedBack).toBe(host); //the real client handler returns the host so `yield` evaluates to it
	});

	test("a sync outer that yields a Promise unwraps it before writing (A4)", async () => {
		const { state, host, committed } = setup();
		const template = html`<p>${"p"}</p>`;
		let fedBack: unknown;
		startOuterGenerator(state, function* () {
			fedBack = yield Promise.resolve(template);
		});
		expect(committed).toEqual([]); //parked on the Promise — nothing written yet

		await tick();
		expect(committed).toEqual([template]); //resolved value, not the Promise
		expect(fedBack).toBe(host);
	});

	test("a sync throw during the first step is routed, not propagated (create-before-drive)", () => {
		//startOuterGenerator stores outerRun BEFORE driving, so a throw that surfaces synchronously in
		//the first step (here: a render fn that throws when invoked) re-enters error routing against the
		//live run and aborts cleanly — it does not escape startOuterGenerator
		const { state, host } = setup();
		expect(() =>
			startOuterGenerator(state, function* () {
				yield () => {
					throw new Error("first-step boom");
				};
			}),
		).not.toThrow();

		expect(host.shadowRoot?.textContent).toContain("first-step boom");
		expect(warnSpy).toHaveBeenCalledTimes(1);
		expect(state.outerRun).toBeNull(); //aborted + torn down
	});

	test("a throw before the first yield escapes startOuterGenerator to the caller boundary", () => {
		//the driver does generator.next() up front, so a throw before any yield isn't routed through the
		//error path — it propagates to the public entry point (connectedCallback), which owns first-step
		//failures (CONVENTIONS #7)
		const { state } = setup();
		expect(() =>
			startOuterGenerator(state, function* (): Generator {
				throw new Error("boom before any yield");
				yield "never";
			}),
		).toThrow("boom before any yield");
		expect(warnSpy).not.toHaveBeenCalled(); //not routed through the error path
	});
});

describe("completion & cleanup (D1/D2/D4)", () => {
	test("`return cleanupFn` is captured on completion but not fired until cancel (D2)", () => {
		const { state } = setup();
		const cleanup = vi.fn();
		startOuterGenerator(state, function* () {
			yield html`<p>${"a"}</p>`;
			return cleanup;
		});
		const outer = state.outerRun!;

		expect(outer.cleanup).toBe(cleanup);
		expect(cleanup).not.toHaveBeenCalled(); //captured, deferred

		cancelRun(outer);
		expect(cleanup).toHaveBeenCalledTimes(1);
	});

	test("cancel runs the generator's finally even while parked mid-flight (D1)", () => {
		const { state, committed } = setup();
		const gate = deferred();
		let finallyRan = false;
		startOuterGenerator(state, function* () {
			try {
				yield html`<p>${"a"}</p>`;
				yield gate.promise; //parks the driver here
				yield html`<p>${"unreached"}</p>`;
			} finally {
				finallyRan = true;
			}
		});
		const outer = state.outerRun!;
		expect(committed).toHaveLength(1); //parked on the gate after the first write

		cancelRun(outer);
		expect(finallyRan).toBe(true);
		expect(outer.finished).toBe(true);
		expect(outer.cleanup).toBeNull(); //no `return cleanupFn` reached — nothing to capture on cancel
	});

	test("cancel is idempotent: finally and cleanup fire exactly once (D4)", () => {
		const { state } = setup();
		const cleanup = vi.fn();
		let finallyCount = 0;
		startOuterGenerator(state, function* () {
			try {
				yield html`<p>${"a"}</p>`;
				return cleanup;
			} finally {
				finallyCount++;
			}
		});
		const outer = state.outerRun!; //natural completion: finally ran here, cleanup captured

		cancelRun(outer);
		cancelRun(outer);
		cancelRun(outer);
		expect(finallyCount).toBe(1);
		expect(cleanup).toHaveBeenCalledTimes(1);
	});

	test("cancelRun swallows a throw from the generator's finally so teardown continues", () => {
		const { state } = setup();
		const gate = deferred();
		startOuterGenerator(state, function* () {
			try {
				yield gate.promise; //parks here; cancel's .return() triggers the finally
			} finally {
				throw new Error("finally threw");
			}
		});
		const outer = state.outerRun!;

		expect(() => cancelRun(outer)).not.toThrow();
		expect(outer.finished).toBe(true);
	});
});

describe("cancellation containment (D3)", () => {
	test("a cancelled async run's late await goes nowhere", async () => {
		const { state, committed } = setup();
		const gate = deferred();
		startOuterGenerator(state, async function* () {
			yield html`<p>${"a"}</p>`;
			await gate.promise;
			yield html`<p>${"b"}</p>`; //must never write after cancel
		});
		await tick();
		expect(committed).toHaveLength(1); //parked inside the await

		cancelRun(state.outerRun!);
		gate.resolve();
		await tick();
		expect(committed).toHaveLength(1); //"b" contained
	});

	test("a sync run parked on a yielded Promise is contained after cancel", async () => {
		const { state, committed } = setup();
		const gate = deferred();
		startOuterGenerator(state, function* () {
			yield html`<p>${"a"}</p>`;
			yield gate.promise;
			yield html`<p>${"b"}</p>`;
		});
		expect(committed).toHaveLength(1);

		cancelRun(state.outerRun!);
		gate.resolve("resumed");
		await tick();
		expect(committed).toHaveLength(1); //resolution of the parked Promise is dropped
	});
});

describe("errors (E1 mechanics)", () => {
	test("offerErrorToOuterGenerator resumes a generator that catches and recovers (no warn)", () => {
		const { state, committed } = setup();
		const gate = deferred();
		const recovered = html`<p>${"recovered"}</p>`;
		startOuterGenerator(state, function* () {
			try {
				yield gate.promise; //parked here when the error is injected
			} catch {
				yield recovered;
			}
		});

		offerErrorToOuterGenerator(state, new Error("injected"));
		expect(committed).toEqual([recovered]);
		expect(warnSpy).not.toHaveBeenCalled(); //caught, so the error never reaches the abort path
	});

	test("offerErrorToOuterGenerator whose throw escapes finishes the run and reports once", () => {
		const { state, host } = setup();
		const gate = deferred();
		startOuterGenerator(state, function* () {
			yield gate.promise; //no try/catch — the injected error escapes
		});
		const outer = state.outerRun!;

		offerErrorToOuterGenerator(state, new Error("escapes"));
		expect(outer.finished).toBe(true);
		expect(warnSpy).toHaveBeenCalledTimes(1);
		expect(host.shadowRoot?.textContent).toContain("escapes");
	});

	test("offerErrorToOuterGenerator on a finished outer run is a no-op", () => {
		const { state } = setup();
		startOuterGenerator(state, function* () {
			yield html`<p>${"a"}</p>`;
		}); //completes synchronously
		const outer = state.outerRun!;
		expect(outer.finished).toBe(true);

		offerErrorToOuterGenerator(state, new Error("too late"));
		expect(warnSpy).not.toHaveBeenCalled();
	});

	test("a rejected await terminates the run through the error path", async () => {
		const { state, host, committed } = setup();
		startOuterGenerator(state, async function* () {
			yield html`<p>${"a"}</p>`;
			await Promise.reject(new Error("await rejected"));
			yield html`<p>${"b"}</p>`;
		});
		await tick();

		expect(warnSpy).toHaveBeenCalledTimes(1);
		expect(host.shadowRoot?.textContent).toContain("await rejected");
		expect(committed).toHaveLength(1); //"b" never reached
	});
});

describe("depth marker (parent) & inner settle", () => {
	test("an outer has null parent; an inner points at the outer", () => {
		const { state } = setup();
		const inner = function* () {
			yield html`<span>${"child"}</span>`;
		};
		startOuterGenerator(state, function* () {
			yield inner;
		});

		expect(state.outerRun?.parent).toBeNull();
		expect(state.currentRun?.parent).toBe(state.outerRun); //depth-1 inner run's parent is the outer
	});

	test("an in-flight re-run resolves when the re-run inner generator settles (signalRunFinished)", async () => {
		const { state } = setup();
		const inner = function* () {
			yield html`<span>${"v"}</span>`;
		};
		startOuterGenerator(state, function* () {
			yield inner; //installs a live inner generator + records it as the restart recipe
		});

		//rerunCurrentRenderer supersedes the inner run and re-runs it; the fresh inner run reaches its
		//terminal and, as the live inner run, resolves the in-flight update through signalRunFinished
		await expect(rerunCurrentRenderer(state)).resolves.toBeUndefined();
	});
});
