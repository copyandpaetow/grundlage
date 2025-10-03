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

	return cssRule;
};
