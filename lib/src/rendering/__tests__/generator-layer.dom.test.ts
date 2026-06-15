import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { html } from "../../parser/html";
import { BaseComponent } from "../../types";
import { createPainter } from "../painter";
import {
	createRenderState,
	startOuterGenerator,
	writeToDom,
	writeToServerDom,
} from "../generator-layer";

/*
the RenderState's install + error-bubble paths (jobs A3, C1, E1–E3). these run synchronously inside
startOuterGenerator, so most assertions need no await. the error path is re-entrant (inner → bubble →
outer rethrow → handleRendererError AGAIN); its load-bearing property is that the terminal case warns
EXACTLY once — that's pinned here.
*/

const makeHost = (): BaseComponent => {
	const host = document.createElement("div");
	host.attachShadow({ mode: "open" });
	return host as unknown as BaseComponent;
};

const connect = (
	host: BaseComponent,
	outerGen: Parameters<typeof startOuterGenerator>[1],
) => {
	const state = createRenderState(createPainter(host, false), writeToDom);
	startOuterGenerator(state, outerGen);
	return state;
};

let warnSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
	warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
	warnSpy.mockRestore();
});

describe("render state — renderer install (C1)", () => {
	test("an outer that yields a template is static (no recipe, no current run)", () => {
		const host = makeHost();
		const state = connect(host, function* () {
			yield html`<p>${"static"}</p>`;
		});

		expect(host.shadowRoot?.querySelector("p")?.textContent).toBe("static");
		expect(state.currentRenderer).toBeNull(); //static ⇒ update() is a no-op (C6)
		expect(state.currentRun).toBeNull();
	});

	test("an outer that yields a render function records it as the restart recipe", () => {
		const host = makeHost();
		const renderFn = (_host: BaseComponent) => html`<p>${"fn"}</p>`;
		const state = connect(host, function* () {
			yield renderFn;
		});

		expect(host.shadowRoot?.querySelector("p")?.textContent).toBe("fn");
		expect(state.currentRenderer).toBe(renderFn); //re-callable on update()
		expect(state.currentRun).toBeNull(); //render-fn has no live generator
	});

	test("an outer that yields a generator installs a live current run", () => {
		const host = makeHost();
		const inner = function* () {
			yield html`<span>${"gen"}</span>`;
		};
		const state = connect(host, function* () {
			yield inner;
		});

		expect(host.shadowRoot?.querySelector("span")?.textContent).toBe("gen");
		expect(state.currentRenderer).toBe(inner);
		expect(state.currentRun).not.toBeNull(); //non-null ⇔ the current renderer is a generator
	});
});

describe("render state — server one-shot (writeToServerDom)", () => {
	const connectServer = (
		host: BaseComponent,
		outerGen: Parameters<typeof startOuterGenerator>[1],
	) => {
		const state = createRenderState(
			createPainter(host, false),
			writeToServerDom,
		);
		startOuterGenerator(state, outerGen);
		return state;
	};

	test("paints the first renderable and abandons the rest", () => {
		const host = makeHost();
		const state = connectServer(host, function* () {
			yield html`<p>${"first"}</p>`;
			yield html`<p>${"second"}</p>`; //unreached — writeToServerDom cancels the outer after the first paint
		});

		expect(host.shadowRoot?.querySelector("p")?.textContent).toBe("first");
		expect(state.outerRun?.finished).toBe(true); //cancelled (not nulled) by writeToServerDom — the one-shot
	});

	test("an inner generator's first renderable is the one-shot; the outer never resumes", () => {
		const host = makeHost();
		const inner = function* () {
			yield html`<span>${"child"}</span>`;
		};
		const state = connectServer(host, function* () {
			yield inner;
			yield html`<p>${"after"}</p>`; //unreached — the inner's paint stops the world
		});

		expect(host.shadowRoot?.querySelector("span")?.textContent).toBe("child");
		expect(host.shadowRoot?.querySelector("p")).toBeNull();
		expect(state.outerRun?.finished).toBe(true); //cancelled by writeToServerDom
	});
});

describe("render state — depth limit (A3)", () => {
	test("an inner generator yielding a generator function aborts", () => {
		const host = makeHost();
		const inner = function* () {
			yield function* () {}; //a depth-1 run may not install a nested generator
		};
		connect(host, function* () {
			yield inner;
		});

		expect(host.shadowRoot?.textContent).toContain(
			"Inner generators cannot yield generator functions",
		);
		expect(warnSpy).toHaveBeenCalledTimes(1);
	});
});

describe("render state — error bubble (E1–E3)", () => {
	//the inner is a LIVE inner run that yields a render function which throws when invoked — so the error
	//routes through the inner's settle → bubble → offerErrorToOuterGenerator, the recoverable path. (an
	//inner that threw on its first .next() would instead escape to the outer's driver, a different case.)
	const innerThatThrows = function* () {
		yield () => {
			throw new Error("inner-boom");
		};
	};

	test("E2: the outer recovers by catching and yielding new content (no warn)", () => {
		const host = makeHost();
		const state = connect(host, function* () {
			try {
				yield innerThatThrows;
			} catch {
				yield html`<p>recovered</p>`;
			}
		});

		expect(host.shadowRoot?.querySelector("p")?.textContent).toBe("recovered");
		expect(warnSpy).not.toHaveBeenCalled(); //recovery is silent
		expect(state.currentRun).toBeNull(); //dead inner run swapped out
	});

	test("E2b: the outer recovers by catching and returning a cleanup; prior DOM persists", () => {
		const host = makeHost();
		const cleanup = vi.fn();
		connect(host, function* () {
			try {
				yield html`<p>before</p>`; //painted before the error
				yield innerThatThrows;
			} catch {
				return cleanup;
			}
		});

		expect(host.shadowRoot?.querySelector("p")?.textContent).toBe("before"); //static persists
		expect(cleanup).toHaveBeenCalledTimes(1); //captured return fired by the teardown cancel
		expect(warnSpy).not.toHaveBeenCalled();
	});

	test("E3: an uncaught error is terminal — written to the shadow, warned exactly once", () => {
		const host = makeHost();
		const state = connect(host, function* () {
			yield innerThatThrows; //no try/catch — the bubble re-enters the outer and aborts
		});

		expect(host.shadowRoot?.textContent).toContain("inner-boom");
		expect(warnSpy).toHaveBeenCalledTimes(1); //the re-entrant path warns ONCE (invariant #1)
		expect(state.outerRun).toBeNull(); //fully torn down
		expect(state.currentRun).toBeNull();
		expect(state.currentRenderer).toBeNull();
	});
});
