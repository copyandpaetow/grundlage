import { glob } from "node:fs/promises";
import { resolve } from "node:path";
import type { Plugin } from "vite";
import {
	closeModuleLoaderServers,
	isBootingLoaderServer,
	isComponentDefined,
	loadComponentModules,
	type ModuleLoaderConfig,
	renderHost,
} from "./ssr-render";

export interface PrerenderOptions {
	include?: string | Array<string>;
	exclude?: string | Array<string>;
	componentLoader?: "project-config" | "isolated";
	sentinelAttribute?: string;
	firstYieldTimeoutMs?: number;
}

interface OpenElementFrame {
	tagName: string;
	rawAttributes: string;
	isMarked: boolean;
	startIndex: number;
	contentStartIndex: number;
}

interface MarkedElement {
	tagName: string;
	rawAttributes: string;
	lightDomHtml: string;
	startIndex: number;
	endIndex: number;
}

const defaultIncludePatterns = ["**/*.{js,mjs,cjs,jsx,ts,mts,cts,tsx}"];

//added to whatever the caller excludes: importing these can only cost build time or break it
const alwaysExcludedPatterns = [
	"**/node_modules/**",
	"**/dist/**",
	"**/build/**",
	"**/*.d.ts",
	"**/*.{test,spec,bench}.*",
	"**/*.config.*",
];

const customElementName = "[a-z][a-z0-9._]*-[a-z0-9._-]*";

//alternatives are tried left to right, so comments and raw-text regions swallow any
//tag-looking text inside them before the tag alternatives can see it
const elementScanPattern = new RegExp(
	`<!--[\\s\\S]*?-->|<(script|style|textarea)[\\s\\S]*?</\\1\\s*>|<(${customElementName})((?:"[^"]*"|'[^']*'|[^>])*)>|</(${customElementName})\\s*>`,
	"g",
);

const escapeRegex = (value: string) =>
	value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const toPatternArray = (patterns: string | Array<string> | undefined) =>
	typeof patterns === "string" ? [patterns] : patterns;

export const prerenderWebcomponents = (
	options: PrerenderOptions = {},
): Plugin => {
	const sentinelAttribute = options.sentinelAttribute ?? "ssr";
	const includePatterns =
		toPatternArray(options.include) ?? defaultIncludePatterns;
	const excludePatterns = [
		...alwaysExcludedPatterns,
		...(toPatternArray(options.exclude) ?? []),
	];
	const sentinelPattern = new RegExp(
		`\\s${escapeRegex(sentinelAttribute)}(?=[\\s=/>]|$)`,
	);

	let projectRoot = process.cwd();
	let moduleLoader: ModuleLoaderConfig = {
		root: projectRoot,
		configFile: false,
		mode: undefined,
		resolveOptions: undefined,
	};
	let componentFilePaths: Promise<Array<string>> | null = null;
	const tagsReportedUndefined = new Set<string>();

	//an instance built while the loader server evaluates a project config belongs to that
	//nested server: it must not scan, prerender, or close its parent's servers
	const isNestedLoaderInstance = isBootingLoaderServer();

	const findComponentFiles = (): Promise<Array<string>> => {
		if (componentFilePaths) return componentFilePaths;
		componentFilePaths = (async () => {
			const filePaths: Array<string> = [];
			for await (const relativePath of glob(includePatterns, {
				cwd: projectRoot,
				exclude: excludePatterns,
			})) {
				filePaths.push(resolve(projectRoot, relativePath));
			}
			//module side effects run in a stable order across machines
			return filePaths.sort();
		})();
		return componentFilePaths;
	};

	const findMarkedElements = (html: string): Array<MarkedElement> => {
		const openFrames: Array<OpenElementFrame> = [];
		const markedElements: Array<MarkedElement> = [];

		for (const match of html.matchAll(elementScanPattern)) {
			const [matchedText, , openTagName, rawAttributes = "", closeTagName] =
				match;

			if (openTagName !== undefined) {
				openFrames.push({
					tagName: openTagName,
					rawAttributes,
					isMarked: sentinelPattern.test(rawAttributes),
					startIndex: match.index,
					contentStartIndex: match.index + matchedText.length,
				});
				continue;
			}
			if (closeTagName === undefined) continue;

			const openFrameIndex = openFrames.findLastIndex(
				(frame) => frame.tagName === closeTagName,
			);
			if (openFrameIndex === -1) continue;
			const [closedFrame] = openFrames.splice(openFrameIndex);

			if (!closedFrame.isMarked) continue;
			//a marked element inside another marked one is prerendered as part of its ancestor
			if (openFrames.some((frame) => frame.isMarked)) continue;

			markedElements.push({
				tagName: closedFrame.tagName,
				rawAttributes: closedFrame.rawAttributes,
				lightDomHtml: html.slice(closedFrame.contentStartIndex, match.index),
				startIndex: closedFrame.startIndex,
				endIndex: match.index + matchedText.length,
			});
		}

		return markedElements;
	};

	return {
		name: "prerender-webcomponents",

		configResolved(config) {
			if (isNestedLoaderInstance) return;
			projectRoot = config.root;
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

		async transformIndexHtml(html) {
			if (isNestedLoaderInstance) return html;
			//the sentinel appears verbatim on every candidate, so an unrelated page costs one substring scan
			if (!html.includes(sentinelAttribute)) return html;

			const markedElements = findMarkedElements(html);
			if (markedElements.length === 0) return html;

			await loadComponentModules(moduleLoader, await findComponentFiles());

			let transformedHtml = "";
			let copiedUpToIndex = 0;
			for (const markedElement of markedElements) {
				if (!isComponentDefined(markedElement.tagName)) {
					if (!tagsReportedUndefined.has(markedElement.tagName)) {
						tagsReportedUndefined.add(markedElement.tagName);
						console.warn(
							`[prerender] no scanned module defines <${markedElement.tagName}> — rendering on client. widen \`include\` if its module lives elsewhere.`,
						);
					}
					continue;
				}
				const prerendered = await renderHost(
					markedElement.tagName,
					markedElement.rawAttributes,
					markedElement.lightDomHtml,
					options.firstYieldTimeoutMs,
				);
				if (prerendered === null) continue;
				transformedHtml +=
					html.slice(copiedUpToIndex, markedElement.startIndex) + prerendered;
				copiedUpToIndex = markedElement.endIndex;
			}

			return transformedHtml + html.slice(copiedUpToIndex);
		},

		async closeBundle() {
			if (isNestedLoaderInstance) return;
			await closeModuleLoaderServers();
		},
	};
};
