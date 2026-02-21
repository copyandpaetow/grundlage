export const COMMENT_IDENTIFIER = "^.^";

export const isWhitespace = (char: string) =>
	char === " " || char === "\t" || char === "\n" || char === "\r";

export const isQuote = (char: string) => char === "'" || char === '"';

export const moveArrayContents = (from: Array<unknown>, to: Array<unknown>) => {
	for (let arrIndex = 0; arrIndex < from.length; arrIndex++) {
		to.push(from[arrIndex]);
	}
	from.length = 0;
};
