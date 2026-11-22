import * as CHARACTER_CODE from "./character-code";

export const isWhitespaceCode = (code: number): boolean =>
	code === CHARACTER_CODE.SPACE ||
	code === CHARACTER_CODE.LINE_FEED ||
	code === CHARACTER_CODE.TAB ||
	code === CHARACTER_CODE.CARRIAGE_RETURN;

export const isQuoteCode = (code: number): boolean =>
	code === CHARACTER_CODE.SINGLE_QUOTE || code === CHARACTER_CODE.DOUBLE_QUOTE;

export const isLetterCode = (code: number): boolean =>
	(code >= CHARACTER_CODE.LOWERCASE_A && code <= CHARACTER_CODE.LOWERCASE_Z) ||
	(code >= CHARACTER_CODE.UPPERCASE_A && code <= CHARACTER_CODE.UPPERCASE_Z);
