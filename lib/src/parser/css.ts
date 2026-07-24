import { CHAR_CODE, isQuoteCode, isWhitespaceCode } from "./chars";
import { ValueOf } from "../utils/types";
import {
	CompiledStyleSheet,
	DynamicDeclaration,
	Part,
	RuleCountCheck,
} from "./types";

type CssStateValue = ValueOf<typeof CSS_STATE>;

const CSS_STATE = {
	SELECTOR: 0,
	PROPERTY: 1,
	VALUE: 2,
	STRING: 3,
	COMMENT: 4,
} as const;

type RuleKindValue = ValueOf<typeof RULE_KIND>;

const RULE_KIND = {
	STYLE: 0,
	GROUPING: 1,
	KEYFRAMES: 2,
	DESCRIPTOR: 3,
} as const;

const NO_OPEN_RUN = -1;

//grouping at-rules keep the fast path: they nest style rules whose declarations land on an
//addressable CSSOM block, so a hole inside stays updatable — unlike descriptor at-rules
//(@font-face, @property, …), which the default arm of readAtRuleKind drops to the fallback
const FAST_PATH_GROUPING_AT_RULE_NAMES = new Set([
	"media",
	"supports",
	"container",
	"layer",
	"scope",
	"starting-style",
]);
const FAST_PATH_KEYFRAMES_AT_RULE_NAME = "keyframes";

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
	for (;;) {
		const code = raw.charCodeAt(index);
		if (isWhitespaceCode(code)) {
			index++;
			continue;
		}
		const opensComment =
			code === CHAR_CODE.SLASH &&
			raw.charCodeAt(index + 1) === CHAR_CODE.ASTERISK;
		if (!opensComment) return index;
		index += 2;
		while (
			index < raw.length &&
			!(
				raw.charCodeAt(index) === CHAR_CODE.ASTERISK &&
				raw.charCodeAt(index + 1) === CHAR_CODE.SLASH
			)
		)
			index++;
		index += 2;
	}
};

const normalizePropertyName = (raw: string): string | null => {
	const start = skipWhitespaceAndComments(raw, 0);
	const isCustom =
		raw.charCodeAt(start) === CHAR_CODE.DASH &&
		raw.charCodeAt(start + 1) === CHAR_CODE.DASH;

	let end: number;
	let name: string;
	if (isCustom) {
		end = start + 2;
		while (isCustomNameCode(raw.charCodeAt(end))) end++;
		if (end === start + 2) return null; //"--" needs at least one tail character
		name = raw.slice(start, end);
	} else {
		let head = start;
		if (raw.charCodeAt(head) === CHAR_CODE.DASH) head++;
		if (!isLetterCode(raw.charCodeAt(head))) return null;
		end = head + 1;
		while (isStandardNameCode(raw.charCodeAt(end))) end++;
		name = raw.slice(start, end).toLowerCase();
	}

	if (skipWhitespaceAndComments(raw, end) < raw.length) return null;
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
	declaredProperties: Map<string, boolean> | null;
}

interface CssParserState {
	state: CssStateValue;
	returnState: CssStateValue;
	quoteCode: number;
	activeTemplate: string;
	charIndex: number;
	splitIndex: number;
	parenDepth: number;
	pendingRuleKind: RuleKindValue;
	propertyStartIndex: number;
	activePropertyName: string;
	valueHasHole: boolean;
	valueTopLevelBangCount: number;
	valueBuffer: Array<Part>;
	ruleStack: Array<RuleFrame>;
	dynamicDeclarations: Array<DynamicDeclaration>;
	ruleCountChecks: Array<RuleCountCheck>;
}

const createCssParser = (): CssParserState => ({
	state: CSS_STATE.SELECTOR,
	returnState: CSS_STATE.SELECTOR,
	quoteCode: 0,
	activeTemplate: "",
	charIndex: 0,
	splitIndex: 0,
	parenDepth: 0,
	pendingRuleKind: RULE_KIND.STYLE,
	propertyStartIndex: 0,
	activePropertyName: "",
	valueHasHole: false,
	valueTopLevelBangCount: 0,
	valueBuffer: [],
	ruleStack: [],
	dynamicDeclarations: [],
	ruleCountChecks: [],
});

const createSheetRootFrame = (): RuleFrame => ({
	kind: RULE_KIND.GROUPING,
	rulePath: [],
	childRuleCount: 0,
	declarationsCreateRuns: false,
	openRunIndex: NO_OPEN_RUN,
	isInsideStyleRule: false,
	isInsideDescriptor: false,
	isOnDynamicPath: false,
	declaredProperties: null,
});

const resetCssParser = (parser: CssParserState) => {
	parser.state = CSS_STATE.SELECTOR;
	parser.returnState = CSS_STATE.SELECTOR;
	parser.quoteCode = 0;
	parser.activeTemplate = "";
	parser.charIndex = 0;
	parser.splitIndex = 0;
	parser.parenDepth = 0;
	parser.pendingRuleKind = RULE_KIND.STYLE;
	parser.propertyStartIndex = 0;
	parser.activePropertyName = "";
	parser.valueHasHole = false;
	parser.valueTopLevelBangCount = 0;
	parser.valueBuffer.length = 0;
	parser.ruleStack.length = 0;
	parser.ruleStack.push(createSheetRootFrame());
	parser.dynamicDeclarations = [];
	parser.ruleCountChecks = [];
};

const readAtRuleName = (parser: CssParserState): string => {
	const staticText = parser.activeTemplate;
	let endIndex = parser.charIndex + 1;
	while (
		endIndex < staticText.length &&
		isAtRuleNameCode(staticText.charCodeAt(endIndex))
	)
		endIndex++;
	return staticText.slice(parser.charIndex + 1, endIndex).toLowerCase();
};

const readAtRuleKind = (parser: CssParserState): RuleKindValue => {
	const name = readAtRuleName(parser);
	if (FAST_PATH_GROUPING_AT_RULE_NAMES.has(name)) return RULE_KIND.GROUPING;
	if (name === FAST_PATH_KEYFRAMES_AT_RULE_NAME) return RULE_KIND.KEYFRAMES;
	return RULE_KIND.DESCRIPTOR;
};

const captureStaticValueText = (parser: CssParserState, end: number) => {
	if (end <= parser.splitIndex) return;
	parser.valueBuffer.push(parser.activeTemplate.slice(parser.splitIndex, end));
};

const activeFrame = (parser: CssParserState): RuleFrame =>
	parser.ruleStack[parser.ruleStack.length - 1];

const createRuleFrame = (
	parser: CssParserState,
	parent: RuleFrame,
	ruleIndex: number,
): RuleFrame => {
	const kind = parser.pendingRuleKind;
	const isInsideStyleRule =
		parent.kind === RULE_KIND.STYLE || parent.isInsideStyleRule;
	return {
		kind,
		rulePath: parent.rulePath.concat(ruleIndex),
		childRuleCount: 0,
		declarationsCreateRuns: kind === RULE_KIND.GROUPING && isInsideStyleRule,
		openRunIndex: NO_OPEN_RUN,
		isInsideStyleRule,
		isInsideDescriptor:
			kind === RULE_KIND.DESCRIPTOR || parent.isInsideDescriptor,
		isOnDynamicPath: false,
		declaredProperties: null,
	};
};

//setProperty replaces a rule's whole entry for a property, so a duplicate of a holed
//property inside one rule would let an update defeat the cascade order the author wrote
const registerDeclaredProperty = (
	frame: RuleFrame,
	propertyName: string,
	hasHole: boolean,
): boolean => {
	const declaredProperties = (frame.declaredProperties ??= new Map());
	const existingHasHole = declaredProperties.get(propertyName);
	if (existingHasHole === undefined) {
		declaredProperties.set(propertyName, hasHole);
		return true;
	}
	return !hasHole && existingHasHole === false;
};

const registerChildRule = (frame: RuleFrame): number => {
	const ruleIndex = frame.childRuleCount++;
	frame.openRunIndex = NO_OPEN_RUN;
	if (frame.kind === RULE_KIND.STYLE) frame.declarationsCreateRuns = true;
	return ruleIndex;
};

const markDynamicPath = (parser: CssParserState, holderFrame: RuleFrame) => {
	const ruleStack = parser.ruleStack;
	for (let index = 0; index < ruleStack.length - 1; index++)
		ruleStack[index].isOnDynamicPath = true;
	if (holderFrame.declarationsCreateRuns) holderFrame.isOnDynamicPath = true;
};

const resetDeclaration = (parser: CssParserState) => {
	parser.valueBuffer.length = 0;
	parser.valueHasHole = false;
	parser.valueTopLevelBangCount = 0;
	parser.state = CSS_STATE.PROPERTY;
};

//CSSOM takes priority as a separate setProperty argument, so a trailing !important is
//split off the value parts here — returns the priority ("important" or none), or null to bail
const splitTrailingImportantPriority = (
	parser: CssParserState,
): string | null => {
	const topLevelBangCount = parser.valueTopLevelBangCount;
	const hasNoImportant = topLevelBangCount === 0;
	if (hasNoImportant) return "";
	const hasAmbiguousBangs = topLevelBangCount > 1;
	if (hasAmbiguousBangs) return null;

	const valueParts = parser.valueBuffer;
	const lastValuePart = valueParts[valueParts.length - 1];
	const bangSitsInAHole = typeof lastValuePart !== "string";
	if (bangSitsInAHole) return null;

	const bangIndex = lastValuePart.lastIndexOf("!");
	const keywordAfterBang = lastValuePart
		.slice(bangIndex + 1)
		.trim()
		.toLowerCase();
	const isImportant = bangIndex !== -1 && keywordAfterBang === "important";
	if (!isImportant) return null;

	const valueBeforeBang = lastValuePart.slice(0, bangIndex);
	if (valueBeforeBang === "") valueParts.pop();
	else valueParts[valueParts.length - 1] = valueBeforeBang;
	return "important";
};

const finishDeclarationValue = (parser: CssParserState): boolean => {
	const frame = activeFrame(parser);
	if (frame.isInsideDescriptor) {
		resetDeclaration(parser);
		return true;
	}
	const isDeclarationHolder =
		frame.kind === RULE_KIND.STYLE || frame.declarationsCreateRuns;
	if (!isDeclarationHolder) {
		if (parser.valueHasHole) return false;
		resetDeclaration(parser);
		return true;
	}
	if (frame.declarationsCreateRuns && frame.openRunIndex === NO_OPEN_RUN)
		frame.openRunIndex = frame.childRuleCount++;
	const propertyName = normalizePropertyName(parser.activePropertyName);
	if (propertyName === null) {
		if (parser.valueHasHole) return false;
		resetDeclaration(parser);
		return true;
	}
	if (!registerDeclaredProperty(frame, propertyName, parser.valueHasHole))
		return false;
	if (!parser.valueHasHole) {
		resetDeclaration(parser);
		return true;
	}
	const priority = splitTrailingImportantPriority(parser);
	if (priority === null) return false;
	parser.dynamicDeclarations.push({
		rulePath:
			frame.openRunIndex === NO_OPEN_RUN
				? frame.rulePath
				: frame.rulePath.concat(frame.openRunIndex),
		propertyName,
		priority,
		valueParts: parser.valueBuffer.slice(),
	});
	markDynamicPath(parser, frame);
	resetDeclaration(parser);
	return true;
};

const parser = createCssParser();

export const compileStyleSheet = (
	parts: Array<Part>,
): CompiledStyleSheet | null => {
	resetCssParser(parser);

	for (let partIndex = 0; partIndex < parts.length; partIndex++) {
		const part = parts[partIndex];
		if (typeof part === "number") {
			const isDeclarationValueHole =
				parser.state === CSS_STATE.VALUE &&
				!activeFrame(parser).isInsideDescriptor;
			if (!isDeclarationValueHole) return null;
			parser.valueBuffer.push(part);
			parser.valueHasHole = true;
			continue;
		}

		parser.activeTemplate = part;
		parser.splitIndex = 0;
		parser.propertyStartIndex = 0;
		for (
			parser.charIndex = 0;
			parser.charIndex < part.length;
			parser.charIndex++
		) {
			const code = part.charCodeAt(parser.charIndex);

			if (parser.state === CSS_STATE.STRING) {
				if (code === CHAR_CODE.BACKSLASH) {
					parser.charIndex++;
					continue;
				}
				if (code === parser.quoteCode) parser.state = parser.returnState;
				continue;
			}
			if (parser.state === CSS_STATE.COMMENT) {
				const isCommentClose =
					code === CHAR_CODE.ASTERISK &&
					part.charCodeAt(parser.charIndex + 1) === CHAR_CODE.SLASH;
				if (isCommentClose) {
					parser.charIndex++;
					parser.state = parser.returnState;
				}
				continue;
			}

			if (isQuoteCode(code)) {
				parser.quoteCode = code;
				parser.returnState = parser.state;
				parser.state = CSS_STATE.STRING;
				continue;
			}
			const opensComment =
				code === CHAR_CODE.SLASH &&
				part.charCodeAt(parser.charIndex + 1) === CHAR_CODE.ASTERISK;
			if (opensComment) {
				parser.charIndex++;
				parser.returnState = parser.state;
				parser.state = CSS_STATE.COMMENT;
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
					if (parser.state === CSS_STATE.VALUE) return null;
					const parent = activeFrame(parser);
					const ruleIndex = registerChildRule(parent);
					parser.ruleStack.push(createRuleFrame(parser, parent, ruleIndex));
					parser.pendingRuleKind = RULE_KIND.STYLE;
					parser.state = CSS_STATE.PROPERTY;
					parser.propertyStartIndex = parser.charIndex + 1;
					break;
				}
				case CHAR_CODE.CLOSE_BRACE: {
					if (parser.state === CSS_STATE.VALUE) {
						captureStaticValueText(parser, parser.charIndex);
						if (!finishDeclarationValue(parser)) return null;
					}
					if (parser.ruleStack.length === 1) return null;
					const closedFrame = parser.ruleStack.pop()!;
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
						captureStaticValueText(parser, parser.charIndex);
						if (!finishDeclarationValue(parser)) return null;
					}
					if (parser.pendingRuleKind !== RULE_KIND.STYLE) {
						registerChildRule(activeFrame(parser));
						parser.pendingRuleKind = RULE_KIND.STYLE;
					}
					parser.propertyStartIndex = parser.charIndex + 1;
					break;
				case CHAR_CODE.COLON:
					if (parser.state === CSS_STATE.PROPERTY) {
						parser.activePropertyName = parser.activeTemplate.slice(
							parser.propertyStartIndex,
							parser.charIndex,
						);
						parser.state = CSS_STATE.VALUE;
						parser.splitIndex = parser.charIndex + 1;
					}
					break;
				case CHAR_CODE.AT:
					if (parser.state !== CSS_STATE.VALUE)
						parser.pendingRuleKind = readAtRuleKind(parser);
					break;
				case CHAR_CODE.BANG:
					if (parser.state === CSS_STATE.VALUE) parser.valueTopLevelBangCount++;
					break;
			}
		}
		if (parser.state === CSS_STATE.VALUE)
			captureStaticValueText(parser, part.length);
	}

	const endedCleanly =
		parser.state === CSS_STATE.SELECTOR &&
		parser.ruleStack.length === 1 &&
		parser.parenDepth === 0;
	if (!endedCleanly) return null;
	if (parser.dynamicDeclarations.length === 0) return null;
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
