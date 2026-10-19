import { beforeEach, describe, expect, test, vi } from "vitest";
import {
	flushHostPayload,
	load,
	LOAD_REQUEST,
	LoadRequest,
	releaseUnclaimedPayloads,
} from "../load";
import type { ComponentRunner } from "../runtime/driver";

//happy-dom env: the payload protocol, from the server's record and flush to the browser's claim and
//release. The driver decides when each runs; tests/integration/load.browser.test.ts covers that

type LoadGenerator = Generator<
	LoadRequest | Promise<unknown>,
	unknown,
	unknown
>;

const createHostWithShadow = (): HTMLElement => {
	const host = document.createElement("div");
	host.attachShadow({ mode: "open" });
	document.body.appendChild(host);
	return host;
};

//stand-ins for the runner the driver hands back: a load reads nothing else of it
const createServerRunner = (host: HTMLElement): ComponentRunner =>
	({
		wasMountedOnServer: true,
		loadsRecordedOnServer: [],
		root: { host, shadowRoot: host.shadowRoot, isHydrationPending: false },
	}) as unknown as ComponentRunner;

const createHydratingRunner = (host: HTMLElement): ComponentRunner =>
	({
		wasMountedOnServer: false,
		loadsRecordedOnServer: [],
		root: { host, shadowRoot: host.shadowRoot, isHydrationPending: true },
	}) as unknown as ComponentRunner;

//what the driver does for a fetcher that returns at once: answer the request, take the result
const finishSynchronousLoad = (
	generator: LoadGenerator,
	runner: ComponentRunner,
): unknown => {
	expect(generator.next()).toEqual({ done: false, value: LOAD_REQUEST });
	const step = generator.next(runner);
	expect(step.done).toBe(true);
	return step.value;
};

const failingFetcher = (): never => {
	throw new Error("offline");
};

const payloadScript = (
	content: string | null,
	attributes: Record<string, string> = {},
): HTMLScriptElement => {
	const script = document.createElement("script");
	script.setAttribute("type", "application/json");
	script.setAttribute("data-ssr", "");
	for (const [name, value] of Object.entries(attributes))
		script.setAttribute(name, value);
	if (content !== null) script.textContent = content;
	return script;
};

const payloadScriptsOf = (shadowRoot: ShadowRoot) =>
	Array.from(shadowRoot.querySelectorAll("script[data-ssr]"));

beforeEach(() => {
	document.body.innerHTML = "";
});

describe("the server writes one script per load, in call order, at the first paint", () => {
	test("scripts follow the painted content, keyed ones carry their key", () => {
		const host = createHostWithShadow();
		const runner = createServerRunner(host);
		host.shadowRoot!.append(document.createElement("article"));
		finishSynchronousLoad(
			load(() => "alpha"),
			runner,
		);
		finishSynchronousLoad(
			load("beta", () => ({ name: "Ada" })),
			runner,
		);

		flushHostPayload(runner.loadsRecordedOnServer, host.shadowRoot!);

		const children = host.shadowRoot!.children;
		expect(children.length).toBe(3);
		expect(children[0].tagName).toBe("ARTICLE");
		expect(children[1].getAttribute("data-key")).toBeNull();
		expect(children[1].textContent).toBe('"alpha"');
		expect(children[2].getAttribute("data-key")).toBe("beta");
		expect(children[2].textContent).toBe('{"name":"Ada"}');
	});

	test("a failed load keeps its position as an empty placeholder", () => {
		const host = createHostWithShadow();
		const runner = createServerRunner(host);
		expect(() => finishSynchronousLoad(load(failingFetcher), runner)).toThrow(
			"offline",
		);
		finishSynchronousLoad(
			load(() => "second"),
			runner,
		);

		flushHostPayload(runner.loadsRecordedOnServer, host.shadowRoot!);

		const [failed, second] = payloadScriptsOf(host.shadowRoot!);
		expect(failed.hasAttribute("data-failed")).toBe(true);
		expect(failed.textContent).toBe("");
		expect(second.textContent).toBe('"second"');
	});

	test("a rejection the driver throws back keeps its position too", () => {
		const host = createHostWithShadow();
		const runner = createServerRunner(host);
		const generator = load(() => new Promise(() => {}));
		generator.next();
		generator.next(runner);

		expect(() => generator.throw(new Error("offline"))).toThrow("offline");

		flushHostPayload(runner.loadsRecordedOnServer, host.shadowRoot!);
		const [failed] = payloadScriptsOf(host.shadowRoot!);
		expect(failed.hasAttribute("data-failed")).toBe(true);
	});

	test("a run torn down while it waits never resumes, so its result takes no position", () => {
		const host = createHostWithShadow();
		const runner = createServerRunner(host);
		const generator = load(() => new Promise(() => {}));
		generator.next();
		generator.next(runner);

		generator.return(undefined);
		finishSynchronousLoad(
			load(() => "after the teardown"),
			runner,
		);

		flushHostPayload(runner.loadsRecordedOnServer, host.shadowRoot!);
		const scripts = payloadScriptsOf(host.shadowRoot!);
		expect(scripts).toHaveLength(1);
		expect(scripts[0].textContent).toBe('"after the teardown"');
	});

	test("`<` is escaped, so a value holding `</script>` cannot end the script early", () => {
		const host = createHostWithShadow();
		const runner = createServerRunner(host);
		const value = { body: "</script><script>alert(1)</script>" };
		finishSynchronousLoad(
			load(() => value),
			runner,
		);

		flushHostPayload(runner.loadsRecordedOnServer, host.shadowRoot!);

		const [script] = payloadScriptsOf(host.shadowRoot!);
		expect(script.textContent).not.toContain("</script>");
		expect(script.textContent).toContain("\\u003c/script>");
		expect(JSON.parse(script.textContent!)).toEqual(value);
	});

	test("undefined is written as null, since JSON.stringify(undefined) is no string", () => {
		const host = createHostWithShadow();
		const runner = createServerRunner(host);
		finishSynchronousLoad(
			load(() => undefined),
			runner,
		);

		flushHostPayload(runner.loadsRecordedOnServer, host.shadowRoot!);

		expect(payloadScriptsOf(host.shadowRoot!)[0].textContent).toBe("null");
	});

	test("a flush empties the recorded loads, so a second flush writes nothing", () => {
		const host = createHostWithShadow();
		const runner = createServerRunner(host);
		finishSynchronousLoad(
			load(() => "once"),
			runner,
		);

		flushHostPayload(runner.loadsRecordedOnServer, host.shadowRoot!);
		flushHostPayload(runner.loadsRecordedOnServer, host.shadowRoot!);

		expect(payloadScriptsOf(host.shadowRoot!)).toHaveLength(1);
	});
});

describe("a key the server already recorded throws", () => {
	test("only a repeated key", () => {
		const runner = createServerRunner(createHostWithShadow());
		finishSynchronousLoad(
			load("post", () => 1),
			runner,
		);

		expect(() =>
			finishSynchronousLoad(
				load("post", () => 2),
				runner,
			),
		).toThrow('two load() calls in <div> use the key "post"');
		expect(
			finishSynchronousLoad(
				load("comments", () => 3),
				runner,
			),
		).toBe(3);
		expect(
			finishSynchronousLoad(
				load(() => 4),
				runner,
			),
		).toBe(4);
	});

	test("a failed load holds its key too", () => {
		const runner = createServerRunner(createHostWithShadow());
		expect(() =>
			finishSynchronousLoad(load("post", failingFetcher), runner),
		).toThrow("offline");

		expect(() =>
			finishSynchronousLoad(
				load("post", () => 1),
				runner,
			),
		).toThrow('use the key "post"');
	});
});

describe("a hydrating browser claims a server value and removes its script", () => {
	test("positional values come back in order without fetching, and each claim removes its script", () => {
		const host = createHostWithShadow();
		host.shadowRoot!.append(
			payloadScript('{"name":"Ada"}'),
			payloadScript('{"name":"Lin"}'),
		);
		const runner = createHydratingRunner(host);
		const fetcher = vi.fn(() => "fetched");

		expect(finishSynchronousLoad(load(fetcher), runner)).toEqual({
			name: "Ada",
		});
		expect(finishSynchronousLoad(load(fetcher), runner)).toEqual({
			name: "Lin",
		});
		expect(fetcher).not.toHaveBeenCalled();
		expect(payloadScriptsOf(host.shadowRoot!)).toHaveLength(0);
	});

	test("a keyed claim skips positional scripts, and a positional claim skips keyed ones", () => {
		const host = createHostWithShadow();
		host.shadowRoot!.append(
			payloadScript('"positional"'),
			payloadScript('["p1"]', { "data-key": "posts" }),
		);
		const runner = createHydratingRunner(host);

		expect(
			finishSynchronousLoad(
				load("posts", () => "fetched"),
				runner,
			),
		).toEqual(["p1"]);
		expect(
			finishSynchronousLoad(
				load(() => "fetched"),
				runner,
			),
		).toBe("positional");
	});

	test("a failed placeholder is removed and claims nothing, so the browser fetches", () => {
		const host = createHostWithShadow();
		host.shadowRoot!.append(
			payloadScript(null, { "data-failed": "" }),
			payloadScript('"second"'),
		);
		const runner = createHydratingRunner(host);

		expect(
			finishSynchronousLoad(
				load(() => "fetched"),
				runner,
			),
		).toBe("fetched");
		expect(
			finishSynchronousLoad(
				load(() => "fetched"),
				runner,
			),
		).toBe("second");
	});

	test("a missing position warns about a branch, a missing key does not", () => {
		const runner = createHydratingRunner(createHostWithShadow());
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

		expect(
			finishSynchronousLoad(
				load("draft", () => "fetched"),
				runner,
			),
		).toBe("fetched");
		expect(warnSpy).not.toHaveBeenCalled();
		expect(
			finishSynchronousLoad(
				load(() => "fetched"),
				runner,
			),
		).toBe("fetched");
		expect(warnSpy).toHaveBeenCalledTimes(1);
		expect(String(warnSpy.mock.calls[0][0])).toContain(
			"the browser reached a load() the server did not reach",
		);
		warnSpy.mockRestore();
	});

	test("a script the component painted itself, below the root, is not a payload", () => {
		const host = createHostWithShadow();
		const wrapper = document.createElement("div");
		const ownScript = payloadScript('"the component\'s own data"');
		wrapper.append(ownScript);
		host.shadowRoot!.append(wrapper);
		const runner = createHydratingRunner(host);
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

		expect(
			finishSynchronousLoad(
				load(() => "fetched"),
				runner,
			),
		).toBe("fetched");
		releaseUnclaimedPayloads(host.shadowRoot!);

		const warnings = warnSpy.mock.calls.map((call) => String(call[0]));
		expect(ownScript.isConnected).toBe(true);
		expect(warnings.some((warning) => warning.includes("went unused"))).toBe(
			false,
		);
		warnSpy.mockRestore();
	});

	test("a round trip hands back what the server recorded", () => {
		const host = createHostWithShadow();
		const serverRunner = createServerRunner(host);
		const value = { body: "</script>", tags: ["a"], count: 2, draft: null };
		finishSynchronousLoad(
			load(() => value),
			serverRunner,
		);
		finishSynchronousLoad(
			load("comments", () => ["first"]),
			serverRunner,
		);
		flushHostPayload(serverRunner.loadsRecordedOnServer, host.shadowRoot!);
		const hydratingRunner = createHydratingRunner(host);

		expect(
			finishSynchronousLoad(
				load(() => "fetched"),
				hydratingRunner,
			),
		).toEqual(value);
		expect(
			finishSynchronousLoad(
				load("comments", () => "fetched"),
				hydratingRunner,
			),
		).toEqual(["first"]);
	});
});

describe("at the hydrating paint, leftover scripts are removed", () => {
	test("every leftover goes, and only positional ones warn, with their count", () => {
		const host = createHostWithShadow();
		host.shadowRoot!.append(
			document.createElement("article"),
			payloadScript('"posts"'),
			payloadScript('"draft"', { "data-key": "draft" }),
			payloadScript(null, { "data-failed": "" }),
		);
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

		releaseUnclaimedPayloads(host.shadowRoot!);

		expect(payloadScriptsOf(host.shadowRoot!)).toHaveLength(0);
		expect(host.shadowRoot!.children[0].tagName).toBe("ARTICLE");
		expect(warnSpy).toHaveBeenCalledTimes(1);
		expect(String(warnSpy.mock.calls[0][0])).toContain(
			"2 load() result(s) from the server went unused while hydrating",
		);
		warnSpy.mockRestore();
	});

	test("keyed leftovers are a branch the browser did not take, so they stay silent", () => {
		const host = createHostWithShadow();
		host.shadowRoot!.append(payloadScript('"draft"', { "data-key": "draft" }));
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

		releaseUnclaimedPayloads(host.shadowRoot!);

		expect(payloadScriptsOf(host.shadowRoot!)).toHaveLength(0);
		expect(warnSpy).not.toHaveBeenCalled();
		warnSpy.mockRestore();
	});
});
