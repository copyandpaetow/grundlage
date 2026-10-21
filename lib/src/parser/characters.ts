import * as CHARACTER_CODE from "./character-code";

export const isWhitespaceCode = (code: number) =>
	code === CHARACTER_CODE.SPACE ||
	code === CHARACTER_CODE.LINE_FEED ||
	code === CHARACTER_CODE.TAB ||
	code === CHARACTER_CODE.CARRIAGE_RETURN;

export const isQuoteCode = (code: number) =>
	code === CHARACTER_CODE.SINGLE_QUOTE || code === CHARACTER_CODE.DOUBLE_QUOTE;
