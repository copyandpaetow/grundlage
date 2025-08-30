import { detectBindingPositions } from "./detect-bindings";
import {
	createCssRuleBlock,
	CssParsingResult,
	splitStylesIntoRules,
} from "./split-rules";

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

	return parsedTokens;
	//todo: add replacing of dynamic content
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

	return parsedTokens;
};

export const css = {
	rule: parseCSSRule,
	stylesheet: parseStyleSheet,
};

/*

	if we are inside of a rule, we only care when it ends so
	at depth > 1, we want to find the right closing rule and start the next search
	=> we only care about more curly brackets, and skippables (quotes, comments)

	between rules/ on the toplevel
	- when we see only white space and a line break, we start a new rule
	- when we see a semi colon before the line break, we also start a new rule
	
	*/

/*

learnings

- separating rules and detecting position gets too complicated
- it cant be done with detection for rule or sheet as the dynamic parts can alter the result
=> split the rules from the sheet and save it as array, from there the rules and split sheets can be processed together

- when starting from the beginning, we have a hard time knowing when something has ended as we dont look ahead
- when starting from the holes, we cant know deep we are so he have to iterate everything before the hole
- when starting from the end, we dont know if 

*/
