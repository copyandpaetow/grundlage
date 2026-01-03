import { detectBindingPositions } from "./css/detect-bindings";
import { CssParsingResult, splitStylesIntoRules } from "./css/split-rules";
import { CSSTemplate } from "./template-css";

const needsDynamicClassName = (tokens: TemplateStringsArray) => {
	tokenLoop: for (let index = 0; index < tokens.length; index++) {
		const partialStyle = tokens[index];
	}
};

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

const css2 = {
	class(tokens: TemplateStringsArray, ...dynamicValues: Array<unknown>) {},
	styleSheet(tokens: TemplateStringsArray, ...dynamicValues: Array<unknown>) {},
};

css2.class`
  <div>${1}</div>
`;
