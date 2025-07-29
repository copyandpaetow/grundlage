import type { CssParsingResult } from "./css";
import type { ParsingResult } from "./html";

export const renderKey = Symbol("render");

export type ParsingState = {
	inTag: boolean;
	inQuote: boolean;
	quoteChar: string;
	lastAttributeStart: number;
	position: number;
};

export const updateParsingState = (newContent: string, state: ParsingState) => {
	for (const char of newContent) {
		state.position += 1;
		if (!state.inQuote) {
			if (char === '"' || char === "'") {
				state.inQuote = true;
				state.quoteChar = char;
			} else if (char === "<") {
				state.inTag = true;
				state.lastAttributeStart = -1;
			} else if (char === ">") {
				state.inTag = false;
				state.lastAttributeStart = -1;
			} else if (state.inTag && char === " ") {
				state.lastAttributeStart = state.position;
			}
		} else if (char === state.quoteChar) {
			state.inQuote = false;
			state.quoteChar = "";
		}
	}
};
const cases = ["string", "number", "bigint", "boolean", "symbol"];

export const isStatic = (
	value: unknown
): value is string | number | boolean | bigint | symbol =>
	cases.includes(typeof value);

//TODO: maybe some of these can be condensed
export const isNestedRender = (
	nextValue: unknown
): nextValue is ParsingResult => {
	//@ts-expect-error
	return typeof nextValue === "object" && nextValue?.key === renderKey;
};

export const createStub = () => {
	return `__${(Math.random() * 100000).toFixed()}__`;
};

export const mergeMaps = (
	from: Map<unknown, unknown>,
	to: Map<unknown, unknown>
) => {
	from.forEach((nestedValue, nestedKey) => to.set(nestedKey, nestedValue));
	return to;
};

export const cssKey = Symbol("css");

export const createStyleStub = () => {
	return `css-${(Math.random() * 100000).toFixed()}`;
};

export const isUsedAsClassIdentifier = (node: CssParsingResult) => {
	return node.template.at(-1) === ".";
};

export const isNestedStyleRender = (
	nextValue: unknown
): nextValue is CssParsingResult => {
	//@ts-expect-error
	return typeof nextValue === "object" && nextValue?.key === cssKey;
};

export const sliceLastAttributeName = (
	result: ParsingResult,
	state: ParsingState
): string => {
	console.log({ ...state }, { template: result.template });
	const afterLastSpace = result.template.slice(state.lastAttributeStart);
	const equalIndex = afterLastSpace.indexOf("=");
	state.position -= afterLastSpace.length;
	result.template = result.template.slice(0, state.lastAttributeStart);

	return equalIndex !== -1
		? afterLastSpace.slice(0, equalIndex)
		: afterLastSpace;
};
