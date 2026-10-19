import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer, normalizePath, type Plugin } from "vite";
import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import { TAGS } from "./__fixtures__/tags";
import { prerenderWebcomponents, type PrerenderOptions } from "./index";
import {
	closeModuleLoaderServers,
	closeServerRealm,
	markServerRealmStale,
} from "./ssr-render";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixturesDirectory = resolve(repoRoot, "prerender-plugin/__fixtures__");
const fixturePage = resolve(fixturesDirectory, "index.html");
const pageScript = `<script type="module" src="/prerender-plugin/__fixtures__/page-script.ts"></script>`;
const brokenPageScript = `<script type="module" src="/prerender-plugin/__fixtures__/broken-page-script.ts"></script>`;

const pageWith = (body: string, head = pageScript) =>
	`<html><head>${head}</head><body>${body}</body></html>`;

//the plugin's hooks run on their own, the way vite calls them for one page of a build; the
//fixture components are files on disk, loaded through vite exactly as in a real project
const buildPlugins = (
	options: PrerenderOptions = {},
	project: { root?: string; configFile?: string } = {},
): Array<Plugin> => {
	const plugins = prerenderWebcomponents(options);
	for (const plugin of plugins) {
		const configResolved = plugin.configResolved as
			((config: unknown) => void) | undefined;
		configResolved?.call(undefined, {
			root: project.root ?? repoRoot,
			configFile: project.configFile,
			resolve: {},
		});
	}
	return plugins;
};

//every transformIndexHtml hook in plugin order, in both shapes vite accepts: function or `{ handler }`
const runTransform = async (
	plugins: Array<Plugin>,
	html: string,
	page = fixturePage,
): Promise<string> => {
	let output = html;
	for (const plugin of plugins) {
		const hook = plugin.transformIndexHtml;
		if (hook === undefined) continue;
		const handler = (typeof hook === "function" ? hook : hook.handler) as (
			html: string,
			context: { filename: string },
		) => Promise<unknown> | unknown;
		const result = await handler.call(undefined, output, { filename: page });
		if (typeof result === "string") output = result;
	}
	return output;
};

const countOf = (text: string, pattern: RegExp) =>
	(text.match(pattern) ?? []).length;

//a fresh realm per test: nothing defined, nothing warned about yet
beforeEach(() => {
	markServerRealmStale();
});

afterAll(async () => {
	await closeServerRealm();
	await closeModuleLoaderServers();
});

describe("prerender plugin: pages", () => {
	test("every page prerenders when no include is given", async () => {
		const output = await runTransform(
			buildPlugins(),
			pageWith(`<${TAGS.simple}></${TAGS.simple}>`),
		);

		expect(output).toContain("shadowrootmode");
		expect(output).toContain("simple-first");
		expect(output).not.toContain("simple-second");
	});

	test("an excluded page is left alone", async () => {
		const input = pageWith(`<${TAGS.simple}></${TAGS.simple}>`);
		const output = await runTransform(
			buildPlugins({ exclude: ["prerender-plugin/__fixtures__/dashboard/**"] }),
			input,
			resolve(fixturesDirectory, "dashboard/index.html"),
		);

		expect(output).toBe(input);
	});

	test("include limits prerendering to the pages it matches", async () => {
		const plugins = buildPlugins({
			include: ["prerender-plugin/__fixtures__/blog/**"],
		});
		const input = pageWith(`<${TAGS.simple}></${TAGS.simple}>`);

		expect(await runTransform(plugins, input)).toBe(input);
		expect(
			await runTransform(
				plugins,
				input,
				resolve(fixturesDirectory, "blog/index.html"),
			),
		).toContain("simple-first");
	});

	test("an empty include prerenders no page, and ssr still opts an element in", async () => {
		const output = await runTransform(
			buildPlugins({ include: [] }),
			pageWith(
				`<${TAGS.multiInstance} data-id="client"></${TAGS.multiInstance}><${TAGS.multiInstance} ssr data-id="server"></${TAGS.multiInstance}>`,
			),
		);

		expect(output).toContain(">server<");
		expect(output).not.toContain(">client<");
		expect(countOf(output, /shadowrootmode/g)).toBe(1);
	});

	test("an excluded page without ssr loads nothing", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		//the page script imports a module that throws on load: silence proves nothing was loaded
		const input = pageWith(
			`<${TAGS.simple}></${TAGS.simple}>`,
			brokenPageScript,
		);
		const output = await runTransform(buildPlugins({ include: [] }), input);

		expect(output).toBe(input);
		expect(warn).not.toHaveBeenCalled();
		warn.mockRestore();
	});

	test("a page without custom elements loads nothing", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const input = pageWith(`<p>plain</p>`, brokenPageScript);
		const output = await runTransform(buildPlugins(), input);

		expect(output).toBe(input);
		expect(warn).not.toHaveBeenCalled();
		warn.mockRestore();
	});
});

describe("prerender plugin: the ssr attribute", () => {
	test(`ssr="false" leaves an element for the client on a prerendered page`, async () => {
		const output = await runTransform(
			buildPlugins(),
			pageWith(
				`<${TAGS.optedOut} ssr="false"></${TAGS.optedOut}><${TAGS.simple}></${TAGS.simple}>`,
			),
		);

		expect(output).toContain(
			`<${TAGS.optedOut} ssr="false"></${TAGS.optedOut}>`,
		);
		expect(output).not.toContain("opted-out-rendered");
		expect(output).toContain("simple-first");
	});

	test(`ssr="false" on the body leaves the page for the client, and ssr inside opts back in`, async () => {
		const output = await runTransform(
			buildPlugins(),
			`<html><head>${pageScript}</head><body ssr="false"><${TAGS.multiInstance} data-id="client"></${TAGS.multiInstance}><${TAGS.multiInstance} ssr data-id="server"></${TAGS.multiInstance}></body></html>`,
		);

		expect(output).toContain(">server<");
		expect(output).not.toContain(">client<");
	});

	test(`ssr on the html element prerenders a page no include matches`, async () => {
		const output = await runTransform(
			buildPlugins({ include: [] }),
			`<html ssr><head>${pageScript}</head><body><${TAGS.simple}></${TAGS.simple}></body></html>`,
		);

		expect(output).toContain("simple-first");
	});

	test("an element inherits from the custom element around it, and its own ssr wins", async () => {
		const output = await runTransform(
			buildPlugins(),
			pageWith(
				`<${TAGS.slotted} ssr="false"><${TAGS.multiInstance} data-id="inherits"></${TAGS.multiInstance}><${TAGS.multiInstance} ssr data-id="own"></${TAGS.multiInstance}></${TAGS.slotted}>`,
			),
		);

		expect(output).not.toContain(`class="wrap"`);
		expect(output).not.toContain(">inherits<");
		expect(output).toContain(">own<");
		expect(countOf(output, /shadowrootmode/g)).toBe(1);
	});

	test(`ssr="true" opts in like ssr`, async () => {
		const output = await runTransform(
			buildPlugins({ include: [] }),
			pageWith(`<${TAGS.simple} ssr="true"></${TAGS.simple}>`),
		);

		expect(output).toContain("simple-first");
	});

	test("a value the plugin does not read fails with the two that work", async () => {
		await expect(
			runTransform(
				buildPlugins(),
				pageWith(`<${TAGS.simple} ssr="no"></${TAGS.simple}>`),
			),
		).rejects.toThrow(/ssr="no" on <ssr-simple>.*ssr="false"/);
	});

	test("attributes that only contain ssr in their name or value are not the attribute", async () => {
		const input = pageWith(`
			<${TAGS.falsePositive} data-ssr></${TAGS.falsePositive}>
			<${TAGS.falsePositive} nossr></${TAGS.falsePositive}>
			<${TAGS.falsePositive} ssrcheck></${TAGS.falsePositive}>
			<${TAGS.falsePositive} title="no ssr here"></${TAGS.falsePositive}>
		`);
		const output = await runTransform(buildPlugins({ include: [] }), input);

		expect(output).toBe(input);
	});
});

describe("prerender plugin: page scripts", () => {
	test("a tag no module of the page defines warns once and is left for the client", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		//the inline-imported fixture exists, but only an inline script imports it
		const input = pageWith(
			`<${TAGS.inlineImported}></${TAGS.inlineImported}><${TAGS.inlineImported}></${TAGS.inlineImported}>`,
		);
		const output = await runTransform(buildPlugins(), input);

		expect(output).toBe(input);
		expect(warn).toHaveBeenCalledTimes(1);
		expect(warn).toHaveBeenCalledWith(
			expect.stringContaining(
				`no module the page imports defines <${TAGS.inlineImported}>`,
			),
		);
		warn.mockRestore();
	});

	test("what an inline module script imports is loaded", async () => {
		const output = await runTransform(
			buildPlugins(),
			pageWith(
				`<${TAGS.inlineImported}></${TAGS.inlineImported}>`,
				`<script type="module">import "./inline-imported-component";</script>`,
			),
		);

		expect(output).toContain("inline-imported-rendered");
	});

	test("a script src is resolved against the page", async () => {
		const output = await runTransform(
			buildPlugins(),
			pageWith(
				`<${TAGS.simple}></${TAGS.simple}>`,
				`<script type="module" src="./page-script.ts"></script>`,
			),
		);

		expect(output).toContain("simple-first");
	});

	test("the page script's own body never runs on the server", async () => {
		const output = await runTransform(
			buildPlugins(),
			pageWith(`<${TAGS.simple}></${TAGS.simple}>`),
		);

		expect(output).toContain("simple-first");
		expect(
			(globalThis as { pageScriptBodyRan?: boolean }).pageScriptBodyRan,
		).toBeUndefined();
	});

	test("a module that throws on import warns, and the other components still render", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const output = await runTransform(
			buildPlugins(),
			pageWith(`<${TAGS.simple}></${TAGS.simple}>`, brokenPageScript),
		);

		expect(output).toContain("simple-first");
		expect(warn).toHaveBeenCalledWith(
			expect.stringContaining("throws-on-load.ts"),
			expect.anything(),
		);
		warn.mockRestore();
	});

	test("classic, external and commented-out scripts are not page modules", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		//each of these would import the module that throws on load, or ask vite for a url it cannot serve
		const output = await runTransform(
			buildPlugins(),
			pageWith(
				`<${TAGS.simple}></${TAGS.simple}>`,
				`${pageScript}<script src="/prerender-plugin/__fixtures__/broken-page-script.ts"></script><script type="module" src="https://cdn.example/elements.js"></script><!-- ${brokenPageScript} -->`,
			),
		);

		expect(output).toContain("simple-first");
		expect(warn).not.toHaveBeenCalled();
		warn.mockRestore();
	});

	test("a tag one page leaves undefined is prerendered on a page that imports it", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const plugins = buildPlugins();
		const body = `<${TAGS.inlineImported}></${TAGS.inlineImported}>`;

		await runTransform(plugins, pageWith(body));
		const output = await runTransform(
			plugins,
			pageWith(
				body,
				`<script type="module">import "./inline-imported-component";</script>`,
			),
		);

		expect(output).toContain("inline-imported-rendered");
		warn.mockRestore();
	});

	test("a component from a package is still defined after the realm is replaced", async () => {
		const projectRoot = await mkdtemp(join(tmpdir(), "prerender-package-"));
		const packageDirectory = join(projectRoot, "node_modules/fixture-elements");
		await mkdir(packageDirectory, { recursive: true });
		await writeFile(
			join(packageDirectory, "package.json"),
			`{ "name": "fixture-elements", "type": "module", "exports": "./index.js" }`,
		);
		//extends the HTMLElement of the realm it is evaluated in, like every packaged component
		await writeFile(
			join(packageDirectory, "index.js"),
			`customElements.define("package-card", class extends HTMLElement {\n\tconstructor() { super(); this.attachShadow({ mode: "open", serializable: true }); }\n\tconnectedCallback() { this.shadowRoot.innerHTML = "<i>package-card</i>"; }\n});\n`,
		);
		//one module away from the page, the way a project's own code imports a component library:
		//vite always runs what the page script imports directly, and hands deeper imports to node
		await writeFile(
			join(projectRoot, "card.ts"),
			`import "fixture-elements";\n`,
		);
		await writeFile(join(projectRoot, "page.ts"), `import "./card";\n`);
		const plugins = buildPlugins({}, { root: projectRoot });
		const page = pageWith(
			`<package-card></package-card>`,
			`<script type="module" src="./page.ts"></script>`,
		);
		const pageFilename = join(projectRoot, "index.html");

		try {
			expect(await runTransform(plugins, page, pageFilename)).toContain(
				"<i>package-card</i>",
			);
			markServerRealmStale();
			expect(await runTransform(plugins, page, pageFilename)).toContain(
				"<i>package-card</i>",
			);
		} finally {
			await rm(projectRoot, { recursive: true, force: true });
		}
	});

	test("the project config is re-run for the loader, so its plugins transform component modules", async () => {
		const projectRoot = resolve(fixturesDirectory, "project-config");
		const output = await runTransform(
			buildPlugins(
				{},
				{
					root: projectRoot,
					configFile: resolve(projectRoot, "vite.config.ts"),
				},
			),
			pageWith(
				`<ssr-greeting></ssr-greeting>`,
				`<script type="module" src="./page-script.ts"></script>`,
			),
			resolve(projectRoot, "index.html"),
		);

		//the import only resolves through the fixture config's own plugin
		expect(output).toContain("greetings from a project plugin");
		expect(output).toContain("shadowrootmode");
	});

	test("componentLoader `isolated` skips the project config, so its plugins do not apply", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const projectRoot = resolve(fixturesDirectory, "project-config");
		const input = pageWith(
			`<ssr-isolated-probe></ssr-isolated-probe>`,
			`<script type="module" src="./isolated-page-script.ts"></script>`,
		);
		const output = await runTransform(
			buildPlugins(
				{ componentLoader: "isolated" },
				{
					root: projectRoot,
					configFile: resolve(projectRoot, "vite.config.ts"),
				},
			),
			input,
			resolve(projectRoot, "index.html"),
		);

		expect(output).toBe(input);
		expect(warn).toHaveBeenCalledWith(
			expect.stringContaining("isolated-probe-component.ts"),
			expect.anything(),
		);
		warn.mockRestore();
	});
});

describe("prerender plugin: what a component paints", () => {
	test("host attributes survive into the output", async () => {
		const output = await runTransform(
			buildPlugins(),
			pageWith(`<${TAGS.withAttrs} data-label="hello"></${TAGS.withAttrs}>`),
		);

		//`hello` is split from `label=` by content-binding marker comments, so we check the value rather than the raw `label=hello` slice
		expect(output).toContain("hello");
		expect(output).toContain(`data-label="hello"`);
		expect(output).toContain("shadowrootmode");
	});

	test("async work before the first paint resolves and lands in the output", async () => {
		const output = await runTransform(
			buildPlugins(),
			pageWith(`<${TAGS.asyncPreYield}></${TAGS.asyncPreYield}>`),
		);

		expect(output).toContain("resolved-value");
	});

	test("instances of the same tag each paint with their own attributes", async () => {
		const output = await runTransform(
			buildPlugins(),
			pageWith(`
				<${TAGS.multiInstance} data-id="alpha"></${TAGS.multiInstance}>
				<${TAGS.multiInstance} data-id="beta"></${TAGS.multiInstance}>
			`),
		);

		expect(output).toContain(">alpha<");
		expect(output).toContain(">beta<");
		expect(countOf(output, /shadowrootmode/g)).toBe(2);
	});

	test("a component using web APIs beyond the core DOM subset still renders", async () => {
		const output = await runTransform(
			buildPlugins(),
			pageWith(`<${TAGS.wideWebApi}></${TAGS.wideWebApi}>`),
		);

		expect(output).toContain("shadowrootmode");
		expect(output).toContain("display=");
	});

	test("attribute values may be single-quoted or contain `>`", async () => {
		const output = await runTransform(
			buildPlugins(),
			pageWith(
				`<${TAGS.quotedAttrs} data-expr="a > b" data-note='hi there'></${TAGS.quotedAttrs}>`,
			),
		);

		expect(output).toContain("shadowrootmode");
		expect(output).toContain("a &gt; b");
		expect(output).toContain("hi there");
	});

	test("a component in another component's template paints into the shadow root that ships", async () => {
		const output = await runTransform(
			buildPlugins(),
			pageWith(`<${TAGS.paintsNestedChild}></${TAGS.paintsNestedChild}>`),
		);

		expect(output).toContain(
			`<${TAGS.nestedChild}><template shadowrootmode="open" shadowrootdelegatesfocus="" shadowrootserializable="" shadowrootclonable=""><em>nested-rendered</em></template>`,
		);
	});

	test("a shadow root ships with the delegatesFocus and clonable its component asked for", async () => {
		const output = await runTransform(
			buildPlugins(),
			pageWith(
				`<${TAGS.slotted}><${TAGS.rootWithoutFocusOrCloning}></${TAGS.rootWithoutFocusOrCloning}></${TAGS.slotted}>`,
			),
		);

		expect(output).toContain(
			`<${TAGS.slotted}><template shadowrootmode="open" shadowrootdelegatesfocus="" shadowrootserializable="" shadowrootclonable="">`,
		);
		expect(output).toContain(
			`<${TAGS.rootWithoutFocusOrCloning}><template shadowrootmode="open" shadowrootserializable="">`,
		);
	});
});

describe("prerender plugin: what is left for the client", () => {
	test("a closed-root component is skipped fast with a closed-specific warning", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		//large timeout: the test only stays fast if the closed root is seen before any waiting
		const input = pageWith(`<${TAGS.closedRoot}></${TAGS.closedRoot}>`);
		const output = await runTransform(
			buildPlugins({ firstYieldTimeoutMs: 4000 }),
			input,
		);

		expect(output).toBe(input);
		expect(warn).toHaveBeenCalledWith(
			expect.stringContaining("closed shadow root"),
		);
		warn.mockRestore();
	});

	test("a root that is not serializable leaves the source markup untouched, quietly when inherited", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const input = pageWith(
			`<${TAGS.nonSerializableRoot}></${TAGS.nonSerializableRoot}>`,
		);
		const output = await runTransform(buildPlugins(), input);

		expect(output).toBe(input);
		expect(warn).not.toHaveBeenCalled();
		warn.mockRestore();
	});

	test("a root that is not serializable warns when the element asks for ssr itself", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const input = pageWith(
			`<${TAGS.nonSerializableRoot} ssr></${TAGS.nonSerializableRoot}>`,
		);
		const output = await runTransform(buildPlugins(), input);

		expect(output).toBe(input);
		expect(warn).toHaveBeenCalledWith(
			expect.stringContaining("no serializable shadow root"),
		);
		warn.mockRestore();
	});

	test("a custom element without a shadow root is left alone without connecting it", async () => {
		const input = pageWith(
			`<${TAGS.withoutShadowRoot}></${TAGS.withoutShadowRoot}>`,
		);
		const output = await runTransform(
			buildPlugins({ firstYieldTimeoutMs: 4000 }),
			input,
		);

		expect(output).toBe(input);
		expect(
			(globalThis as { withoutShadowRootConnected?: boolean })
				.withoutShadowRootConnected,
		).toBeUndefined();
	});

	test("an element without a close tag is left alone", async () => {
		const input = pageWith(`<${TAGS.simple}><p>never closed</p>`);
		const output = await runTransform(buildPlugins(), input);

		expect(output).toBe(input);
	});

	test("a component that never reaches its first paint is left for the client, with a warning", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const input = pageWith(`<${TAGS.neverYields}></${TAGS.neverYields}>`);
		const output = await runTransform(
			buildPlugins({ firstYieldTimeoutMs: 60 }),
			input,
		);

		expect(output).toBe(input);
		expect(warn).toHaveBeenCalledWith(
			expect.stringContaining(
				`<${TAGS.neverYields}> was still waiting after 60ms`,
			),
		);
		warn.mockRestore();
	});

	test("an element that paints later without announcing a pending-task is left for the client, with no wait claimed", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const input = pageWith(
			`<${TAGS.foreignLatePainter}></${TAGS.foreignLatePainter}>`,
		);
		const output = await runTransform(buildPlugins(), input);

		expect(output).toBe(input);
		expect(warn).toHaveBeenCalledWith(
			expect.stringContaining(
				`<${TAGS.foreignLatePainter}> painted nothing and had no open pending-task to wait for`,
			),
		);
		warn.mockRestore();
	});
});

describe("prerender plugin: a component that throws on the server", () => {
	const thrower = `<${TAGS.throwsBeforePaint}></${TAGS.throwsBeforePaint}>`;

	test("it ships without a shadow root, with one warning and nothing from the library", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		const output = await runTransform(
			buildPlugins(),
			pageWith(`${thrower}${thrower}<${TAGS.simple}></${TAGS.simple}>`),
		);

		expect(countOf(output, new RegExp(thrower, "g"))).toBe(2);
		expect(output).not.toContain("server-thrown");
		expect(output).toContain("simple-first");
		expect(warn).toHaveBeenCalledTimes(1);
		expect(warn).toHaveBeenCalledWith(
			expect.stringContaining(
				`<${TAGS.throwsBeforePaint}> threw on the server`,
			),
			expect.objectContaining({ message: "server-thrown" }),
		);
		expect(error).not.toHaveBeenCalled();
		warn.mockRestore();
		error.mockRestore();
	});

	test("inside another component's template it is left for the client, and its sibling is not", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const output = await runTransform(
			buildPlugins(),
			pageWith(`<${TAGS.throwerParent}></${TAGS.throwerParent}>`),
		);

		expect(output).toContain(thrower);
		expect(output).toContain("nested-rendered");
		expect(countOf(output, /shadowrootmode/g)).toBe(2);
		warn.mockRestore();
	});

	test("a component in its light DOM still ships its own shadow root", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const output = await runTransform(
			buildPlugins(),
			pageWith(
				`<${TAGS.throwsBeforePaint}><${TAGS.rootWithoutFocusOrCloning}></${TAGS.rootWithoutFocusOrCloning}></${TAGS.throwsBeforePaint}>`,
			),
		);

		//the thrower's root asks for delegatesFocus and clonable and the child's for neither, so the
		//child's template cannot pass with the thrower's attributes
		expect(output).toContain(
			`<${TAGS.throwsBeforePaint}><${TAGS.rootWithoutFocusOrCloning}><template shadowrootmode="open" shadowrootserializable="">`,
		);
		expect(output).toContain("without-focus-or-cloning-rendered");
		warn.mockRestore();
	});

	test("a throw while it waits ends the wait at once, not at the timeout", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		//large timeout: the test only stays fast if the throw ends the wait
		const output = await runTransform(
			buildPlugins({ firstYieldTimeoutMs: 4000 }),
			pageWith(`<${TAGS.rejectsBeforePaint}></${TAGS.rejectsBeforePaint}>`),
		);

		expect(output).toContain(
			`<${TAGS.rejectsBeforePaint}></${TAGS.rejectsBeforePaint}>`,
		);
		expect(warn).toHaveBeenCalledTimes(1);
		expect(warn).toHaveBeenCalledWith(
			expect.stringContaining(
				`<${TAGS.rejectsBeforePaint}> threw on the server`,
			),
			expect.objectContaining({ message: "server-rejected" }),
		);
		warn.mockRestore();
	});
});

describe("prerender plugin: light-DOM children", () => {
	test("light-DOM children survive alongside the declarative shadow root", async () => {
		const output = await runTransform(
			buildPlugins(),
			pageWith(
				`<${TAGS.slotted}><h1>slotted heading</h1><p>slotted body</p></${TAGS.slotted}>`,
			),
		);

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
		const output = await runTransform(
			buildPlugins(),
			pageWith(
				`<${TAGS.slotCounting}><span>a</span><span>b</span></${TAGS.slotCounting}>`,
			),
		);

		expect(output).toContain(">2<");
	});

	test("a component in the light DOM is prerendered with its parent", async () => {
		const output = await runTransform(
			buildPlugins(),
			pageWith(
				`<${TAGS.slotted}><${TAGS.nestedChild}></${TAGS.nestedChild}></${TAGS.slotted}>`,
			),
		);

		expect(output).toContain("nested-rendered");
		expect(countOf(output, /shadowrootmode/g)).toBe(2);
	});

	test("a root that is not serializable stays out of the output inside a prerendered element", async () => {
		const output = await runTransform(
			buildPlugins(),
			pageWith(
				`<${TAGS.slotted}><${TAGS.nonSerializableRoot}></${TAGS.nonSerializableRoot}></${TAGS.slotted}>`,
			),
		);

		expect(output).toContain(`class="wrap"`);
		expect(output).not.toContain("non-serializable-rendered");
	});

	test("a component inside an element the page does not define is still prerendered", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const output = await runTransform(
			buildPlugins(),
			pageWith(
				`<${TAGS.undefinedTag}><${TAGS.nestedChild}></${TAGS.nestedChild}></${TAGS.undefinedTag}>`,
			),
		);

		expect(output).toContain(
			`<${TAGS.undefinedTag}><${TAGS.nestedChild}><template shadowrootmode`,
		);
		warn.mockRestore();
	});

	test("nesting the same tag inside itself matches the outer close tag", async () => {
		const output = await runTransform(
			buildPlugins(),
			pageWith(
				`<${TAGS.selfNesting} data-depth="outer"><${TAGS.selfNesting} data-depth="inner"></${TAGS.selfNesting}></${TAGS.selfNesting}><p>after</p>`,
			),
		);

		expect(output).toContain(">outer<");
		expect(output).toContain(">inner<");
		//the outer close tag ends the match — trailing markup is neither swallowed nor duplicated
		expect(countOf(output, /<p>after<\/p>/g)).toBe(1);
	});

	test("markup inside an HTML comment is not prerendered", async () => {
		const input = pageWith(`<!-- <${TAGS.commented}></${TAGS.commented}> -->`);
		const output = await runTransform(buildPlugins(), input);

		expect(output).toBe(input);
	});

	test("a component inside a <template> is not prerendered, a component named template-… is", async () => {
		const output = await runTransform(
			buildPlugins(),
			pageWith(
				`<${TAGS.templatePrefixed}></${TAGS.templatePrefixed}><template><${TAGS.simple}></${TAGS.simple}></template>`,
			),
		);

		expect(output).toContain(
			`<template><${TAGS.simple}></${TAGS.simple}></template>`,
		);
		expect(output).toContain("template-prefixed-rendered");
	});

	test("a close tag inside a script does not end the element early", async () => {
		const output = await runTransform(
			buildPlugins(),
			pageWith(
				`<${TAGS.slotted}><script type="text/template">\`</${TAGS.slotted}>\`</script><p>real child</p></${TAGS.slotted}>`,
			),
		);

		expect(output).toContain("shadowrootmode");
		expect(output).toContain("<p>real child</p>");
	});
});

describe("prerender plugin: components a paint creates", () => {
	test("a nested child that waits before its first paint ships painted, and so does its own", async () => {
		const output = await runTransform(
			buildPlugins(),
			pageWith(`<${TAGS.waitsForChild}></${TAGS.waitsForChild}>`),
		);

		expect(output).toContain(">waiting-child-1<");
		expect(output).toContain(">waiting-child-2<");
		expect(countOf(output, /shadowrootmode/g)).toBe(3);
	});

	test(`ssr="false" in a template leaves that child for the client, and ssr inside opts back in`, async () => {
		const output = await runTransform(
			buildPlugins(),
			pageWith(`<${TAGS.optsChildrenOut}></${TAGS.optsChildrenOut}>`),
		);

		expect(output).toContain(
			`<${TAGS.optedOut} ssr="false"></${TAGS.optedOut}>`,
		);
		expect(output).not.toContain("opted-out-rendered");
		expect(output).toContain(`<${TAGS.nestedChild}></${TAGS.nestedChild}>`);
		expect(output).toContain(">opted-back-in<");
		expect(countOf(output, /shadowrootmode/g)).toBe(2);
	});

	test(`ssr="false" on a light-DOM child of a prerendered root leaves that child for the client`, async () => {
		const output = await runTransform(
			buildPlugins(),
			pageWith(
				`<${TAGS.slotted}><${TAGS.optedOut} ssr="false"></${TAGS.optedOut}></${TAGS.slotted}>`,
			),
		);

		expect(output).toContain(`class="wrap"`);
		expect(output).toContain(
			`<${TAGS.optedOut} ssr="false"></${TAGS.optedOut}>`,
		);
		expect(output).not.toContain("opted-out-rendered");
		expect(countOf(output, /shadowrootmode/g)).toBe(1);
	});

	test("a container that stops its children's pending tasks still has them waited for", async () => {
		const output = await runTransform(
			buildPlugins(),
			pageWith(`<${TAGS.stopsPendingTasks}></${TAGS.stopsPendingTasks}>`),
		);

		expect(output).toContain(">waiting-child-2<");
	});

	test(`ssr="false" leaves the root of another library's element out too, which the server still runs`, async () => {
		const output = await runTransform(
			buildPlugins(),
			pageWith(
				`<${TAGS.slotted}><${TAGS.foreignPainter}></${TAGS.foreignPainter}><${TAGS.foreignPainter} ssr="false"></${TAGS.foreignPainter}></${TAGS.slotted}>`,
			),
		);

		expect(countOf(output, /foreign-painted/g)).toBe(1);
		expect(output).toContain(
			`<${TAGS.foreignPainter} ssr="false"></${TAGS.foreignPainter}>`,
		);
	});

	test("a nested child still waiting at the timeout is left for the client, with a warning, and the rest ships", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const output = await runTransform(
			buildPlugins({ firstYieldTimeoutMs: 60 }),
			pageWith(
				`<${TAGS.holdsNeverYieldingChild}></${TAGS.holdsNeverYieldingChild}>`,
			),
		);

		expect(output).toContain(`<${TAGS.neverYields}></${TAGS.neverYields}>`);
		expect(output).toContain("nested-rendered");
		expect(countOf(output, /shadowrootmode/g)).toBe(2);
		expect(warn).toHaveBeenCalledWith(
			expect.stringContaining(`<${TAGS.neverYields}>`),
		);
		warn.mockRestore();
	});
});

describe("prerender plugin: load payload injection", () => {
	test("load call on the server emits a per-host data-ssr script inside the declarative shadow root", async () => {
		const output = await runTransform(
			buildPlugins(),
			pageWith(`<${TAGS.loadSingle}></${TAGS.loadSingle}>`),
		);

		expect(output).toContain("shadowrootmode");
		expect(output).toContain(
			`<script type="application/json" data-ssr="">{"name":"Ada"}</script>`,
		);
		//the resolved value also lands in the SSR'd markup itself
		expect(output).toContain("Ada");
	});

	test("two hosts get independent per-host payloads — no cross-host dedupe", async () => {
		const output = await runTransform(
			buildPlugins(),
			pageWith(`
				<${TAGS.loadShared} data-id="alpha"></${TAGS.loadShared}>
				<${TAGS.loadShared} data-id="beta"></${TAGS.loadShared}>
			`),
		);

		expect(output).toContain(`>"payload-alpha"</script>`);
		expect(output).toContain(`>"payload-beta"</script>`);
		expect(countOf(output, /data-ssr=""/g)).toBe(2);
	});

	test("a page with no load calls gets no data-ssr scripts", async () => {
		const output = await runTransform(
			buildPlugins(),
			pageWith(`<${TAGS.simple}></${TAGS.simple}>`),
		);

		expect(output).not.toContain("data-ssr");
	});
});

//last: closing the dev server runs the plugin's closeBundle, which also closes the loader servers
//the tests above share
describe("prerender plugin: dev server", () => {
	test("a dev request prerenders the page, and an edit shows up on the next request", async () => {
		const projectRoot = await mkdtemp(join(tmpdir(), "prerender-dev-"));
		const libraryEntry = normalizePath(resolve(repoRoot, "lib/src/index.ts"));
		const writeCard = (text: string) =>
			writeFile(
				join(projectRoot, "dev-card.ts"),
				`import { component, html } from "${libraryEntry}";\ncustomElements.define("dev-card", component(function* () {\n\tyield html\`<p>${text}</p>\`;\n}));\n`,
			);
		await writeCard("before-edit");
		await writeFile(join(projectRoot, "page.ts"), `import "./dev-card";\n`);
		const html = `<html><head><script type="module" src="./page.ts"></script></head><body><dev-card></dev-card></body></html>`;

		const server = await createServer({
			root: projectRoot,
			configFile: false,
			logLevel: "silent",
			appType: "custom",
			server: { middlewareMode: true },
			plugins: [prerenderWebcomponents()],
		});
		try {
			expect(await server.transformIndexHtml("/index.html", html)).toContain(
				"before-edit",
			);

			await writeCard("after-edit");
			//vite reports the edit to the plugin asynchronously, after dropping the stale modules
			let output = "";
			const deadline = Date.now() + 4000;
			while (!output.includes("after-edit") && Date.now() < deadline) {
				await new Promise((resolve) => setTimeout(resolve, 50));
				output = await server.transformIndexHtml("/index.html", html);
			}
			expect(output).toContain("after-edit");
		} finally {
			await server.close();
			await rm(projectRoot, { recursive: true, force: true });
		}
	});
});
