const isWhitespace = (char: string) => {
	return char === " " || char === "\t" || char === "\r" || char === "\f";
};

type Position = "selector" | "at-rule" | "declaration";

export type CssParsingResult = {
	text: Array<string>;
	bindings: Array<{ type: Position; value: unknown }>;
	selector: string;
	type: "rule" | "sheet";
};

export const createCssRuleBlock = (): CssParsingResult => ({
	text: [],
	bindings: [],
	selector: "",
	type: "rule",
});

/*
learnings:
- this cant be done if linebreaks are part of the calculation
- it might be overall easier to start from the holes in both direction 
- here the last hole likely has the most information 
-- in a declaration value or a whole imported block, it sees either a ; or a } 
-- in a declaration key, it sees a :
-- in a selector it sees {
-- it sees the amount of nesting first

=> we need to record { and } downwards
- for every closing bracket, we record the index in an array spot
- if we see an opening bracket, we move the array spot => we could also treat it as skipable, since nothing in there is relevant for us
- if we see an unexpected closing bracket, we clear the array and add the index of the last closing bracket => nothing we saw at this point was the toplevel => we need to keep track of the nesting though
- we then can cut from closing bracket to closing bracket (hopefully all top level)

-for going upwards we count the closing brackets and compare to the nesting, if we are at depth 0 again, we cut here and move on without incrementing the index/ decrementing it

@import ${import};

.unrelated {
   margin: 2px
}

${selector} {
  .variant1 {
    inset: ${value}
  }

  .variant2 {
   ${key}: 1
  }
}

.unrelated2 {
   margin: 2px
}

${rule}

*/

const getCurrentToken = (tokens: TemplateStringsArray, index: number) => {
	if (index === 0) {
		return tokens[index].trimStart();
	}
	if (index === tokens.length - 1) {
		return tokens[index].trimEnd();
	}
	return tokens[index];
};

export const splitStylesIntoRules = (tokens: TemplateStringsArray) => {
	const result = [createCssRuleBlock()];

	let depth = 0;
	let lastChar = "";

	//we iterate the tokens chars from the beginnig
	for (let index = 0; index < tokens.length; index++) {
		const currentToken = getCurrentToken(tokens, index);
		const nextToken = tokens[index + 1];
		let ruleEnd = 0;

		for (let charIndex = 0; charIndex < currentToken.length; charIndex++) {
			const char = currentToken[charIndex];

			if (isWhitespace(char)) {
				continue;
			}

			if (char === "\n" && depth === 0) {
				//if we see a line break at depth 0 it must be because we end the current rule
				//exception: if the char after is a comma, it is a grouped selector. We also can ignore continuous line breaks

				if (lastChar === "\n" || lastChar === ",") {
					ruleEnd++;
					continue;
				}

				result.at(-1)?.text.push(currentToken.slice(ruleEnd, charIndex));
				ruleEnd = charIndex;
				if (nextToken) {
					result.push(createCssRuleBlock());
				}
			}

			if (char === "{") {
				depth++;
			}

			if (char === "}") {
				depth = Math.max(depth - 1, 0);
				//if we see a closing bracket at depth , we must see the end of our current rule, so we should stop here
				if (depth === 0) {
					//we push the current rule as text and start a new one
					result.at(-1)?.text.push(currentToken.slice(ruleEnd, charIndex + 1));
					ruleEnd = charIndex + 1;
					if (nextToken) {
						result.push(createCssRuleBlock());
					}
				}
			}

			lastChar = char;
		}

		if (nextToken) {
			//at the end of the current token, we push the remaining text into the current rule
			result.at(-1)?.text.push(currentToken.slice(ruleEnd));
		}
	}

	return result;
};

// const detectDepths = (token: string) => {
// 	let depth = 0;

// 	for (const char of token) {
// 		//todo: avoid quotes / comments

// 		if (char === "{") {
// 			depth++;
// 		}

// 		if (char === "}") {
// 			depth--;
// 		}
// 	}

// 	return depth;
// };

// const splitStaticRules = (token: string) => {
// 	const rules: Array<CssParsingResult> = [];

// 	//todo:

// 	return rules;
// };

// export const splitStylesIntoRules = (tokens: TemplateStringsArray) => {
// 	const result = [createCssRuleBlock()];

// 	let depth = detectDepths(tokens[0]); //first we detect the depth of the first token
// 	let lastChar = "";
// 	let ruleEnd = 0;

// 	//we move away from the holes
// 	tokens: for (let index = 0; index < tokens.length; index++) {
// 		let currentToken = tokens[index];
// 		let nextToken = tokens[index + 1];

// 		//when we ended the last rule, we keep track of the index and dont need to continue further
// 		for (
// 			let charIndex = currentToken.length - 1;
// 			charIndex > ruleEnd;
// 			charIndex--
// 		) {
// 			const char = currentToken[charIndex];

// 			//todo: skip quotes/comments
// 			//todo: double check all the slicings if they include the right chars or need a +1/-1

// 			//if we see a line break at depth 0 it must be because we end the current rule
// 			//exception: if the char after is a comma, it is a grouped selector
// 			if (depth === 0 && char === "\n" && currentToken[charIndex - 1] !== ",") {
// 				//everything above the the split must be static so we slice it off and split their rules separatly
// 				result.unshift(
// 					...splitStaticRules(currentToken.slice(ruleEnd, charIndex))
// 				);
// 				result.at(-1)?.text.push(currentToken.slice(charIndex));
// 				break;
// 			}

// 			if (char === "{") {
// 				depth++;
// 			}

// 			//if we see a closing bracket, we must see the start of a new rule, so we should stop here
// 			if (char === "}") {
// 				depth = Math.max(depth - 1, 0);

// 				if (depth === 0) {
// 					//everything above the the split must be static so we slice it off and split their rules separatly
// 					result.unshift(
// 						...splitStaticRules(currentToken.slice(ruleEnd, charIndex))
// 					);
// 					result.at(-1)?.text.push(currentToken.slice(charIndex));
// 					break;
// 				}
// 			}

// 			lastChar = char;
// 		}

// 		//we now move away from the hole to find the end of the current rule
// 		for (let charIndex = 0; charIndex < nextToken.length; charIndex++) {
// 			const char = nextToken[charIndex];

// 			//todo: skip quotes/comments
// 			//? this we might need to track as well, since the hole could be in the quotes/comment

// 			//if we see a line break at depth 0 it must be because we end the current rule
// 			//exception: if the char after is a comma, it is a grouped selector
// 			if (depth === 0 && char === "\n" && nextToken[charIndex + 1] !== ",") {
// 				//we push the current rule as text and start a new one
// 				result.at(-1)?.text.push(nextToken.slice(0, charIndex + 1));
// 				//todo: only when there is a next token
// 				result.push(createCssRuleBlock());
// 				ruleEnd = charIndex + 1;
// 				continue tokens;
// 			}

// 			if (char === "{") {
// 				depth++;
// 			}

// 			if (char === "}") {
// 				depth = Math.max(depth - 1, 0);
// 				//if we see a closing bracket at depth , we must see the end of our current rule, so we should stop here
// 				if (depth === 0) {
// 					//we push the current rule as text and start a new one
// 					result.at(-1)?.text.push(nextToken.slice(0, charIndex + 1));
// 					//todo: only when there is a next token
// 					result.push(createCssRuleBlock());
// 					ruleEnd = charIndex + 1;
// 					continue tokens;
// 				}
// 			}

// 			lastChar = char;
// 		}

// 		ruleEnd = 0;
// 		//in the previous loop we continue the inital for loop, so we only land here if the rule wasnt closed (like with 2 holes in one rule)
// 		if (nextToken) {
// 			result.at(-1)?.text.push(currentToken);
// 		}
// 	}

// 	console.log(result);
// 	return result;
// };

// export const splitStylesIntoRules = (tokens: TemplateStringsArray) => {
// 	const result = [createCssRuleBlock()];

// 	const state = {
// 		depth: 0,
// 		ruleEnd: 0,
// 		lastChar: "", //dont count linebreaks, tabs,
// 		skipUntil: "",
// 	};

// 	for (
// 		let tokenIndex = 0;
// 		tokenIndex < Math.max(1, tokens.length);
// 		tokenIndex++
// 	) {
// 		const token = tokens[tokenIndex];
// 		const nextToken = tokens[tokenIndex + 1];
// 		const currentRule = result.at(-1)!;

// 		for (let index = 0; index < Math.max(1, token.length); index++) {
// 			const char = token[index];

// 			if (isWhitespace(char)) {
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
// 				state.skipUntil = "*/";
// 				continue;
// 			}

// 			if (char === "'" || char === '"') {
// 				state.skipUntil = char;
// 				continue;
// 			}

// 			if (state.depth === 0) {
// 				if (char === ";" && index === 0) {
// 					result.at(-2)?.text.push(char);
// 					state.ruleEnd = index + 1;
// 					continue;
// 				}

// 				let nextIndex = index + 1;
// 				let nextVisibleChar = token[nextIndex];
// 				while (!isWhitespace(nextVisibleChar) && nextVisibleChar !== "\n") {
// 					nextVisibleChar = token[nextIndex++];
// 				}

// 				if (char === "\n" || !char) {
// 					console.log({ token, tokenIndex, ...state });

// 					if (!state.lastChar) {
// 						currentRule.text.push(token.slice(state.ruleEnd, index + 1));
// 						state.ruleEnd = index + 1;

// 						if (nextToken) {
// 							result.push(createCssRuleBlock());
// 							state.lastChar = "";
// 						}
// 					}

// 					continue;
// 				}
// 			}

// 			if (char === "{") {
// 				state.depth++;
// 				state.lastChar = char;
// 				continue;
// 			}

// 			if (char === "}") {
// 				state.depth = Math.max(state.depth - 1, 0);
// 				state.lastChar = char;

// 				if (state.depth === 0) {
// 					currentRule.text.push(token.slice(state.ruleEnd, index + 1));
// 					state.ruleEnd = index + 1;

// 					if (nextToken) {
// 						result.push(createCssRuleBlock());
// 						state.lastChar = "";
// 					}
// 				}

// 				continue;
// 			}

// 			state.lastChar = char;
// 		}

// 		if (nextToken) {
// 			currentRule.text.push(token.slice(state.ruleEnd));
// 			state.ruleEnd = 0;
// 		}
// 	}

// 	return result;
// };
