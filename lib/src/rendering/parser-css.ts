import { detectBindingPositions } from "./css/detect-bindings";
import { CssParsingResult, splitStylesIntoRules } from "./css/split-rules";
import { CSSTemplate } from "./template-css";

const cssCache = new WeakMap<TemplateStringsArray, CssParsingResult[]>();

export const css = (
	tokens: TemplateStringsArray,
	...dynamicValues: Array<unknown>
) => {
	if (!cssCache.has(tokens)) {
		cssCache.set(
			tokens,
			splitStylesIntoRules(tokens).map(detectBindingPositions)
		);
	}

	return new CSSTemplate(cssCache.get(tokens)!, dynamicValues);
};
