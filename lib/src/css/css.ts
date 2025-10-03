import { detectBindingPositions } from "./detect-bindings";
import {
	createCssRuleBlock,
	CssParsingResult,
	splitStylesIntoRules,
} from "./split-rules";

export const cssIdentifier = Symbol("css");
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

	const parsedTokens = cssCache.get(tokens)!;
	parsedTokens.forEach((result) => {
		result.bindings.forEach((entry, index) => {
			entry.value = dynamicValues[index];
		});
		result.type = "rule";
	});

	//todo: does it make sense, that this is an array with one entry inside of a small object?

	return {
		rules: parsedTokens,
		type: cssIdentifier,
	};
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

	const parsedTokens = cssCache.get(tokens)!;
	parsedTokens.forEach((result) => {
		result.bindings.forEach((entry, index) => {
			entry.value = dynamicValues[index];
		});
		result.type = "sheet";
	});

	return {
		rules: parsedTokens,
		type: cssIdentifier,
	};
};

export const css = {
	rule: parseCSSRule,
	stylesheet: parseStyleSheet,
};
