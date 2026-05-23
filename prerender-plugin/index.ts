import type { Plugin } from "vite";
import { renderHost } from "./ssr-render";

export interface PrerenderOptions {
	/** Tag-name → dynamic import of the module that registers the custom element. */
	components: Record<string, () => Promise<unknown>>;
	/** Attribute on a registered element that opts that instance into prerender. Default: `ssr`. */
	sentinelAttribute?: string;
	/** How long to wait for the first-yield shadow content to land. */
	pollTimeoutMs?: number;
}

const escapeRegex = (value: string) =>
	value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const prerenderWebcomponents = (
	options: PrerenderOptions,
): Plugin => {
	const sentinelAttribute = options.sentinelAttribute ?? "ssr";
	const componentLoaders = Object.values(options.components);
	const tagNames = Object.keys(options.components);

	//two passes (tag match, then sentinel check) instead of one combined regex — clearer and the sentinel check runs only on tag hits
	const tagUnion = tagNames.map(escapeRegex).join("|");
	const tagPattern = new RegExp(
		`<(${tagUnion})([^>]*)>\\s*</\\1>`,
		"g",
	);
	//lookahead on `[\s=/>]|$` keeps `ssr` standalone — `data-ssr` and `ssrcheck` don't match
	const sentinelPattern = new RegExp(
		`\\s${escapeRegex(sentinelAttribute)}(?=[\\s=/>]|$)`,
	);

	return {
		name: "prerender-webcomponents",
		async transformIndexHtml(html) {
			//string-includes pre-check skips both the regex and the happy-dom setup for unrelated pages
			if (!tagNames.some((tag) => html.includes(`<${tag}`))) return html;

			const candidates = [...html.matchAll(tagPattern)];
			if (candidates.length === 0) return html;

			let output = html;
			//sequential — renderHost shares a single polyfilled document; concurrent mounts would leak hosts into each other's serialized output
			for (const match of candidates) {
				const attributeString = match[2] ?? "";
				if (!sentinelPattern.test(attributeString)) continue;
				const rendered = await renderHost(
					match[1],
					attributeString,
					componentLoaders,
					options.pollTimeoutMs,
				);
				output = output.replace(match[0], rendered);
			}

			return output;
		},
	};
};
