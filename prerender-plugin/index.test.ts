import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, test, vi } from "vitest";
import { TAGS } from "./__fixtures__/tags";
import { prerenderWebcomponents } from "./index";
import { closeModuleLoaderServers } from "./ssr-render";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixtureModulePattern = "prerender-plugin/__fixtures__/components.ts";

//the fixture components are files on disk: the plugin discovers them by glob and loads them
//through vite, exactly as it does in a real project
const buildPlugin = (
	overrides: {
		sentinel?: string;
		firstYieldTimeoutMs?: number;
		root?: string;
		configFile?: string;
		componentLoader?: "project-config" | "isolated";
		include?: Array<string>;
		exclude?: Array<string>;
	} = {},
) => {
	const plugin = prerenderWebcomponents({
		include:
			"include" in overrides ? overrides.include : [fixtureModulePattern],
		exclude: overrides.exclude,
		componentLoader: overrides.componentLoader,
		sentinelAttribute: overrides.sentinel,
		firstYieldTimeoutMs: overrides.firstYieldTimeoutMs,
	});
	(plugin.configResolved as (config: unknown) => void).call(undefined, {
		root: overrides.root ?? repoRoot,
		configFile: overrides.configFile,
		resolve: {},
	});
	return plugin;
};

afterAll(async () => {
	await closeModuleLoaderServers();
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
		const plugin = buildPlugin({ sentinel: "prerender" });
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

	test("a component using web APIs beyond the core DOM subset still renders", async () => {
		const plugin = buildPlugin();
		const input = `<html><body><${TAGS.wideWebApi} ssr></${TAGS.wideWebApi}></body></html>`;
		const output = await runTransform(plugin, input);

		expect(output).toContain("shadowrootmode");
		expect(output).toContain("display=");
	});

	test("attribute values may be single-quoted or contain `>`", async () => {
		const plugin = buildPlugin();
		const input = `<html><body><${TAGS.quotedAttrs} ssr data-expr="a > b" data-note='hi there'></${TAGS.quotedAttrs}></body></html>`;
		const output = await runTransform(plugin, input);

		expect(output).toContain("shadowrootmode");
		expect(output).toContain("a &gt; b");
		expect(output).toContain("hi there");
	});

	test("a closed-root component is skipped fast (not prerendered) with a closed-specific warning", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		//large timeout: the test only stays fast if closed detection short-circuits instead of polling to the deadline
		const plugin = buildPlugin({ firstYieldTimeoutMs: 4000 });
		const input = `<html><body><${TAGS.closedRoot} ssr></${TAGS.closedRoot}></body></html>`;
		const output = await runTransform(plugin, input);

		expect(output).not.toContain("shadowrootmode");
		expect(output).not.toContain("closed-rendered");
		expect(output).toContain(`<${TAGS.closedRoot} ssr></${TAGS.closedRoot}>`);
		expect(warn).toHaveBeenCalledWith(
			expect.stringContaining("closed shadow root"),
		);
		warn.mockRestore();
	});

	test("a component that never reaches its first yield is left for client render, with a warning", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const plugin = buildPlugin({ firstYieldTimeoutMs: 60 });
		const input = `<html><body><${TAGS.neverYields} ssr></${TAGS.neverYields}></body></html>`;
		const output = await runTransform(plugin, input);

		expect(output).not.toContain("shadowrootmode");
		expect(output).toContain(`<${TAGS.neverYields} ssr></${TAGS.neverYields}>`);
		expect(warn).toHaveBeenCalledWith(
			expect.stringContaining(`<${TAGS.neverYields}>`),
		);
		warn.mockRestore();
	});
});

describe("prerender plugin: component discovery", () => {
	test("with no include, every source file under the root is scanned", async () => {
		const plugin = buildPlugin({
			root: resolve(repoRoot, "prerender-plugin/__fixtures__/default-scan"),
			include: undefined,
		});
		const input = `<html><body><ssr-default-scan ssr></ssr-default-scan></body></html>`;
		const output = await runTransform(plugin, input);

		expect(output).toContain("shadowrootmode");
		expect(output).toContain("default-scan-rendered");
	});

	test("an excluded module is not loaded, so its component stays client-rendered", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const plugin = buildPlugin({
			include: [
				fixtureModulePattern,
				"prerender-plugin/__fixtures__/excluded-component.ts",
			],
			exclude: ["**/excluded-component.ts"],
		});
		const input = `<html><body><${TAGS.excluded} ssr></${TAGS.excluded}></body></html>`;
		const output = await runTransform(plugin, input);

		expect(output).toBe(input);
		expect(warn).toHaveBeenCalledWith(
			expect.stringContaining(`<${TAGS.excluded}>`),
		);
		warn.mockRestore();
	});

	test("a marked tag that no scanned module defines warns and is left for the client", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const plugin = buildPlugin();
		const input = `<html><body><${TAGS.undefinedTag} ssr></${TAGS.undefinedTag}></body></html>`;
		const output = await runTransform(plugin, input);

		expect(output).toBe(input);
		expect(warn).toHaveBeenCalledWith(
			expect.stringContaining(`no scanned module defines`),
		);
		warn.mockRestore();
	});

	test("a page with no marked element loads nothing", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		//the include names a module that throws on import — silence proves the scan short-circuited first
		const plugin = buildPlugin({
			include: [
				fixtureModulePattern,
				"prerender-plugin/__fixtures__/broken/throws-on-load.ts",
			],
		});
		const input = `<html><body><${TAGS.simple}></${TAGS.simple}></body></html>`;
		const output = await runTransform(plugin, input);

		expect(output).toBe(input);
		expect(warn).not.toHaveBeenCalled();
		warn.mockRestore();
	});

	test("the project config is re-run for the loader, so its plugins transform component modules", async () => {
		const projectRoot = resolve(
			repoRoot,
			"prerender-plugin/__fixtures__/project-config",
		);
		const plugin = buildPlugin({
			root: projectRoot,
			configFile: resolve(projectRoot, "vite.config.ts"),
			include: ["greeting-component.ts"],
		});
		const input = `<html><body><ssr-greeting ssr></ssr-greeting></body></html>`;
		const output = await runTransform(plugin, input);

		//the import only resolves through the fixture config's own plugin
		expect(output).toContain("greetings from a project plugin");
		expect(output).toContain("shadowrootmode");
	});

	test("componentLoader `isolated` skips the project config, so its plugins do not apply", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const projectRoot = resolve(
			repoRoot,
			"prerender-plugin/__fixtures__/project-config",
		);
		const plugin = buildPlugin({
			root: projectRoot,
			configFile: resolve(projectRoot, "vite.config.ts"),
			componentLoader: "isolated",
			include: ["isolated-probe-component.ts"],
		});
		const input = `<html><body><ssr-isolated-probe ssr></ssr-isolated-probe></body></html>`;
		const output = await runTransform(plugin, input);

		expect(output).toBe(input);
		expect(warn).toHaveBeenCalledWith(
			expect.stringContaining("isolated-probe-component.ts"),
			expect.anything(),
		);
		warn.mockRestore();
	});

	test("a module that throws on import warns, and the other components still render", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const plugin = buildPlugin({
			include: [
				fixtureModulePattern,
				"prerender-plugin/__fixtures__/broken/throws-on-load.ts",
			],
		});
		const input = `<html><body><${TAGS.simple} ssr></${TAGS.simple}></body></html>`;
		const output = await runTransform(plugin, input);

		expect(output).toContain("simple-first");
		expect(warn).toHaveBeenCalledWith(
			expect.stringContaining("throws-on-load.ts"),
			expect.anything(),
		);
		warn.mockRestore();
	});
});

describe("prerender plugin: light-DOM children", () => {
	test("light-DOM children survive alongside the declarative shadow root", async () => {
		const plugin = buildPlugin();
		const input = `<html><body><${TAGS.slotted} ssr><h1>slotted heading</h1><p>slotted body</p></${TAGS.slotted}></body></html>`;
		const output = await runTransform(plugin, input);

		expect(output).toContain("shadowrootmode");
		expect(output).toContain(`class="wrap"`);
		expect(output).toContain("<slot></slot>");
		expect(output).toContain("<h1>slotted heading</h1>");
		expect(output).toContain("<p>slotted body</p>");
		//children stay in the light DOM, outside the template that carries the shadow root
		expect(output.indexOf("</template>")).toBeLessThan(
			output.indexOf("slotted heading"),
		);
	});

	test("children are attached before the component mounts", async () => {
		const plugin = buildPlugin();
		const input = `<html><body><${TAGS.slotCounting} ssr><span>a</span><span>b</span></${TAGS.slotCounting}></body></html>`;
		const output = await runTransform(plugin, input);

		expect(output).toContain(">2<");
	});

	test("a registered component in the light DOM is prerendered with its parent", async () => {
		const plugin = buildPlugin();
		const input = `<html><body><${TAGS.slotted} ssr><${TAGS.nestedChild}></${TAGS.nestedChild}></${TAGS.slotted}></body></html>`;
		const output = await runTransform(plugin, input);

		expect(output).toContain("nested-rendered");
		const shadowMatches = output.match(/shadowrootmode/g) ?? [];
		expect(shadowMatches.length).toBe(2);
	});

	test("an element with children but no sentinel is left alone", async () => {
		const plugin = buildPlugin();
		const input = `<html><body><${TAGS.unmarked}><p>kept</p></${TAGS.unmarked}></body></html>`;
		const output = await runTransform(plugin, input);

		expect(output).toBe(input);
	});

	test("nesting the same tag inside itself matches the outer close tag", async () => {
		const plugin = buildPlugin();
		const input = `<html><body><${TAGS.selfNesting} ssr data-depth="outer"><${TAGS.selfNesting} data-depth="inner"></${TAGS.selfNesting}></${TAGS.selfNesting}><p>after</p></body></html>`;
		const output = await runTransform(plugin, input);

		expect(output).toContain(">outer<");
		expect(output).toContain(">inner<");
		//the outer close tag ends the match — trailing markup is neither swallowed nor duplicated
		expect(output.match(/<p>after<\/p>/g)?.length).toBe(1);
	});

	test("markup inside an HTML comment is not prerendered", async () => {
		const plugin = buildPlugin();
		const input = `<html><body><!-- <${TAGS.commented} ssr></${TAGS.commented}> --></body></html>`;
		const output = await runTransform(plugin, input);

		expect(output).toBe(input);
	});

	test("a close tag inside a script does not end the element early", async () => {
		const plugin = buildPlugin();
		const input = `<html><body><${TAGS.slotted} ssr><script type="text/template">\`</${TAGS.slotted}>\`</script><p>real child</p></${TAGS.slotted}></body></html>`;
		const output = await runTransform(plugin, input);

		expect(output).toContain("shadowrootmode");
		expect(output).toContain("<p>real child</p>");
	});
});

describe("prerender plugin: load payload injection", () => {
	test("load call on the server emits a per-host data-ssr script inside the declarative shadow root", async () => {
		const plugin = buildPlugin();
		const input = `<html><body><${TAGS.loadSingle} ssr></${TAGS.loadSingle}></body></html>`;
		const output = await runTransform(plugin, input);

		//declarative shadow root carries the payload — no global window.__ssrData any more
		expect(output).not.toContain("__ssrData");
		expect(output).toContain("shadowrootmode");
		expect(output).toContain(
			`<script type="application/json" data-ssr="">{"name":"Ada"}</script>`,
		);
		//the resolved value also lands in the SSR'd markup itself
		expect(output).toContain("Ada");
	});

	test("two hosts get independent per-host payloads — no cross-host dedupe", async () => {
		const plugin = buildPlugin();
		const input = `<html><body>
			<${TAGS.loadShared} ssr data-id="alpha"></${TAGS.loadShared}>
			<${TAGS.loadShared} ssr data-id="beta"></${TAGS.loadShared}>
		</body></html>`;
		const output = await runTransform(plugin, input);

		//each host has its own data-ssr script, with its own serialized value
		expect(output).toContain(`>"payload-alpha"</script>`);
		expect(output).toContain(`>"payload-beta"</script>`);
		const scriptMatches = output.match(/data-ssr=""/g) ?? [];
		expect(scriptMatches.length).toBe(2);
	});

	test("a page with no load calls gets no data-ssr scripts", async () => {
		const plugin = buildPlugin();
		const input = `<html><body><${TAGS.simple} ssr></${TAGS.simple}></body></html>`;
		const output = await runTransform(plugin, input);

		expect(output).not.toContain("data-ssr");
		expect(output).not.toContain("__ssrData");
	});
});
