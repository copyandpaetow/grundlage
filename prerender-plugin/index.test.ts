import { describe, expect, test } from "vitest";
import { prerenderWebcomponents } from "./index";

//unique-ish tags per scenario so plugin instances don't collide on the shared customElements registry
const TAGS = {
	simple: "ssr-simple",
	withAttrs: "ssr-with-attrs",
	asyncPreYield: "ssr-async-pre-yield",
	falsePositive: "ssr-false-positive-guard",
	multiInstance: "ssr-multi-instance",
	customSentinel: "ssr-custom-sentinel",
	unmarked: "ssr-unmarked",
	noSentinel: "ssr-no-sentinel",
} as const;

//lazy import: the happy-dom polyfill (set up before loaders are awaited) must be in place when parser/html.ts runs its module-load createElement
//one shared idempotent definer keeps the lib import to a single side-effect
let definedPromise: Promise<void> | null = null;
const ensureDefined = (): Promise<void> => {
	if (definedPromise) return definedPromise;
	definedPromise = (async () => {
		const { html, render } = await import("../lib/src");

		customElements.define(
			TAGS.simple,
			render(function* () {
				yield () => html`<p>simple-first</p>`;
				yield () => html`<p>simple-second</p>`;
			}),
		);

		customElements.define(
			TAGS.withAttrs,
			render(function* (host) {
				yield () =>
					html`<p>label=${host.getAttribute("data-label") ?? "none"}</p>`;
			}),
		);

		customElements.define(
			TAGS.asyncPreYield,
			render(function* () {
				const value = yield Promise.resolve("resolved-value");
				yield () => html`<p>${value as string}</p>`;
			}),
		);

		customElements.define(
			TAGS.falsePositive,
			render(function* () {
				yield () => html`<p>should-not-render</p>`;
			}),
		);

		customElements.define(
			TAGS.multiInstance,
			render(function* (host) {
				yield () => html`<p>${host.getAttribute("data-id") ?? "?"}</p>`;
			}),
		);

		customElements.define(
			TAGS.customSentinel,
			render(function* () {
				yield () => html`<p>custom-rendered</p>`;
			}),
		);

		customElements.define(
			TAGS.unmarked,
			render(function* () {
				yield () => html`<p>unmarked-rendered</p>`;
			}),
		);

		customElements.define(
			TAGS.noSentinel,
			render(function* () {
				yield () => html`<p>no-sentinel-rendered</p>`;
			}),
		);
	})();
	return definedPromise;
};

const allComponents = Object.fromEntries(
	Object.values(TAGS).map((tag) => [tag, ensureDefined]),
);

const buildPlugin = (sentinel?: string) =>
	prerenderWebcomponents({
		components: allComponents,
		sentinelAttribute: sentinel,
	});

//handles both shapes vite exposes for transformIndexHtml — function or `{ handler }`
const runTransform = async (
	plugin: ReturnType<typeof prerenderWebcomponents>,
	html: string,
): Promise<string> => {
	const hook = plugin.transformIndexHtml;
	const handler =
		typeof hook === "function"
			? hook
			: (hook as { handler: (input: string) => Promise<string | undefined> })
					.handler;
	const result = await (handler as (input: string) => Promise<unknown>).call(
		undefined,
		html,
	);
	return typeof result === "string" ? result : html;
};

describe("prerender plugin: sentinel-attribute scan", () => {
	test("page without any registered tag is returned unchanged (fast path)", async () => {
		const plugin = buildPlugin();
		const input = `<html><body><nav-bar></nav-bar><p>plain</p></body></html>`;
		const output = await runTransform(plugin, input);
		expect(output).toBe(input);
	});

	test("registered tag without the sentinel attribute is left alone", async () => {
		const plugin = buildPlugin();
		const input = `<html><body><${TAGS.unmarked}></${TAGS.unmarked}></body></html>`;
		const output = await runTransform(plugin, input);
		expect(output).not.toContain("shadowrootmode");
		expect(output).not.toContain("unmarked-rendered");
		expect(output).toContain(`<${TAGS.unmarked}></${TAGS.unmarked}>`);
	});

	test("element with sentinel gets its first yield serialized inline", async () => {
		const plugin = buildPlugin();
		const input = `<html><body><${TAGS.simple} ssr></${TAGS.simple}></body></html>`;
		const output = await runTransform(plugin, input);

		expect(output).toContain("shadowrootmode");
		expect(output).toContain("simple-first");
		expect(output).not.toContain("simple-second");
	});

	test("host attributes survive into the rendered output", async () => {
		const plugin = buildPlugin();
		const input = `<html><body><${TAGS.withAttrs} ssr data-label="hello"></${TAGS.withAttrs}></body></html>`;
		const output = await runTransform(plugin, input);

		//`hello` is split from `label=` by content-binding marker comments, so we check the value rather than the raw `label=hello` slice
		expect(output).toContain("hello");
		expect(output).toContain(`data-label="hello"`);
		//shadowrootmode proves the prerender happened, not just attribute pass-through
		expect(output).toContain("shadowrootmode");
	});

	test("async work before the first yield resolves and lands in the output", async () => {
		const plugin = buildPlugin();
		const input = `<html><body><${TAGS.asyncPreYield} ssr></${TAGS.asyncPreYield}></body></html>`;
		const output = await runTransform(plugin, input);

		expect(output).toContain("resolved-value");
	});

	test("attribute names that contain the sentinel as a substring do not trigger SSR", async () => {
		//`data-ssr`, `nossr`, `ssrcheck` must NOT match — only a standalone `ssr`
		const plugin = buildPlugin();
		const input = `<html><body>
			<${TAGS.falsePositive} data-ssr></${TAGS.falsePositive}>
			<${TAGS.falsePositive} nossr></${TAGS.falsePositive}>
			<${TAGS.falsePositive} ssrcheck></${TAGS.falsePositive}>
		</body></html>`;
		const output = await runTransform(plugin, input);

		expect(output).not.toContain("should-not-render");
		expect(output).not.toContain("shadowrootmode");
	});

	test("multiple opted-in instances of the same tag each get rendered with their own attributes", async () => {
		const plugin = buildPlugin();
		const input = `<html><body>
			<${TAGS.multiInstance} ssr data-id="alpha"></${TAGS.multiInstance}>
			<${TAGS.multiInstance} ssr data-id="beta"></${TAGS.multiInstance}>
		</body></html>`;
		const output = await runTransform(plugin, input);

		expect(output).toContain(">alpha<");
		expect(output).toContain(">beta<");
		const shadowMatches = output.match(/shadowrootmode/g) ?? [];
		expect(shadowMatches.length).toBe(2);
	});

	test("opted-in and opted-out instances on the same page render independently", async () => {
		const plugin = buildPlugin();
		const input = `<html><body>
			<${TAGS.multiInstance} ssr data-id="server"></${TAGS.multiInstance}>
			<${TAGS.multiInstance} data-id="client"></${TAGS.multiInstance}>
		</body></html>`;
		const output = await runTransform(plugin, input);

		expect(output).toContain(">server<");
		//the client-only instance survives but its content is not inlined
		expect(output).not.toContain(">client<");
		expect(output).toContain(`data-id="client"`);
		const shadowMatches = output.match(/shadowrootmode/g) ?? [];
		expect(shadowMatches.length).toBe(1);
	});

	test("custom sentinel attribute name is honoured", async () => {
		const plugin = buildPlugin("prerender");
		const input = `<html><body>
			<${TAGS.customSentinel} prerender></${TAGS.customSentinel}>
			<${TAGS.customSentinel} ssr></${TAGS.customSentinel}>
		</body></html>`;
		const output = await runTransform(plugin, input);

		//`prerender` renders; `ssr` does not (plugin was built with a different sentinel)
		const shadowMatches = output.match(/shadowrootmode/g) ?? [];
		expect(shadowMatches.length).toBe(1);
		expect(output).toContain("custom-rendered");
	});

	test("sentinel attribute survives serialization onto the host", async () => {
		//the sentinel doubles as the hydrate-side signal — client code branches on host.hasAttribute("ssr")
		const plugin = buildPlugin();
		const input = `<html><body><${TAGS.noSentinel} ssr></${TAGS.noSentinel}></body></html>`;
		const output = await runTransform(plugin, input);

		expect(output).toContain("ssr");
		expect(output).toContain("no-sentinel-rendered");
	});
});
