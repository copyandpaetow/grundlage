export const MARKUP = {
	TAG_OPEN: "<",
	TAG_CLOSE: ">",
	END_TAG_OPEN: "</",
	COMMENT_OPEN: "<!--",
	COMMENT_CLOSE: "-->",
	EMPTY_COMMENT: "<!---->",
	ATTR_SEPARATOR: " ",
	ATTR_ASSIGN: "=",
	ATTR_QUOTE: "'",
} as const;

export const CHAR_CODE = {
	TAB: 9,
	LINE_FEED: 10,
	CARRIAGE_RETURN: 13,
	SPACE: 32,
	DOUBLE_QUOTE: 34,
	SINGLE_QUOTE: 39,
	DASH: 45,
	SLASH: 47,
	LESS_THAN: 60,
	EQUALS: 61,
	GREATER_THAN: 62,
	BANG: 33,
} as const;

export const isWhitespaceCode = (code: number) =>
	code === CHAR_CODE.SPACE ||
	code === CHAR_CODE.LINE_FEED ||
	code === CHAR_CODE.TAB ||
	code === CHAR_CODE.CARRIAGE_RETURN;

export const isQuoteCode = (code: number) =>
	code === CHAR_CODE.SINGLE_QUOTE || code === CHAR_CODE.DOUBLE_QUOTE;
