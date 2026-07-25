import type { Plugin } from "vite";
import { renderHost } from "./ssr-render";

export interface PrerenderOptions {
	components: Record<string, () => Promise<unknown>>;
	sentinelAttribute?: string;
	firstYieldTimeoutMs?: number;
}

const escapeRegex = (value: string) =>
	value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const prerenderWebcomponents = (options: PrerenderOptions): Plugin => {
	const sentinelAttribute = options.sentinelAttribute ?? "ssr";
	const componentModuleLoaders = Object.values(options.components);
	const registeredTagNames = Object.keys(options.components);

	const tagNameAlternation = registeredTagNames.map(escapeRegex).join("|");
	const emptyElementPattern = new RegExp(
		`<(${tagNameAlternation})((?:"[^"]*"|'[^']*'|[^>])*)>\\s*</\\1>`,
		"g",
	);
	const sentinelPattern = new RegExp(
		`\\s${escapeRegex(sentinelAttribute)}(?=[\\s=/>]|$)`,
	);

	return {
		name: "prerender-webcomponents",
		async transformIndexHtml(html) {
			//cheap includes() gate skips the regex and happy-dom registration for unrelated pages
			if (!registeredTagNames.some((tagName) => html.includes(`<${tagName}`))) {
				return html;
			}

			const emptyElementMatches = [...html.matchAll(emptyElementPattern)];
			if (emptyElementMatches.length === 0) return html;

			let transformedHtml = html;
			for (const [
				matchedElement,
				tagName,
				rawAttributes = "",
			] of emptyElementMatches) {
				if (!sentinelPattern.test(rawAttributes)) continue;
				const prerendered = await renderHost(
					tagName,
					rawAttributes,
					componentModuleLoaders,
					options.firstYieldTimeoutMs,
				);
				if (prerendered === null) continue;
				transformedHtml = transformedHtml.replace(
					matchedElement,
					() => prerendered,
				);
			}

			return transformedHtml;
		},
	};
};
