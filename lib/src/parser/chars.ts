export const MARKUP = {
	TAG_OPEN: "<",
	TAG_CLOSE: ">",
	END_TAG_OPEN: "</",
	COMMENT_OPEN: "<!--",
	COMMENT_CLOSE: "-->",
	EMPTY_COMMENT: "<!---->",
	ATTRIBUTE_SEPARATOR: " ",
	ATTRIBUTE_ASSIGN: "=",
	ATTRIBUTE_QUOTE: "'",
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
	OPEN_PAREN: 40,
	CLOSE_PAREN: 41,
	ASTERISK: 42,
	COLON: 58,
	SEMICOLON: 59,
	AT: 64,
	UPPERCASE_A: 65,
	UPPERCASE_Z: 90,
	BACKSLASH: 92,
	LOWERCASE_A: 97,
	LOWERCASE_Z: 122,
	OPEN_BRACE: 123,
	CLOSE_BRACE: 125,
} as const;

export const isWhitespaceCode = (code: number) =>
	code === CHAR_CODE.SPACE ||
	code === CHAR_CODE.LINE_FEED ||
	code === CHAR_CODE.TAB ||
	code === CHAR_CODE.CARRIAGE_RETURN;

export const isQuoteCode = (code: number) =>
	code === CHAR_CODE.SINGLE_QUOTE || code === CHAR_CODE.DOUBLE_QUOTE;
