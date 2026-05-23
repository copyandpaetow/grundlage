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

	//compile both patterns once per plugin instance
	//we keep the tag-match and the sentinel-presence checks separate: a single combined regex with optional surrounding attributes is hard to read and easy to break — two passes are clearer and the attribute-string check runs only on tag matches
	const tagUnion = tagNames.map(escapeRegex).join("|");
	const tagPattern = new RegExp(
		`<(${tagUnion})([^>]*)>\\s*</\\1>`,
		"g",
	);
	//lookahead on `[\s=/>]` (or end-of-string when the sentinel is the last attribute) makes `ssr` a standalone attribute name — `data-ssr` (no leading space) and `ssrcheck` (no terminator) won't match
	const sentinelPattern = new RegExp(
		`\\s${escapeRegex(sentinelAttribute)}(?=[\\s=/>]|$)`,
	);

	return {
		name: "prerender-webcomponents",
		async transformIndexHtml(html) {
			//string-includes pre-check avoids running the regex on pages that don't use any registered tag (and skips the happy-dom polyfill setup entirely for those pages)
			if (!tagNames.some((tag) => html.includes(`<${tag}`))) return html;

			const candidates = [...html.matchAll(tagPattern)];
			if (candidates.length === 0) return html;

			let output = html;
			//sequential rather than parallel because renderHost serializes `document.body.getHTML(...)` and shares a single polyfilled document — concurrent mounts would leak each other's hosts into the serialized output
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
