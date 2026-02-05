export const COMMENT_IDENTIFIER = "__grundlage__";

export const isWhitespace = (char: string) =>
	char === " " || char === "\t" || char === "\n" || char === "\r";

export const isQuote = (char: string) => char === "'" || char === '"';
