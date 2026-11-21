import { relative } from "node:path";
import { createFilter, normalizePath, type Plugin } from "vite";
import { findPageScripts, NO_PAGE_SCRIPTS, type PageScripts } from "./page-scripts";
import { findCustomElements, mayCarryPrerenderAttribute, PRERENDER_CHOICE } from "./scan";
import {
	closeModuleLoaderServers,
	closeServerRealm,
	isBootingLoaderServer,
	markServerRealmStale,
	type ModuleLoaderConfig,
	PRERENDER_ENVIRONMENT_NAME,
	prerenderEnvironmentOfLoader,
	prerenderEnvironmentOptions,
	renderPage,
} from "./ssr-render";

export interface PrerenderOptions {
	//page globs relative to the vite root: every page when left out, no page for `[]`
	include?: string | Array<string>;
	exclude?: string | Array<string>;
	//how a build loads component modules; dev loads them through its own server
	componentLoader?: "project-config" | "isolated";
	pendingTaskTimeoutMs?: number;
}

const toPatternArray = (patterns: string | Array<string> | undefined) =>
	typeof patterns === "string" ? [patterns] : patterns;

//oxlint-disable-next-line max-lines-per-function -- long, not complex: the plugin's hooks share the closure's state
export const prerenderWebComponents = (options: PrerenderOptions = {}): Array<Plugin> => {
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
		name: "prerender-web-components:page-scripts",
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
		name: "prerender-web-components",

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
				configFile: options.componentLoader === "isolated" ? false : (config.configFile ?? false),
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
			const elements = findCustomElements(
				html,
				isIncluded ? PRERENDER_CHOICE.ON : PRERENDER_CHOICE.OFF,
			);
			if (!elements.some((element) => element.prerenderChoice === PRERENDER_CHOICE.ON)) return html;

			const environment = context.server
				? context.server.environments[PRERENDER_ENVIRONMENT_NAME]
				: await prerenderEnvironmentOfLoader(moduleLoader);
			return renderPage(environment, {
				html,
				elements,
				pageScripts: pageScriptsByPage.get(context.filename) ?? NO_PAGE_SCRIPTS,
				pendingTaskTimeoutMs: options.pendingTaskTimeoutMs,
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
