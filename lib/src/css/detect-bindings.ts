import { CssParsingResult } from "./split-rules";

export const detectBindingPositions = (cssRule: CssParsingResult) => {
	let backwardColon = -1;
	let forwardColon = -1;

	tokens: for (
		let tokenIndex = 0;
		tokenIndex < cssRule.text.length - 1;
		tokenIndex++
	) {
		backwardColon = -1;
		forwardColon = -1;

		const currentToken = cssRule.text[tokenIndex];
		const nextToken = cssRule.text[tokenIndex + 1];

		if (!nextToken) {
			break;
		}

		//we move away from the hole to the start
		for (let charIndex = currentToken.length - 1; charIndex >= 0; charIndex--) {
			const char = currentToken[charIndex];

			//we are at another block and where in a selector before
			if (char === "}") {
				cssRule.bindings.push({ type: "selector", value: null });
				continue tokens;
			}

			//we are at another block and where in a selector before
			if (char === "@") {
				if (backwardColon !== -1) {
					cssRule.bindings.push({ type: "at-rule", value: null });
				} else {
					cssRule.bindings.push({ type: "selector", value: null });
				}

				continue tokens;
			}

			//we could either be at the border of a rule key (from a value) or seeing a pseudo selector
			if (char === ":") {
				backwardColon = charIndex;
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
				cssRule.bindings.push({ type: "selector", value: null });
				continue tokens;
			}

			//we are at the border to a value and where in a key before
			if (char === ":") {
				forwardColon = charIndex;
				continue;
			}

			//if we see a closing bracket, we could either be in the last block/value so we cant say
			//a semicolon could also indicated either a rulekey or a block
			if (char === ";" || char === "}") {
				//if we saw a colon before, it was either a selector or a value, here it was a value
				if (backwardColon !== -1) {
					cssRule.bindings.push({ type: "declaration", value: null });
					continue tokens;
				}
				if (forwardColon !== -1) {
					cssRule.bindings.push({ type: "declaration", value: null });
					continue tokens;
				}
				break;
			}
		}

		if (backwardColon !== -1 || forwardColon !== -1) {
			cssRule.bindings.push({
				type: "declaration",
				value: null,
			});
			continue;
		}

		//if we dont know, we re-add the last type
		cssRule.bindings.push({
			type: cssRule.bindings.at(-1)?.type ?? "selector",
			value: null,
		});
	}

	console.log(cssRule);

	return cssRule;
};

// const detectBindingPositions = (result: CssParsingResult): CssParsingResult => {
// 	const state = {
// 		skipUntil: "",
// 		lastChar: "",
// 		type: "selector",
// 	};

// 	for (let tokenIndex = 0; tokenIndex < result.text.length; tokenIndex++) {
// 		const token = result.text[tokenIndex];

// 		if (!result.text[tokenIndex + 1]) {
// 			break;
// 		}

// 		for (let index = 0; index < token.length; index++) {
// 			const char = token[index];

// 			if (isWhitespace(char) || char === "\n") {
// 				continue;
// 			}

// 			if (state.skipUntil) {
// 				if (
// 					token.slice(index, index + state.skipUntil.length) === state.skipUntil
// 				) {
// 					state.skipUntil = "";
// 				}
// 				index += state.skipUntil.length;
// 			}

// 			if (char === "*" && state.lastChar === "/") {
// 				state.skipUntil = "/*";
// 				continue;
// 			}

// 			if (char === "'" || char === '"') {
// 				state.skipUntil = char;
// 				continue;
// 			}

// 			if (char === "@") {
// 				state.type = "at-rule";
// 				continue;
// 			}

// 			if (char === "{") {
// 				state.type = "declaration";
// 				continue;
// 			}

// 			if (char === "}") {
// 				state.type = "selector";
// 				continue;
// 			}

// 			state.lastChar = char;
// 		}
// 		result.bindings.push(state.type as Position);
// 		state.type = "selector";
// 		state.lastChar = "";
// 	}

// 	return result;
// };
