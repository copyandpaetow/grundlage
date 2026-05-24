export const COMMENT_IDENTIFIER = "^.^";

//char codes used by the hot parser loop — numeric compares stay monomorphic and
//avoid the single-char string holder that string indexing would create per peek
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

export const moveArrayContents = (from: Array<unknown>, to: Array<unknown>) => {
	for (let arrIndex = 0; arrIndex < from.length; arrIndex++) {
		to.push(from[arrIndex]);
	}
	from.length = 0;
};
