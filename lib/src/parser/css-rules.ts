import { isQuoteCode, isWhitespaceCode } from "./characters";
import * as CHARACTER_CODE from "./character-code";
import { libraryMessage } from "../utils/diagnostics";

//the source still holds html.ts's reserved hole character, which opens and closes nothing here

const FORM_FEED = 12;
const COMMENT_OPEN = "/*";
const COMMENT_CLOSE = "*/";
const NAMESPACE_RULE = "@namespace";

const CLOSER_OF_OPENER = new Map([
	[CHARACTER_CODE.OPEN_BRACE, CHARACTER_CODE.CLOSE_BRACE],
	[CHARACTER_CODE.OPEN_PAREN, CHARACTER_CODE.CLOSE_PAREN],
	[CHARACTER_CODE.OPEN_BRACKET, CHARACTER_CODE.CLOSE_BRACKET],
]);

//a string ends at its own quote, or before a line break, the way CSS reads a broken string
const stringEndOf = (source: string, quoteIndex: number, end: number) => {
	const quoteCode = source.charCodeAt(quoteIndex);
	let index = quoteIndex + 1;
	while (index < end) {
		const code = source.charCodeAt(index);
		if (code === quoteCode) return index + 1;
		if (code === CHARACTER_CODE.LINE_FEED || code === CHARACTER_CODE.CARRIAGE_RETURN) return index;
		if (code === FORM_FEED) return index;
		index += code === CHARACTER_CODE.BACKSLASH ? 2 : 1;
	}
	return end;
};

const commentEndOf = (source: string, commentIndex: number, end: number) => {
	const closeIndex = source.indexOf(COMMENT_CLOSE, commentIndex + COMMENT_OPEN.length);
	if (closeIndex === -1 || closeIndex + COMMENT_CLOSE.length > end) return end;
	return closeIndex + COMMENT_CLOSE.length;
};

//a namespace prefix is declared for its own sheet only, and the split gives the rules after it
//sheets of their own
const ensureNoNamespaceRule = (source: string, index: number) => {
	const name = source.slice(index, index + NAMESPACE_RULE.length).toLowerCase();
	if (name !== NAMESPACE_RULE) return;
	throw new Error(
		libraryMessage(
			"a <style> with ${...} expects no @namespace: each rule with a ${...} gets a <style> of its own, and a namespace reaches only its own. Put the rules that use the namespace in a <style> without ${...}.",
		),
	);
};

/** Where each top-level rule of source[start, end) ends: past the `}` that closes its block, the
 * way a CSS parser cuts them. Text after the last rule joins it, so the last end is `end`. */
export const topLevelRuleEndsOf = (source: string, start: number, end: number): Array<number> => {
	const ruleEnds: Array<number> = [];
	//the closers of the blocks open at index, innermost last; a closer that matches none is text
	const openBlockClosers: Array<number> = [];
	let isInRule = false;
	let index = start;
	while (index < end) {
		const code = source.charCodeAt(index);
		if (isWhitespaceCode(code) || code === FORM_FEED) {
			index++;
			continue;
		}
		if (source.startsWith(COMMENT_OPEN, index)) {
			index = commentEndOf(source, index, end);
			continue;
		}
		if (!isInRule && code === CHARACTER_CODE.AT) ensureNoNamespaceRule(source, index);
		isInRule = true;
		if (isQuoteCode(code)) {
			index = stringEndOf(source, index, end);
			continue;
		}
		if (code === CHARACTER_CODE.BACKSLASH) {
			index += 2;
			continue;
		}
		index++;
		const closer = CLOSER_OF_OPENER.get(code);
		if (closer !== undefined) {
			openBlockClosers.push(closer);
			continue;
		}
		if (code !== openBlockClosers[openBlockClosers.length - 1]) continue;
		openBlockClosers.pop();
		if (openBlockClosers.length > 0 || code !== CHARACTER_CODE.CLOSE_BRACE) continue;
		ruleEnds.push(index);
		isInRule = false;
	}
	if (isInRule || ruleEnds.length === 0) ruleEnds.push(end);
	else ruleEnds[ruleEnds.length - 1] = end;
	return ruleEnds;
};
