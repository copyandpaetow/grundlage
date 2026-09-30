import { CHAR_CODE, isQuoteCode, isWhitespaceCode } from "./chars";
import { ValueOf } from "../utils/types";
import { STYLE_SHEET_NOT_COMPILED } from "./constants";
import {
	CompiledStyleSheet,
	DynamicDeclaration,
	Part,
	RuleCountCheck,
} from "./types";
import { assertDuringDevelopment } from "../utils/diagnostics";

type CssStateValue = ValueOf<typeof CSS_STATE>;

const CSS_STATE = {
	SELECTOR: 50,
	PROPERTY: 51,
	VALUE: 52,
} as const;

type RuleKindValue = ValueOf<typeof RULE_KIND>;

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
const LAST_SIGNIFICANT_CODE = 128;
const SIGNIFICANT_CODES = new Uint8Array(LAST_SIGNIFICANT_CODE);
for (const code of [
	CHAR_CODE.SINGLE_QUOTE,
	CHAR_CODE.DOUBLE_QUOTE,
	CHAR_CODE.SLASH,
	CHAR_CODE.OPEN_PAREN,
	CHAR_CODE.CLOSE_PAREN,
	CHAR_CODE.OPEN_BRACE,
	CHAR_CODE.CLOSE_BRACE,
	CHAR_CODE.SEMICOLON,
	CHAR_CODE.COLON,
	CHAR_CODE.AT,
	CHAR_CODE.BANG,
]) {
	SIGNIFICANT_CODES[code] = 1;
}

const isLetterCode = (code: number) =>
	(code >= CHAR_CODE.LOWERCASE_A && code <= CHAR_CODE.LOWERCASE_Z) ||
	(code >= CHAR_CODE.UPPERCASE_A && code <= CHAR_CODE.UPPERCASE_Z);

const isDigitCode = (code: number) =>
	code >= CHAR_CODE.DIGIT_ZERO && code <= CHAR_CODE.DIGIT_NINE;

const isAtRuleNameCode = (code: number) =>
	isLetterCode(code) || code === CHAR_CODE.DASH;

const isStandardNameCode = (code: number) =>
	isLetterCode(code) || isDigitCode(code) || code === CHAR_CODE.DASH;

const isCustomNameCode = (code: number) =>
	isStandardNameCode(code) || code === CHAR_CODE.UNDERSCORE;

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
			raw.charCodeAt(scanIndex) === CHAR_CODE.BACKSLASH
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
		if (raw.charCodeAt(head) === CHAR_CODE.DASH) head++;
		if (!isLetterCode(raw.charCodeAt(head))) return NOT_A_PROPERTY_NAME;
		end = head + 1;
		while (isStandardNameCode(raw.charCodeAt(end))) end++;
		name = raw.slice(start, end).toLowerCase();
	}

	if (skipWhitespaceAndComments(raw, end) < nameEnd) return NOT_A_PROPERTY_NAME;
	return name;
};

interface RuleFrame {
	kind: RuleKindValue;
	rulePath: Array<number>;
	childRuleCount: number;
	declarationsCreateRuns: boolean;
	openRunIndex: number;
	isInsideStyleRule: boolean;
	isInsideDescriptor: boolean;
	isOnDynamicPath: boolean;
	declaredPropertyNames: Set<string>;
	holedPropertyNames: Set<string>;
}

//scan helpers write this struct and its rule frames directly: returning several cursor fields costs
//an object per declaration or one loop of every scanner. Parsing runs once per template
interface CssParserState {
	state: CssStateValue;
	charIndex: number;
	splitIndex: number;
	parenDepth: number;
	pendingRuleKind: RuleKindValue;
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
	kind: RuleKindValue,
	rulePath: Array<number>,
	parent: EnclosingRuleContext,
): RuleFrame => {
	const isInsideStyleRule =
		parent.kind === RULE_KIND.STYLE || parent.isInsideStyleRule;
	return {
		kind,
		rulePath,
		childRuleCount: 0,
		declarationsCreateRuns: kind === RULE_KIND.GROUPING && isInsideStyleRule,
		openRunIndex: NO_OPEN_RUN,
		isInsideStyleRule,
		isInsideDescriptor:
			kind === RULE_KIND.DESCRIPTOR || parent.isInsideDescriptor,
		isOnDynamicPath: false,
		declaredPropertyNames: new Set(),
		holedPropertyNames: new Set(),
	};
};

const createCssParser = (): CssParserState => ({
	state: CSS_STATE.SELECTOR,
	charIndex: 0,
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

const readAtRuleKind = (part: string, atIndex: number): RuleKindValue => {
	const name = readAtRuleName(part, atIndex);
	if (FAST_PATH_GROUPING_AT_RULE_NAMES.has(name)) return RULE_KIND.GROUPING;
	if (name === FAST_PATH_KEYFRAMES_AT_RULE_NAME) return RULE_KIND.KEYFRAMES;
	return RULE_KIND.DESCRIPTOR;
};

const captureStaticValueText = (
	parser: CssParserState,
	part: string,
	end: number,
) => {
	if (end <= parser.splitIndex) return;
	parser.valueBuffer.push(part.slice(parser.splitIndex, end));
};

const activeFrame = (parser: CssParserState): RuleFrame =>
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

const registerChildRule = (frame: RuleFrame): void => {
	frame.childRuleCount++;
	frame.openRunIndex = NO_OPEN_RUN;
	if (frame.kind === RULE_KIND.STYLE) frame.declarationsCreateRuns = true;
};

const resetDeclaration = (parser: CssParserState) => {
	parser.valueBuffer.length = 0;
	parser.valueTopLevelBangCount = 0;
	parser.state = CSS_STATE.PROPERTY;
};

//CSSOM takes priority as a separate setProperty argument, so a trailing !important is
//split off the value parts here
const splitTrailingImportantPriority = (
	parser: CssParserState,
): string | typeof UNSUPPORTED_PRIORITY => {
	const topLevelBangCount = parser.valueTopLevelBangCount;
	const hasNoImportant = topLevelBangCount === 0;
	if (hasNoImportant) return "";
	const hasAmbiguousBangs = topLevelBangCount > 1;
	if (hasAmbiguousBangs) return UNSUPPORTED_PRIORITY;

	const valueParts = parser.valueBuffer;
	const lastValuePart = valueParts[valueParts.length - 1];
	const bangSitsInAHole = typeof lastValuePart !== "string";
	if (bangSitsInAHole) return UNSUPPORTED_PRIORITY;

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

const finishDeclarationValue = (parser: CssParserState): boolean => {
	const frame = activeFrame(parser);
	if (frame.isInsideDescriptor) {
		resetDeclaration(parser);
		return true;
	}
	const opensRun =
		frame.declarationsCreateRuns && frame.openRunIndex === NO_OPEN_RUN;
	if (opensRun) frame.openRunIndex = frame.childRuleCount++;
	const valueHasHole = parser.valueBuffer.some(isHole);
	const isDeclarationHolder =
		frame.kind === RULE_KIND.STYLE || frame.declarationsCreateRuns;
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
	if (frame.declarationsCreateRuns) frame.isOnDynamicPath = true;
	resetDeclaration(parser);
	return true;
};

export const compileStyleSheet = (
	parts: Array<Part>,
): CompiledStyleSheet | typeof STYLE_SHEET_NOT_COMPILED => {
	const parser = createCssParser();

	for (let partIndex = 0; partIndex < parts.length; partIndex++) {
		const part = parts[partIndex];
		if (typeof part === "number") {
			const isDeclarationValueHole =
				parser.state === CSS_STATE.VALUE &&
				!activeFrame(parser).isInsideDescriptor;
			if (!isDeclarationValueHole) return STYLE_SHEET_NOT_COMPILED;
			parser.valueBuffer.push(part);
			continue;
		}

		parser.splitIndex = 0;
		parser.propertyStartIndex = 0;
		for (
			parser.charIndex = 0;
			parser.charIndex < part.length;
			parser.charIndex++
		) {
			const code = part.charCodeAt(parser.charIndex);
			const isInsignificant =
				code >= LAST_SIGNIFICANT_CODE || SIGNIFICANT_CODES[code] === 0;
			if (isInsignificant) continue;

			//a string or a comment left open by this part can never compile: whatever follows
			//is either a hole outside a value or the end of a sheet that never left the rule
			if (isQuoteCode(code)) {
				const closingQuote = findClosingQuoteIndex(part, parser.charIndex);
				if (closingQuote === -1) return STYLE_SHEET_NOT_COMPILED;
				parser.charIndex = closingQuote;
				continue;
			}
			if (code === CHAR_CODE.SLASH) {
				if (!part.startsWith(COMMENT_OPEN, parser.charIndex)) continue;
				const commentClose = part.indexOf(
					COMMENT_CLOSE,
					parser.charIndex + COMMENT_OPEN.length,
				);
				if (commentClose === -1) return STYLE_SHEET_NOT_COMPILED;
				//on the closing "/", which the loop's own step moves past
				parser.charIndex = commentClose + COMMENT_CLOSE.length - 1;
				continue;
			}
			if (code === CHAR_CODE.OPEN_PAREN) {
				parser.parenDepth++;
				continue;
			}
			if (parser.parenDepth > 0) {
				if (code === CHAR_CODE.CLOSE_PAREN) parser.parenDepth--;
				continue;
			}

			switch (code) {
				case CHAR_CODE.OPEN_BRACE: {
					if (parser.state === CSS_STATE.VALUE) return STYLE_SHEET_NOT_COMPILED;
					const parent = activeFrame(parser);
					const ruleIndex = parent.childRuleCount;
					registerChildRule(parent);
					const kind = parser.pendingRuleKind;
					parser.ruleStack.push(
						createRuleFrame(kind, parent.rulePath.concat(ruleIndex), parent),
					);
					parser.pendingRuleKind = RULE_KIND.STYLE;
					parser.state = CSS_STATE.PROPERTY;
					parser.propertyStartIndex = parser.charIndex + 1;
					break;
				}
				case CHAR_CODE.CLOSE_BRACE: {
					if (parser.state === CSS_STATE.VALUE) {
						captureStaticValueText(parser, part, parser.charIndex);
						if (!finishDeclarationValue(parser))
							return STYLE_SHEET_NOT_COMPILED;
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
					parser.state =
						parser.ruleStack.length === 1
							? CSS_STATE.SELECTOR
							: CSS_STATE.PROPERTY;
					parser.propertyStartIndex = parser.charIndex + 1;
					break;
				}
				case CHAR_CODE.SEMICOLON:
					if (parser.state === CSS_STATE.VALUE) {
						captureStaticValueText(parser, part, parser.charIndex);
						if (!finishDeclarationValue(parser))
							return STYLE_SHEET_NOT_COMPILED;
					}
					if (parser.pendingRuleKind !== RULE_KIND.STYLE) {
						registerChildRule(activeFrame(parser));
						parser.pendingRuleKind = RULE_KIND.STYLE;
					}
					parser.propertyStartIndex = parser.charIndex + 1;
					break;
				case CHAR_CODE.COLON:
					if (parser.state === CSS_STATE.PROPERTY) {
						parser.propertyNamePart = part;
						parser.propertyNameStart = parser.propertyStartIndex;
						parser.propertyNameEnd = parser.charIndex;
						parser.state = CSS_STATE.VALUE;
						parser.splitIndex = parser.charIndex + 1;
					}
					break;
				case CHAR_CODE.AT:
					if (parser.state !== CSS_STATE.VALUE)
						parser.pendingRuleKind = readAtRuleKind(part, parser.charIndex);
					break;
				case CHAR_CODE.BANG:
					if (parser.state === CSS_STATE.VALUE) parser.valueTopLevelBangCount++;
					break;
			}
		}
		if (parser.state === CSS_STATE.VALUE)
			captureStaticValueText(parser, part, part.length);
	}

	const endedCleanly =
		parser.state === CSS_STATE.SELECTOR &&
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
