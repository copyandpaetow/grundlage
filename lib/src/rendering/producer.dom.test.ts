import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { html } from "../parser/html";
import { BaseComponent } from "../types";
import { createPainter } from "./painter";
import { clientCommit, createProducer, serverCommit, startRoot } from "./producer";

/*
the Producer capability's install + error-bubble paths (jobs A3, C1, E1–E3). these run synchronously
inside startRoot, so most assertions need no await. the error path is re-entrant (inner → bubble →
root rethrow → root.onError → bubble AGAIN); its load-bearing property is that the terminal case
warns EXACTLY once — that's pinned here.
*/

const makeHost = (): BaseComponent => {
	const host = document.createElement("div");
	host.attachShadow({ mode: "open" });
	return host as unknown as BaseComponent;
};

const connect = (host: BaseComponent, rootGen: Parameters<typeof startRoot>[1]) => {
	const producer = createProducer(createPainter(host, false), clientCommit);
	startRoot(producer, rootGen);
	return producer;
};

let warnSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
	warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
	warnSpy.mockRestore();
});

describe("producer — producer install (C1)", () => {
	test("a root that yields a template is static (no recipe, no current task)", () => {
		const host = makeHost();
		const producer = connect(host, function* () {
			yield html`<p>${"static"}</p>`;
		});

		expect(host.shadowRoot?.querySelector("p")?.textContent).toBe("static");
		expect(producer.createCurrent).toBeNull(); //static ⇒ update() is a no-op (C6)
		expect(producer.currentTask).toBeNull();
	});

	test("a root that yields a render function records it as the restart recipe", () => {
		const host = makeHost();
		const renderFn = (_host: BaseComponent) => html`<p>${"fn"}</p>`;
		const producer = connect(host, function* () {
			yield renderFn;
		});

		expect(host.shadowRoot?.querySelector("p")?.textContent).toBe("fn");
		expect(producer.createCurrent).toBe(renderFn); //re-callable on update()
		expect(producer.currentTask).toBeNull(); //render-fn has no live generator
	});

	test("a root that yields a generator installs a live current task", () => {
		const host = makeHost();
		const inner = function* () {
			yield html`<span>${"gen"}</span>`;
		};
		const producer = connect(host, function* () {
			yield inner;
		});

		expect(host.shadowRoot?.querySelector("span")?.textContent).toBe("gen");
		expect(producer.createCurrent).toBe(inner);
		expect(producer.currentTask).not.toBeNull(); //non-null ⇔ the current producer is a generator
	});
});

describe("producer — server one-shot (serverCommit)", () => {
	const connectServer = (host: BaseComponent, rootGen: Parameters<typeof startRoot>[1]) => {
		const producer = createProducer(createPainter(host, false), serverCommit);
		startRoot(producer, rootGen);
		return producer;
	};

	test("paints the first renderable and abandons the rest", () => {
		const host = makeHost();
		const producer = connectServer(host, function* () {
			yield html`<p>${"first"}</p>`;
			yield html`<p>${"second"}</p>`; //unreached — serverCommit cancels the root after the first paint
		});

		expect(host.shadowRoot?.querySelector("p")?.textContent).toBe("first");
		expect(producer.rootTask?.finished).toBe(true); //cancelled (not nulled) by serverCommit — the one-shot
	});

	test("a child generator's first renderable is the one-shot; the root never resumes", () => {
		const host = makeHost();
		const inner = function* () {
			yield html`<span>${"child"}</span>`;
		};
		const producer = connectServer(host, function* () {
			yield inner;
			yield html`<p>${"after"}</p>`; //unreached — the child's paint stops the world
		});

		expect(host.shadowRoot?.querySelector("span")?.textContent).toBe("child");
		expect(host.shadowRoot?.querySelector("p")).toBeNull();
		expect(producer.rootTask?.finished).toBe(true); //cancelled by serverCommit
	});
});

describe("producer — depth limit (A3)", () => {
	test("an inner generator yielding a generator function aborts", () => {
		const host = makeHost();
		const inner = function* () {
			yield function* () {}; //a depth-1 task may not install a nested generator
		};
		connect(host, function* () {
			yield inner;
		});

		expect(host.shadowRoot?.textContent).toContain("Inner generators cannot yield generator functions");
		expect(warnSpy).toHaveBeenCalledTimes(1);
	});
});

describe("producer — error bubble (E1–E3)", () => {
	//the inner is a LIVE child that yields a render function which throws when invoked — so the error
	//routes through the child's settle → bubble → throwIntoTask(root), the recoverable path. (an inner
	//that threw on its first .next() would instead escape to the root's driver, a different case.)
	const innerThatThrows = function* () {
		yield () => {
			throw new Error("inner-boom");
		};
	};

	test("E2: the root recovers by catching and yielding new content (no warn)", () => {
		const host = makeHost();
		const producer = connect(host, function* () {
			try {
				yield innerThatThrows;
			} catch {
				yield html`<p>recovered</p>`;
			}
		});

		expect(host.shadowRoot?.querySelector("p")?.textContent).toBe("recovered");
		expect(warnSpy).not.toHaveBeenCalled(); //recovery is silent
		expect(producer.currentTask).toBeNull(); //dead child swapped out
	});

	test("E2b: the root recovers by catching and returning a cleanup; prior DOM persists", () => {
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
		const producer = connect(host, function* () {
			yield innerThatThrows; //no try/catch — the bubble re-enters the root and aborts
		});

		expect(host.shadowRoot?.textContent).toContain("inner-boom");
		expect(warnSpy).toHaveBeenCalledTimes(1); //the re-entrant path warns ONCE (invariant #1)
		expect(producer.rootTask).toBeNull(); //fully torn down
		expect(producer.currentTask).toBeNull();
		expect(producer.createCurrent).toBeNull();
	});
});
