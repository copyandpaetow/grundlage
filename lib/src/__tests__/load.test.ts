import { describe, expect, test } from "vitest";
import { load, LOAD_REQUEST, LoadRequest } from "../load";
import type { ComponentRunner } from "../runtime/driver";
import { html } from "../template";

//node env: the protocol between load() and the driver, and the plain-data check. The round trip
//through a component lives in tests/integration/load.browser.test.ts

type LoadGenerator = Generator<
	LoadRequest | Promise<unknown>,
	unknown,
	unknown
>;

//stand-ins for the runner the driver hands back: a load reads nothing else of it
const createServerRunner = (): ComponentRunner =>
	({
		wasMountedOnServer: true,
		loadsRecordedOnServer: [],
		root: { host: { localName: "load-host" }, isHydrationPending: false },
	}) as unknown as ComponentRunner;

const createBrowserRunner = (): ComponentRunner =>
	({
		wasMountedOnServer: false,
		loadsRecordedOnServer: [],
		root: { host: { localName: "load-host" }, isHydrationPending: false },
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

const loadOnServer = (value: unknown): unknown =>
	finishSynchronousLoad(
		load(() => value),
		createServerRunner(),
	);

describe("load() asks the driver for its runner, then loads by itself", () => {
	test("the first yield is the request, and the fetcher waits for the answer", () => {
		let runCount = 0;
		const generator = load(() => {
			runCount++;
			return 1;
		});
		expect(generator.next()).toEqual({ done: false, value: LOAD_REQUEST });
		expect(runCount).toBe(0);
	});

	test("the request is a registered symbol, so another copy of the library recognizes it", () => {
		expect(LOAD_REQUEST).toBe(Symbol.for("grundlage.load-request"));
	});

	test("a synchronous result is returned at once, which `yield*` evaluates to", () => {
		const value = { title: "a post" };
		expect(
			finishSynchronousLoad(
				load(() => value),
				createBrowserRunner(),
			),
		).toBe(value);
	});

	test("a promise goes to the driver, and the value sent back is returned", () => {
		const fetched = Promise.resolve("value");
		const generator = load("post", () => fetched);
		generator.next();
		expect(generator.next(createBrowserRunner())).toEqual({
			done: false,
			value: fetched,
		});
		expect(generator.next("value")).toEqual({ done: true, value: "value" });
	});

	test.each([
		["a key without a fetcher", ["post"]],
		["the fetcher before the key", [() => 1, "post"]],
		["a host where the key goes", [{}, () => 1]],
		["nothing", []],
	])("%s throws, naming both spellings", (_, parameters) => {
		const callWithAnyArguments = load as (
			...parameters: Array<unknown>
		) => unknown;
		expect(() => callWithAnyArguments(...parameters)).toThrow(TypeError);
		expect(() => callWithAnyArguments(...parameters)).toThrow(
			'load(() => fetchData()) or load("name", () => fetchData())',
		);
	});
});

class Point {
	constructor(
		public x: number,
		public y: number,
	) {}
}

describe("a server result must survive JSON, and the message names the fix", () => {
	test.each([
		["a string", "text"],
		["a finite number", 4.2],
		["a boolean", false],
		["null", null],
		["undefined", undefined],
		[
			"a nested plain object and array",
			{ posts: [{ title: "a", tags: ["b"] }] },
		],
		[
			"an object without a prototype",
			Object.assign(Object.create(null), { a: 1 }),
		],
	])("%s passes", (_, value) => {
		expect(loadOnServer(value)).toBe(value);
	});

	test.each([
		["a Date", new Date(0), "its result is a Date: return the string"],
		["a Response", new Response("{}"), "return response.json() instead"],
		[
			"a nested promise",
			{ comments: Promise.resolve([]) },
			"its result.comments is a promise: await it inside the fetcher",
		],
		["a Map", new Map(), "is an instance of Map"],
		["a class instance", new Point(1, 2), "is an instance of Point"],
		["a bigint", 1n, "is a bigint"],
		["NaN", Number.NaN, "is NaN"],
		["Infinity", Number.POSITIVE_INFINITY, "is Infinity"],
		["a symbol", Symbol("s"), "is a symbol"],
		["a function", () => 1, "is a function: return data, not code"],
		["a template", html`<p>view</p>`, "yield function* view()"],
	])("%s is refused", (_, value, fix) => {
		expect(() => loadOnServer(value)).toThrow(
			"load() takes a fetcher that returns plain data",
		);
		expect(() => loadOnServer(value)).toThrow(fix);
	});

	test("a module namespace is refused with the import() fix", async () => {
		const module = await import("node:path");
		expect(() => loadOnServer(module)).toThrow(
			"yield the import() promise itself",
		);
	});

	test("the message points at the nested value that fails", () => {
		const value = { posts: [{ title: "a" }, { publishedAt: new Date(0) }] };
		expect(() => loadOnServer(value)).toThrow(
			"its result.posts[1].publishedAt is a Date",
		);
	});

	test("a cycle is refused instead of overflowing", () => {
		const node: { child?: unknown } = {};
		node.child = { parent: node };
		expect(() => loadOnServer(node)).toThrow(
			"its result.child.parent points back at an object that holds it, a cycle JSON cannot carry: leave that reference out",
		);
	});

	test("a value shared twice is not a cycle", () => {
		const shared = { name: "tag" };
		expect(loadOnServer([shared, shared])).toEqual([shared, shared]);
	});

	test("nesting past the depth limit is refused instead of overflowing", () => {
		let deep: Array<unknown> = [];
		for (let level = 0; level < 600; level++) deep = [deep];
		expect(() => loadOnServer(deep)).toThrow("nested deeper than 512 levels");
	});

	test("in a development build the browser makes the same check", () => {
		const loadInBrowser = (value: unknown) =>
			finishSynchronousLoad(
				load(() => value),
				createBrowserRunner(),
			);
		expect(() => loadInBrowser(new Date(0))).toThrow("is a Date");
		expect(() => loadInBrowser(html`<p>view</p>`)).toThrow("is a template");
		expect(loadInBrowser({ title: "a" })).toEqual({ title: "a" });
	});
});
