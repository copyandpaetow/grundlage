import { detectBindingPositions } from "./css/detect-bindings";
import {
	createCssRuleBlock,
	CssParsingResult,
	splitStylesIntoRules,
} from "./css/split-rules";

export class CssRuleTemplate {
	dynamicValues: Array<unknown>;
	template: CssParsingResult[];
	constructor(template: CssParsingResult[], dynamicValues: Array<unknown>) {
		this.dynamicValues = dynamicValues;
		this.template = template;
	}
}

export class CssStyleTemplate {
	dynamicValues: Array<unknown>;
	template: CssParsingResult[];
	constructor(template: CssParsingResult[], dynamicValues: Array<unknown>) {
		this.dynamicValues = dynamicValues;
		this.template = template;
		console.log({ dynamicValues, template });
	}

	setup() {}

	update() {}
}

const cssCache = new WeakMap<TemplateStringsArray, CssParsingResult[]>();

export const parseCSSRule = (
	tokens: TemplateStringsArray,
	...dynamicValues: Array<unknown>
) => {
	if (!cssCache.has(tokens)) {
		const result = createCssRuleBlock();
		result.text.push(...tokens);
		cssCache.set(tokens, [detectBindingPositions(result)]);
	}

	return new CssRuleTemplate(cssCache.get(tokens)!, dynamicValues);
};

const parseStyleSheet = (
	tokens: TemplateStringsArray,
	...dynamicValues: Array<unknown>
) => {
	if (!cssCache.has(tokens)) {
		cssCache.set(
			tokens,
			splitStylesIntoRules(tokens).map(detectBindingPositions)
		);
	}

	return new CssStyleTemplate(cssCache.get(tokens)!, dynamicValues);
};

export const css = {
	rule: parseCSSRule,
	stylesheet: parseStyleSheet,
};
