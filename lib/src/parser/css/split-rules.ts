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

			//todo: handle quotes and comments

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
