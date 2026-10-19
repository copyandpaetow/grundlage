import { relative } from "node:path";
import { createFilter, normalizePath, type Plugin } from "vite";
import {
	findPageScripts,
	NO_PAGE_SCRIPTS,
	type PageScripts,
} from "./page-scripts";
import {
	choosePrerenderRoots,
	type CustomElementRecord,
	findCustomElements,
	mayCarryPrerenderAttribute,
} from "./scan";
import {
	closeModuleLoaderServers,
	closeServerRealm,
	isBootingLoaderServer,
	loadPageModules,
	markServerRealmStale,
	type ModuleLoaderConfig,
	PRERENDER_ENVIRONMENT_NAME,
	prerenderEnvironmentOfLoader,
	prerenderEnvironmentOptions,
	renderHost,
	runInServerRealm,
	type ServerRealm,
	TAG_SUPPORT,
	type TagSupportKind,
	tagSupportOf,
} from "./ssr-render";

export interface PrerenderOptions {
	//page globs relative to the vite root: every page when left out, no page for `[]`
	include?: string | Array<string>;
	exclude?: string | Array<string>;
	//how a build loads component modules; dev loads them through its own server
	componentLoader?: "project-config" | "isolated";
	firstYieldTimeoutMs?: number;
}

type UnprerenderableTagSupportKind = Exclude<
	TagSupportKind,
	typeof TAG_SUPPORT.PRERENDERABLE
>;

const toPatternArray = (patterns: string | Array<string> | undefined) =>
	typeof patterns === "string" ? [patterns] : patterns;

const warningFor = (
	tagName: string,
	support: UnprerenderableTagSupportKind,
): string => {
	switch (support) {
		case TAG_SUPPORT.UNDEFINED:
			return `[prerender] no module the page imports defines <${tagName}> => left for the browser. If the page script defines it, move the definition into a module the page imports: a page script's own body never runs on the server.`;
		case TAG_SUPPORT.CONSTRUCTOR_THREW:
			return `[prerender] <${tagName}> threw while being constructed => left for the browser.`;
		case TAG_SUPPORT.CLOSED_ROOT:
			return `[prerender] <${tagName}> uses a closed shadow root, which happy-dom cannot serialize => left for the browser.`;
		case TAG_SUPPORT.NO_SERIALIZABLE_ROOT:
			return `[prerender] <${tagName}> has no serializable shadow root when constructed => left for the browser.`;
		default:
			return support satisfies never;
	}
};

//an element that only inherits `ssr` stays quiet on a root that is not serializable: that is the
//root every foreign web component has, and a page full of them is no mistake
const reportUnprerenderableElements = (
	realm: ServerRealm,
	elements: ReadonlyArray<CustomElementRecord>,
): void => {
	for (const element of elements) {
		if (!element.isPrerendered || realm.reportedTags.has(element.tagName))
			continue;
		const support = tagSupportOf(realm, element.tagName);
		if (support === TAG_SUPPORT.PRERENDERABLE) continue;
		const isQuietFallback =
			support === TAG_SUPPORT.NO_SERIALIZABLE_ROOT &&
			!element.hasOwnPrerenderAttribute;
		if (isQuietFallback) continue;
		realm.reportedTags.add(element.tagName);
		console.warn(warningFor(element.tagName, support));
	}
};

export const prerenderWebcomponents = (
	options: PrerenderOptions = {},
): Array<Plugin> => {
	const includePatterns = toPatternArray(options.include) ?? ["**"];
	const excludePatterns = toPatternArray(options.exclude) ?? [];

	let projectRoot = process.cwd();
	let isPageIncluded: (pageFilename: string) => boolean = () => false;
	let moduleLoader: ModuleLoaderConfig = {
		root: projectRoot,
		configFile: false,
		mode: undefined,
		resolveOptions: undefined,
	};
	//written by the early hook, which still sees the page's source <script> tags, and read by the
	//late one, which prerenders after vite has rewritten them
	const pageScriptsByPage = new Map<string, PageScripts>();

	//an instance built while the loader server evaluates a project config belongs to that
	//nested server: it must not scan, prerender, or close its parent's servers
	const isNestedLoaderInstance = isBootingLoaderServer();

	const pageUrlPathOf = (pageFilename: string): string =>
		`/${normalizePath(relative(projectRoot, pageFilename))}`;

	const pageScriptDiscovery: Plugin = {
		name: "prerender-webcomponents:page-scripts",
		transformIndexHtml: {
			order: "pre",
			handler(html, context) {
				if (isNestedLoaderInstance) return;
				pageScriptsByPage.set(
					context.filename,
					findPageScripts(html, pageUrlPathOf(context.filename)),
				);
			},
		},
	};

	const prerender: Plugin = {
		name: "prerender-webcomponents",

		//dev only: a build loads components through its own loader server, which brings the
		//environment along, and an app build would try to build every environment it is given
		config(_config, { command }) {
			if (isNestedLoaderInstance || command !== "serve") return;
			return {
				environments: {
					[PRERENDER_ENVIRONMENT_NAME]: prerenderEnvironmentOptions,
				},
			};
		},

		configResolved(config) {
			if (isNestedLoaderInstance) return;
			projectRoot = config.root;
			//an empty list is the one include a filter would read as "every page"
			isPageIncluded =
				includePatterns.length === 0
					? () => false
					: createFilter(includePatterns, excludePatterns, {
							resolve: config.root,
						});
			moduleLoader = {
				root: config.root,
				//without a config file on disk there is nothing to re-run, so the bare loader
				//and its forwarded resolve options are all we can offer
				configFile:
					options.componentLoader === "isolated"
						? false
						: (config.configFile ?? false),
				mode: config.mode,
				resolveOptions: {
					alias: config.resolve.alias,
					dedupe: config.resolve.dedupe,
				},
			};
		},

		//vite calls this once it has dropped the changed file's modules, so the fresh realm the
		//next request builds reads the new code instead of a cached transform
		hotUpdate() {
			if (isNestedLoaderInstance) return;
			markServerRealmStale();
		},

		async transformIndexHtml(html, context) {
			if (isNestedLoaderInstance) return html;
			const isIncluded = isPageIncluded(context.filename);
			if (!isIncluded && !mayCarryPrerenderAttribute(html)) return html;
			const elements = findCustomElements(html, isIncluded);
			if (!elements.some((element) => element.isPrerendered)) return html;

			const environment = context.server
				? context.server.environments[PRERENDER_ENVIRONMENT_NAME]
				: await prerenderEnvironmentOfLoader(moduleLoader);
			const pageScripts =
				pageScriptsByPage.get(context.filename) ?? NO_PAGE_SCRIPTS;

			return runInServerRealm(async (realm) => {
				await loadPageModules(realm, environment, pageScripts);
				reportUnprerenderableElements(realm, elements);
				const roots = choosePrerenderRoots(
					elements,
					(tagName) =>
						tagSupportOf(realm, tagName) === TAG_SUPPORT.PRERENDERABLE,
				);

				let transformedHtml = "";
				let copiedUpToIndex = 0;
				for (const root of roots) {
					const prerendered = await renderHost(
						realm,
						root.tagName,
						root.rawAttributes,
						html.slice(root.contentStartIndex, root.contentEndIndex),
						options.firstYieldTimeoutMs,
					);
					if (prerendered === null) continue;
					transformedHtml +=
						html.slice(copiedUpToIndex, root.startIndex) + prerendered;
					copiedUpToIndex = root.endIndex;
				}
				return transformedHtml + html.slice(copiedUpToIndex);
			});
		},

		async closeBundle() {
			if (isNestedLoaderInstance) return;
			await closeServerRealm();
			await closeModuleLoaderServers();
		},
	};

	return [pageScriptDiscovery, prerender];
};
