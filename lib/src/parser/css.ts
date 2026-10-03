import { CHARACTER_CODE, isQuoteCode, isWhitespaceCode } from "./characters";
import { ValueOf } from "../utils/types";
import { STYLE_SHEET_NOT_COMPILED } from "./constants";
import {
	CompiledStyleSheet,
	DynamicDeclaration,
	Part,
	RuleCountCheck,
} from "./types";
import { assertDuringDevelopment } from "../utils/diagnostics";

type CSSStateKind = ValueOf<typeof CSS_STATE>;

const CSS_STATE = {
	SELECTOR: 50,
	PROPERTY: 51,
	VALUE: 52,
} as const;

type RuleKind = ValueOf<typeof RULE_KIND>;

const RULE_KIND = {
	STYLE: 60,
	GROUPING: 61,
	KEYFRAMES: 62,
	DESCRIPTOR: 63,
} as const;

const NO_OPEN_RUN = -1;
const NOT_A_PROPERTY_NAME: unique symbol = Symbol("not a property name");
const UNSUPPORTED_PRIORITY: unique symbol = Symbol("unsupported priority");
const COMMENT_OPEN = "/*";
const COMMENT_CLOSE = "*/";
const CUSTOM_PROPERTY_PREFIX = "--";

//grouping at-rules nest style rules on an addressable CSSOM block, so a hole inside stays
//updatable; descriptor at-rules (@font-face, @property) fall back in readAtRuleKind's default arm
const FAST_PATH_GROUPING_AT_RULE_NAMES = new Set([
	"media",
	"supports",
	"container",
	"layer",
	"scope",
	"starting-style",
]);
const FAST_PATH_KEYFRAMES_AT_RULE_NAME = "keyframes";

//every branch of the character loop below ignores anything outside this set, and CSS is
//overwhelmingly made of characters that are not in it
const SIGNIFICANT_CODE_LIMIT = 128;
const SIGNIFICANT_CODES = new Uint8Array(SIGNIFICANT_CODE_LIMIT);
for (const code of [
	CHARACTER_CODE.SINGLE_QUOTE,
	CHARACTER_CODE.DOUBLE_QUOTE,
	CHARACTER_CODE.SLASH,
	CHARACTER_CODE.OPEN_PAREN,
	CHARACTER_CODE.CLOSE_PAREN,
	CHARACTER_CODE.OPEN_BRACE,
	CHARACTER_CODE.CLOSE_BRACE,
	CHARACTER_CODE.SEMICOLON,
	CHARACTER_CODE.COLON,
	CHARACTER_CODE.AT,
	CHARACTER_CODE.BANG,
]) {
	SIGNIFICANT_CODES[code] = 1;
}

const isLetterCode = (code: number) =>
	(code >= CHARACTER_CODE.LOWERCASE_A && code <= CHARACTER_CODE.LOWERCASE_Z) ||
	(code >= CHARACTER_CODE.UPPERCASE_A && code <= CHARACTER_CODE.UPPERCASE_Z);

const isDigitCode = (code: number) =>
	code >= CHARACTER_CODE.DIGIT_ZERO && code <= CHARACTER_CODE.DIGIT_NINE;

const isAtRuleNameCode = (code: number) =>
	isLetterCode(code) || code === CHARACTER_CODE.DASH;

const isStandardNameCode = (code: number) =>
	isLetterCode(code) || isDigitCode(code) || code === CHARACTER_CODE.DASH;

const isCustomNameCode = (code: number) =>
	isStandardNameCode(code) || code === CHARACTER_CODE.UNDERSCORE;

const skipWhitespaceAndComments = (raw: string, index: number): number => {
	while (index < raw.length) {
		const code = raw.charCodeAt(index);
		if (isWhitespaceCode(code)) {
			index++;
			continue;
		}
		if (!raw.startsWith(COMMENT_OPEN, index)) return index;
		const commentClose = raw.indexOf(
			COMMENT_CLOSE,
			index + COMMENT_OPEN.length,
		);
		if (commentClose === -1) return raw.length;
		index = commentClose + COMMENT_CLOSE.length;
	}
	return index;
};

const findClosingQuoteIndex = (
	raw: string,
	openingQuoteIndex: number,
): number => {
	const quote = raw[openingQuoteIndex];
	let searchIndex = openingQuoteIndex + 1;
	while (searchIndex < raw.length) {
		const closingIndex = raw.indexOf(quote, searchIndex);
		if (closingIndex === -1) return -1;

		let backslashCount = 0;
		let scanIndex = closingIndex - 1;
		while (
			scanIndex > openingQuoteIndex &&
			raw.charCodeAt(scanIndex) === CHARACTER_CODE.BACKSLASH
		) {
			backslashCount++;
			scanIndex--;
		}
		if (backslashCount % 2 === 0) return closingIndex;
		searchIndex = closingIndex + 1;
	}
	return -1;
};

//the declaration's value can span holes, so the name is read back from the part it was
//written in rather than sliced out at the colon
const normalizePropertyName = (
	raw: string,
	nameStart: number,
	nameEnd: number,
): string | typeof NOT_A_PROPERTY_NAME => {
	const start = skipWhitespaceAndComments(raw, nameStart);
	const isCustom = raw.startsWith(CUSTOM_PROPERTY_PREFIX, start);

	let end: number;
	let name: string;
	if (isCustom) {
		const nameTailStart = start + CUSTOM_PROPERTY_PREFIX.length;
		end = nameTailStart;
		while (isCustomNameCode(raw.charCodeAt(end))) end++;
		const hasNameTail = end > nameTailStart;
		if (!hasNameTail) return NOT_A_PROPERTY_NAME;
		name = raw.slice(start, end);
	} else {
		let head = start;
		if (raw.charCodeAt(head) === CHARACTER_CODE.DASH) head++;
		if (!isLetterCode(raw.charCodeAt(head))) return NOT_A_PROPERTY_NAME;
		end = head + 1;
		while (isStandardNameCode(raw.charCodeAt(end))) end++;
		name = raw.slice(start, end).toLowerCase();
	}

	if (skipWhitespaceAndComments(raw, end) < nameEnd) return NOT_A_PROPERTY_NAME;
	return name;
};

interface RuleFrame {
	kind: RuleKind;
	rulePath: Array<number>;
	childRuleCount: number;
	doDeclarationsCreateRuns: boolean;
	openRunIndex: number;
	isInsideStyleRule: boolean;
	isInsideDescriptor: boolean;
	isOnDynamicPath: boolean;
	declaredPropertyNames: Set<string>;
	holedPropertyNames: Set<string>;
}

//scan helpers write this struct and its rule frames directly: returning several cursor fields costs
//an object per declaration or one loop of every scanner. Parsing runs once per template
interface CSSParserState {
	scanState: CSSStateKind;
	characterIndex: number;
	splitIndex: number;
	parenDepth: number;
	pendingRuleKind: RuleKind;
	propertyStartIndex: number;
	propertyNamePart: string;
	propertyNameStart: number;
	propertyNameEnd: number;
	valueTopLevelBangCount: number;
	valueBuffer: Array<Part>;
	ruleStack: Array<RuleFrame>;
	dynamicDeclarations: Array<DynamicDeclaration>;
	ruleCountChecks: Array<RuleCountCheck>;
}

type EnclosingRuleContext = Pick<
	RuleFrame,
	"kind" | "isInsideStyleRule" | "isInsideDescriptor"
>;

const OUTSIDE_EVERY_RULE: Readonly<EnclosingRuleContext> = {
	kind: RULE_KIND.GROUPING,
	isInsideStyleRule: false,
	isInsideDescriptor: false,
};

const createRuleFrame = (
	kind: RuleKind,
	rulePath: Array<number>,
	parent: EnclosingRuleContext,
): RuleFrame => {
	const isInsideStyleRule =
		parent.kind === RULE_KIND.STYLE || parent.isInsideStyleRule;
	return {
		kind,
		rulePath,
		childRuleCount: 0,
		doDeclarationsCreateRuns: kind === RULE_KIND.GROUPING && isInsideStyleRule,
		openRunIndex: NO_OPEN_RUN,
		isInsideStyleRule,
		isInsideDescriptor:
			kind === RULE_KIND.DESCRIPTOR || parent.isInsideDescriptor,
		isOnDynamicPath: false,
		declaredPropertyNames: new Set(),
		holedPropertyNames: new Set(),
	};
};

const createCSSParser = (): CSSParserState => ({
	scanState: CSS_STATE.SELECTOR,
	characterIndex: 0,
	splitIndex: 0,
	parenDepth: 0,
	pendingRuleKind: RULE_KIND.STYLE,
	propertyStartIndex: 0,
	propertyNamePart: "",
	propertyNameStart: 0,
	propertyNameEnd: 0,
	valueTopLevelBangCount: 0,
	valueBuffer: [],
	ruleStack: [createRuleFrame(RULE_KIND.GROUPING, [], OUTSIDE_EVERY_RULE)],
	dynamicDeclarations: [],
	ruleCountChecks: [],
});

const readAtRuleName = (part: string, atIndex: number): string => {
	let endIndex = atIndex + 1;
	while (endIndex < part.length && isAtRuleNameCode(part.charCodeAt(endIndex)))
		endIndex++;
	return part.slice(atIndex + 1, endIndex).toLowerCase();
};

const readAtRuleKind = (part: string, atIndex: number): RuleKind => {
	const name = readAtRuleName(part, atIndex);
	if (FAST_PATH_GROUPING_AT_RULE_NAMES.has(name)) return RULE_KIND.GROUPING;
	if (name === FAST_PATH_KEYFRAMES_AT_RULE_NAME) return RULE_KIND.KEYFRAMES;
	return RULE_KIND.DESCRIPTOR;
};

const appendStaticValueSlice = (
	parser: CSSParserState,
	part: string,
	end: number,
) => {
	if (end <= parser.splitIndex) return;
	parser.valueBuffer.push(part.slice(parser.splitIndex, end));
};

const activeFrame = (parser: CSSParserState): RuleFrame =>
	parser.ruleStack[parser.ruleStack.length - 1];

//setProperty replaces a rule's whole entry for a property, so a duplicate of a holed
//property inside one rule would let an update defeat the cascade order the author wrote
const claimStaticProperty = (
	frame: RuleFrame,
	propertyName: string,
): boolean => {
	if (frame.declaredPropertyNames.has(propertyName))
		return !frame.holedPropertyNames.has(propertyName);
	frame.declaredPropertyNames.add(propertyName);
	return true;
};

const claimHoledProperty = (
	frame: RuleFrame,
	propertyName: string,
): boolean => {
	if (frame.declaredPropertyNames.has(propertyName)) return false;
	frame.declaredPropertyNames.add(propertyName);
	frame.holedPropertyNames.add(propertyName);
	return true;
};

const recordChildRule = (frame: RuleFrame): void => {
	frame.childRuleCount++;
	frame.openRunIndex = NO_OPEN_RUN;
	if (frame.kind === RULE_KIND.STYLE) frame.doDeclarationsCreateRuns = true;
};

const resetDeclaration = (parser: CSSParserState) => {
	parser.valueBuffer.length = 0;
	parser.valueTopLevelBangCount = 0;
	parser.scanState = CSS_STATE.PROPERTY;
};

//CSSOM takes priority as a separate setProperty argument, so a trailing !important is
//split off the value parts here
const splitTrailingImportantPriority = (
	parser: CSSParserState,
): string | typeof UNSUPPORTED_PRIORITY => {
	const topLevelBangCount = parser.valueTopLevelBangCount;
	const hasNoImportant = topLevelBangCount === 0;
	if (hasNoImportant) return "";
	const hasAmbiguousBangs = topLevelBangCount > 1;
	if (hasAmbiguousBangs) return UNSUPPORTED_PRIORITY;

	const valueParts = parser.valueBuffer;
	const lastValuePart = valueParts[valueParts.length - 1];
	const bangSitsInHole = typeof lastValuePart !== "string";
	if (bangSitsInHole) return UNSUPPORTED_PRIORITY;

	const bangIndex = lastValuePart.lastIndexOf("!");
	const keywordAfterBang = lastValuePart
		.slice(bangIndex + 1)
		.trim()
		.toLowerCase();
	const isImportant = bangIndex !== -1 && keywordAfterBang === "important";
	if (!isImportant) return UNSUPPORTED_PRIORITY;

	const valueBeforeBang = lastValuePart.slice(0, bangIndex);
	if (valueBeforeBang === "") valueParts.pop();
	else valueParts[valueParts.length - 1] = valueBeforeBang;
	return "important";
};

const isHole = (part: Part): part is number => typeof part === "number";

const completeDeclaration = (parser: CSSParserState): boolean => {
	const frame = activeFrame(parser);
	if (frame.isInsideDescriptor) {
		resetDeclaration(parser);
		return true;
	}
	const opensRun =
		frame.doDeclarationsCreateRuns && frame.openRunIndex === NO_OPEN_RUN;
	if (opensRun) frame.openRunIndex = frame.childRuleCount++;
	const valueHasHole = parser.valueBuffer.some(isHole);
	const isDeclarationHolder =
		frame.kind === RULE_KIND.STYLE || frame.doDeclarationsCreateRuns;
	const propertyName = isDeclarationHolder
		? normalizePropertyName(
				parser.propertyNamePart,
				parser.propertyNameStart,
				parser.propertyNameEnd,
			)
		: NOT_A_PROPERTY_NAME;
	//nothing here a setProperty could ever address; a hole that lands on it cannot compile,
	//and without one there is nothing to keep
	if (propertyName === NOT_A_PROPERTY_NAME) {
		if (valueHasHole) return false;
		resetDeclaration(parser);
		return true;
	}
	if (!valueHasHole) {
		if (!claimStaticProperty(frame, propertyName)) return false;
		resetDeclaration(parser);
		return true;
	}
	if (!claimHoledProperty(frame, propertyName)) return false;
	const priority = splitTrailingImportantPriority(parser);
	if (priority === UNSUPPORTED_PRIORITY) return false;
	parser.dynamicDeclarations.push({
		rulePath:
			frame.openRunIndex === NO_OPEN_RUN
				? frame.rulePath
				: frame.rulePath.concat(frame.openRunIndex),
		propertyName,
		priority,
		valueParts: parser.valueBuffer.slice(),
	});
	const ruleStack = parser.ruleStack;
	for (let index = 0; index < ruleStack.length - 1; index++)
		ruleStack[index].isOnDynamicPath = true;
	if (frame.doDeclarationsCreateRuns) frame.isOnDynamicPath = true;
	resetDeclaration(parser);
	return true;
};

export const compileStyleSheet = (
	parts: Array<Part>,
): CompiledStyleSheet | typeof STYLE_SHEET_NOT_COMPILED => {
	const parser = createCSSParser();

	for (let partIndex = 0; partIndex < parts.length; partIndex++) {
		const part = parts[partIndex];
		if (typeof part === "number") {
			const isDeclarationValueHole =
				parser.scanState === CSS_STATE.VALUE &&
				!activeFrame(parser).isInsideDescriptor;
			if (!isDeclarationValueHole) return STYLE_SHEET_NOT_COMPILED;
			parser.valueBuffer.push(part);
			continue;
		}

		parser.splitIndex = 0;
		parser.propertyStartIndex = 0;
		for (
			parser.characterIndex = 0;
			parser.characterIndex < part.length;
			parser.characterIndex++
		) {
			const code = part.charCodeAt(parser.characterIndex);
			const isInsignificant =
				code >= SIGNIFICANT_CODE_LIMIT || SIGNIFICANT_CODES[code] === 0;
			if (isInsignificant) continue;

			//a string or a comment left open by this part can never compile: whatever follows
			//is either a hole outside a value or the end of a sheet that never left the rule
			if (isQuoteCode(code)) {
				const closingQuote = findClosingQuoteIndex(part, parser.characterIndex);
				if (closingQuote === -1) return STYLE_SHEET_NOT_COMPILED;
				parser.characterIndex = closingQuote;
				continue;
			}
			if (code === CHARACTER_CODE.SLASH) {
				if (!part.startsWith(COMMENT_OPEN, parser.characterIndex)) continue;
				const commentClose = part.indexOf(
					COMMENT_CLOSE,
					parser.characterIndex + COMMENT_OPEN.length,
				);
				if (commentClose === -1) return STYLE_SHEET_NOT_COMPILED;
				//on the closing "/", which the loop's own step moves past
				parser.characterIndex = commentClose + COMMENT_CLOSE.length - 1;
				continue;
			}
			if (code === CHARACTER_CODE.OPEN_PAREN) {
				parser.parenDepth++;
				continue;
			}
			if (parser.parenDepth > 0) {
				if (code === CHARACTER_CODE.CLOSE_PAREN) parser.parenDepth--;
				continue;
			}

			switch (code) {
				case CHARACTER_CODE.OPEN_BRACE: {
					if (parser.scanState === CSS_STATE.VALUE)
						return STYLE_SHEET_NOT_COMPILED;
					const parent = activeFrame(parser);
					const ruleIndex = parent.childRuleCount;
					recordChildRule(parent);
					const kind = parser.pendingRuleKind;
					parser.ruleStack.push(
						createRuleFrame(kind, parent.rulePath.concat(ruleIndex), parent),
					);
					parser.pendingRuleKind = RULE_KIND.STYLE;
					parser.scanState = CSS_STATE.PROPERTY;
					parser.propertyStartIndex = parser.characterIndex + 1;
					break;
				}
				case CHARACTER_CODE.CLOSE_BRACE: {
					if (parser.scanState === CSS_STATE.VALUE) {
						appendStaticValueSlice(parser, part, parser.characterIndex);
						if (!completeDeclaration(parser)) return STYLE_SHEET_NOT_COMPILED;
					}
					if (parser.ruleStack.length === 1) return STYLE_SHEET_NOT_COMPILED;
					const closedFrame = parser.ruleStack.pop();
					assertDuringDevelopment(
						closedFrame !== undefined,
						"a rule stack deeper than its root frame has a frame to close",
					);
					if (closedFrame.isOnDynamicPath)
						parser.ruleCountChecks.push({
							rulePath: closedFrame.rulePath,
							expectedRuleCount: closedFrame.childRuleCount,
						});
					parser.scanState =
						parser.ruleStack.length === 1
							? CSS_STATE.SELECTOR
							: CSS_STATE.PROPERTY;
					parser.propertyStartIndex = parser.characterIndex + 1;
					break;
				}
				case CHARACTER_CODE.SEMICOLON:
					if (parser.scanState === CSS_STATE.VALUE) {
						appendStaticValueSlice(parser, part, parser.characterIndex);
						if (!completeDeclaration(parser)) return STYLE_SHEET_NOT_COMPILED;
					}
					if (parser.pendingRuleKind !== RULE_KIND.STYLE) {
						recordChildRule(activeFrame(parser));
						parser.pendingRuleKind = RULE_KIND.STYLE;
					}
					parser.propertyStartIndex = parser.characterIndex + 1;
					break;
				case CHARACTER_CODE.COLON:
					if (parser.scanState === CSS_STATE.PROPERTY) {
						parser.propertyNamePart = part;
						parser.propertyNameStart = parser.propertyStartIndex;
						parser.propertyNameEnd = parser.characterIndex;
						parser.scanState = CSS_STATE.VALUE;
						parser.splitIndex = parser.characterIndex + 1;
					}
					break;
				case CHARACTER_CODE.AT:
					if (parser.scanState !== CSS_STATE.VALUE)
						parser.pendingRuleKind = readAtRuleKind(
							part,
							parser.characterIndex,
						);
					break;
				case CHARACTER_CODE.BANG:
					if (parser.scanState === CSS_STATE.VALUE)
						parser.valueTopLevelBangCount++;
					break;
			}
		}
		if (parser.scanState === CSS_STATE.VALUE)
			appendStaticValueSlice(parser, part, part.length);
	}

	const endedCleanly =
		parser.scanState === CSS_STATE.SELECTOR &&
		parser.ruleStack.length === 1 &&
		parser.parenDepth === 0;
	if (!endedCleanly) return STYLE_SHEET_NOT_COMPILED;
	if (parser.dynamicDeclarations.length === 0) return STYLE_SHEET_NOT_COMPILED;
	const sheetRoot = parser.ruleStack[0];
	parser.ruleCountChecks.push({
		rulePath: sheetRoot.rulePath,
		expectedRuleCount: sheetRoot.childRuleCount,
	});
	return {
		dynamicDeclarations: parser.dynamicDeclarations,
		ruleCountChecks: parser.ruleCountChecks,
	};
};
