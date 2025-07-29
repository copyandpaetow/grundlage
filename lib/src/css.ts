const handleSelector = (state: State, result: CssParsingResult) => {};

const handleRuleKey = (state: State, result: CssParsingResult) => {};

const handleRuleValue = (state: State, result: CssParsingResult) => {};

const handleBlock = (state: State, result: CssParsingResult) => {};

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
};

export const css =
	(type: "block" | "rule") =>
	(
		tokens: TemplateStringsArray,
		...dynamicValues: Array<unknown>
	): CssParsingResult => {
		const result: CssParsingResult = {
			type,
			text: "",
			bindings: [],
		};

		const state = {
			index: -1,
			tokens,
			dynamicValues,
			backwardColon: -1,
			forwardColon: -1,
		};

		tokens: while (state.index < state.tokens.length - 1) {
			state.index++;
			state.backwardColon = -1;
			state.forwardColon = -1;
			const currentToken = state.tokens[state.index];
			const nextToken = state.tokens[state.index + 1];

			//we move away from the hole to the start
			for (
				let charIndex = currentToken.length - 1;
				charIndex >= 0;
				charIndex--
			) {
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

		return result;
	};

/*

class1 ${test} {}

${test} class1 {}

class1 {
key: ${};  

}
*/
