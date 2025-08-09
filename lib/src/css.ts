const renderAsString = ["string", "number", "symbol", "bigInt"];

const handleSelector = (state: State, result: CssParsingResult) => {
	const currentValue = state.dynamicValues[state.index];
	const currentToken = state.tokens[state.index];

	if (typeof currentValue === null || typeof currentValue === undefined) {
		return;
	}

	if (typeof currentValue === "object") {
		if (currentValue?.type) {
			result.text += ` ${currentToken}${currentValue.selector}`;
			return;
		}
	}
	if (Array.isArray(currentValue)) {
		result.text += ` ${currentToken}${currentValue.join(" ")}`;
		return;
	}

	if (typeof currentValue === "function") {
		result.text += ` ${currentToken}${currentValue()}`;
	}
};

const handleRuleKey = (state: State, result: CssParsingResult) => {
	const currentValue = state.dynamicValues[state.index];
	const currentToken = state.tokens[state.index];

	if (typeof currentValue === null || typeof currentValue === undefined) {
		//TODO: we need to delete the value as well
		return;
	}

	if (typeof currentValue === "function") {
		result.text += ` ${currentToken}${currentValue()}`;
	}
};

const handleRuleValue = (state: State, result: CssParsingResult) => {
	const currentValue = state.dynamicValues[state.index];
	const currentToken = state.tokens[state.index];

	if (typeof currentValue === null || typeof currentValue === undefined) {
		//TODO: we should remove the key as well
		return;
	}

	if (typeof currentValue === "function") {
		//TODO: we still need to replace the whole value
		result.text += ` ${currentToken}${currentValue()}`;
	}
};

const handleBlock = (state: State, result: CssParsingResult) => {
	const currentValue = state.dynamicValues[state.index];
	const currentToken = state.tokens[state.index];

	if (typeof currentValue === null || typeof currentValue === undefined) {
		return;
	}

	if (typeof currentValue === "object") {
		if (currentValue?.type) {
			result.text += ` ${currentToken}${currentValue.text}`;
			return;
		}

		Object.entries(Object).forEach(([key, value]) => {
			result.text += ` ${currentToken}${key}: ${value};`;
		});
		return;
	}
	if (currentValue instanceof Map) {
		currentValue.forEach(([value, key]) => {
			result.text += ` ${currentToken}${key}: ${value};`;
		});
		return;
	}

	if (typeof currentValue === "function") {
		result.text += ` ${currentToken}${currentValue()}`;
	}
};

type State = {
	index: number;
	tokens: TemplateStringsArray;
	dynamicValues: Array<unknown>;
	backwardColon: number;
	forwardColon: number;
};

type Binding = {};

export type CssParsingResult = {
	type: "rule" | "block";
	text: string;
	bindings: Array<Binding>;
	selector: string;
};

export const css = (
	tokens: TemplateStringsArray,
	...dynamicValues: Array<unknown>
): CssParsingResult => {
	const result: CssParsingResult = {
		type: "rule",
		text: "",
		bindings: [],
		selector: crypto.randomUUID().slice(0, 8),
	};

	const state = {
		index: -1,
		tokens,
		dynamicValues,
		backwardColon: -1,
		forwardColon: -1,
	};

	tokens: while (state.index < state.tokens.length - 2) {
		state.index++;
		state.backwardColon = -1;
		state.forwardColon = -1;

		const currentToken = state.tokens[state.index];
		const nextToken = state.tokens[state.index + 1];

		const currentValue = state.dynamicValues[state.index];
		if (renderAsString.includes(typeof currentValue)) {
			result.text += `${currentToken}${currentValue}`;
			continue;
		}

		//we move away from the hole to the start
		for (let charIndex = currentToken.length - 1; charIndex >= 0; charIndex--) {
			const char = currentToken[charIndex];

			//we are at another block and where in a selector before
			if (char === "}") {
				handleSelector(state, result);
				continue tokens;
			}

			//we are at another block and where in a selector before
			if (char === "@") {
				if (state.backwardColon !== -1) {
					handleBlock(state, result);
				} else {
					handleSelector(state, result);
				}

				continue tokens;
			}

			//we could either be at the border of a rule key (from a value) or seeing a pseudo selector
			if (char === ":") {
				state.backwardColon = charIndex;
				continue;
			}

			//if we see an open bracket, we could either be in a selector or in the first block/rule so we cant say
			//a semicolon could also indicated either a rulekey or a block
			if (char === ";" || char === "{") {
				break;
			}
		}

		//we move away from the hole to the next hole
		for (let charIndex = 0; charIndex < nextToken.length; charIndex++) {
			const char = nextToken[charIndex];

			//we start a new block and have to be in a selector
			if (char === "{") {
				handleSelector(state, result);
				continue tokens;
			}

			//we are at the border to a value and where in a key before
			if (char === ":") {
				state.forwardColon = charIndex;
				continue;
			}

			//if we see a closing bracket, we could either be in the last block/value so we cant say
			//a semicolon could also indicated either a rulekey or a block
			if (char === ";" || char === "}") {
				//if we saw a colon before, it was either a selector or a value, here it was a value
				if (state.backwardColon !== -1) {
					handleRuleValue(state, result);
					continue tokens;
				}
				if (state.forwardColon !== -1) {
					handleRuleKey(state, result);
					continue tokens;
				}
				break;
			}
		}

		//only a block would be ambivalent enough to end up here
		handleBlock(state, result);
	}
	result.text += state.tokens.at(-1);
	return result;
};

/*

TODO: maybe it makes more sense to replace rules individually instead
? we need to use a sheet for efficient manipulation but a style element for addition to the web-component

{
  element: HTMLStyleElement,
  sheet: element.sheet, // for runtime manipulation
  bindings: [
    (value) => sheet.insertRule(value, 0),
    (value) => sheet.replaceRule(1, `.card.${value} { ... }`),
  ],
  serialize: () => {
    // Extract all rules from sheet and update element.textContent
    element.textContent = Array.from(sheet.cssRules).map(rule => rule.cssText).join('\n');
  }
}

! we cant share the element with other instances, that needs to be provided by the framework
so only 

{
  sheet: CSSStyleSheet, //including the static parts
  bindings: [
    (value) => sheet.insertRule(value, 0),
    (value) => sheet.replaceRule(1, `.card.${value} { ... }`),
  ]
}

*/
