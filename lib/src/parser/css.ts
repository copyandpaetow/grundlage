import { CHAR_CODE, isQuoteCode } from "./chars";
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

type AtRuleKindValue = ValueOf<typeof AT_RULE_KIND>;

const AT_RULE_KIND = {
	NONE: 0,
	GROUPING: 1,
	KEYFRAMES: 2,
	DESCRIPTOR: 3,
} as const;

type RuleKindValue = ValueOf<typeof RULE_KIND>;

const RULE_KIND = {
	STYLE: 0,
	GROUPING: 1,
	KEYFRAMES: 2,
	DESCRIPTOR: 3,
} as const;

const NO_OPEN_RUN = -1;

//these at-rules nest style rules whose declarations land on an addressable CSSOM
//declaration block; every other at-rule (@font-face, @property, …) holds descriptors,
//which the fast path leaves to the fallback
const GROUPING_AT_RULE_NAMES = new Set([
	"media",
	"supports",
	"container",
	"layer",
	"scope",
	"starting-style",
]);
const KEYFRAMES_AT_RULE_NAME = "keyframes";

const COMMENT_PATTERN = /\/\*[^]*?\*\//g;
const PROPERTY_NAME_PATTERN = /^(?:--[\w-]+|-?[a-zA-Z][a-zA-Z0-9-]*)$/;

//setProperty silently ignores a malformed name, which would read as a stale render — only
//names this shape provably reach the declaration block
const normalizePropertyName = (raw: string): string | null => {
	const cleaned = raw.replace(COMMENT_PATTERN, " ").trim();
	const name = cleaned.startsWith("--") ? cleaned : cleaned.toLowerCase();
	return PROPERTY_NAME_PATTERN.test(name) ? name : null;
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

interface CssAnalyzerState {
	state: CssStateValue;
	returnState: CssStateValue;
	quoteCode: number;
	activeStatic: string;
	charIndex: number;
	splitIndex: number;
	parenDepth: number;
	pendingAtRuleKind: AtRuleKindValue;
	propertyStartIndex: number;
	activePropertyName: string;
	valueHasHole: boolean;
	valueTopLevelBangCount: number;
	valueBuffer: Array<Part>;
	ruleStack: Array<RuleFrame>;
	dynamicDeclarations: Array<DynamicDeclaration>;
	ruleCountChecks: Array<RuleCountCheck>;
}

const createCssAnalyzer = (): CssAnalyzerState => ({
	state: CSS_STATE.SELECTOR,
	returnState: CSS_STATE.SELECTOR,
	quoteCode: 0,
	activeStatic: "",
	charIndex: 0,
	splitIndex: 0,
	parenDepth: 0,
	pendingAtRuleKind: AT_RULE_KIND.NONE,
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

const resetCssAnalyzer = (css: CssAnalyzerState) => {
	css.state = CSS_STATE.SELECTOR;
	css.returnState = CSS_STATE.SELECTOR;
	css.quoteCode = 0;
	css.activeStatic = "";
	css.charIndex = 0;
	css.splitIndex = 0;
	css.parenDepth = 0;
	css.pendingAtRuleKind = AT_RULE_KIND.NONE;
	css.propertyStartIndex = 0;
	css.activePropertyName = "";
	css.valueHasHole = false;
	css.valueTopLevelBangCount = 0;
	css.valueBuffer.length = 0;
	css.ruleStack.length = 0;
	css.ruleStack.push(createSheetRootFrame());
	css.dynamicDeclarations = [];
	css.ruleCountChecks = [];
};

const analyzer = createCssAnalyzer();

const isAtRuleNameCode = (code: number) =>
	(code >= CHAR_CODE.LOWERCASE_A && code <= CHAR_CODE.LOWERCASE_Z) ||
	(code >= CHAR_CODE.UPPERCASE_A && code <= CHAR_CODE.UPPERCASE_Z) ||
	code === CHAR_CODE.DASH;

const readAtRuleName = (css: CssAnalyzerState): string => {
	const staticText = css.activeStatic;
	let endIndex = css.charIndex + 1;
	while (
		endIndex < staticText.length &&
		isAtRuleNameCode(staticText.charCodeAt(endIndex))
	)
		endIndex++;
	return staticText.slice(css.charIndex + 1, endIndex).toLowerCase();
};

const readAtRuleKind = (css: CssAnalyzerState): AtRuleKindValue => {
	const name = readAtRuleName(css);
	if (GROUPING_AT_RULE_NAMES.has(name)) return AT_RULE_KIND.GROUPING;
	if (name === KEYFRAMES_AT_RULE_NAME) return AT_RULE_KIND.KEYFRAMES;
	return AT_RULE_KIND.DESCRIPTOR;
};

const captureValueSpan = (css: CssAnalyzerState, end: number) => {
	if (end <= css.splitIndex) return;
	css.valueBuffer.push(css.activeStatic.slice(css.splitIndex, end));
};

const activeFrame = (css: CssAnalyzerState): RuleFrame =>
	css.ruleStack[css.ruleStack.length - 1];

const createRuleFrame = (
	css: CssAnalyzerState,
	parent: RuleFrame,
	ruleIndex: number,
): RuleFrame => {
	const atRuleKind = css.pendingAtRuleKind;
	const isInsideStyleRule =
		parent.kind === RULE_KIND.STYLE || parent.isInsideStyleRule;
	let kind: RuleKindValue;
	if (atRuleKind === AT_RULE_KIND.GROUPING) kind = RULE_KIND.GROUPING;
	else if (atRuleKind === AT_RULE_KIND.KEYFRAMES) kind = RULE_KIND.KEYFRAMES;
	else if (atRuleKind === AT_RULE_KIND.DESCRIPTOR) kind = RULE_KIND.DESCRIPTOR;
	else kind = RULE_KIND.STYLE;
	return {
		kind,
		rulePath: parent.rulePath.concat(ruleIndex),
		childRuleCount: 0,
		//a grouping rule nested under a style rule holds its bare declarations in implicit
		//CSSNestedDeclarations child rules, never on the grouping rule itself
		declarationsCreateRuns: kind === RULE_KIND.GROUPING && isInsideStyleRule,
		openRunIndex: NO_OPEN_RUN,
		isInsideStyleRule,
		isInsideDescriptor: kind === RULE_KIND.DESCRIPTOR || parent.isInsideDescriptor,
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

//a nested rule (or statement at-rule) between declarations ends the current implicit
//CSSNestedDeclarations run and flips the style rule into run mode for later declarations
const registerChildRule = (frame: RuleFrame): number => {
	const ruleIndex = frame.childRuleCount++;
	frame.openRunIndex = NO_OPEN_RUN;
	if (frame.kind === RULE_KIND.STYLE) frame.declarationsCreateRuns = true;
	return ruleIndex;
};

const markDynamicPath = (css: CssAnalyzerState, holderFrame: RuleFrame) => {
	const ruleStack = css.ruleStack;
	for (let index = 0; index < ruleStack.length - 1; index++)
		ruleStack[index].isOnDynamicPath = true;
	if (holderFrame.declarationsCreateRuns) holderFrame.isOnDynamicPath = true;
};

const resetDeclaration = (css: CssAnalyzerState) => {
	css.valueBuffer.length = 0;
	css.valueHasHole = false;
	css.valueTopLevelBangCount = 0;
	css.state = CSS_STATE.PROPERTY;
};

//CSSOM takes priority as a separate setProperty argument, so a trailing !important is
//split off the value parts here
const extractImportantPriority = (css: CssAnalyzerState): string | null => {
	if (css.valueTopLevelBangCount === 0) return "";
	if (css.valueTopLevelBangCount > 1) return null;
	const valueBuffer = css.valueBuffer;
	const lastValuePart = valueBuffer[valueBuffer.length - 1];
	if (typeof lastValuePart !== "string") return null;
	const bangIndex = lastValuePart.lastIndexOf("!");
	if (bangIndex === -1) return null;
	const afterBang = lastValuePart.slice(bangIndex + 1);
	if (afterBang.trim().toLowerCase() !== "important") return null;
	const beforeImportant = lastValuePart.slice(0, bangIndex);
	if (beforeImportant === "") valueBuffer.pop();
	else valueBuffer[valueBuffer.length - 1] = beforeImportant;
	return "important";
};

const finishDeclarationValue = (css: CssAnalyzerState): boolean => {
	const frame = activeFrame(css);
	if (frame.isInsideDescriptor) {
		resetDeclaration(css);
		return true;
	}
	const isDeclarationHolder =
		frame.kind === RULE_KIND.STYLE || frame.declarationsCreateRuns;
	if (!isDeclarationHolder) {
		//a bare declaration directly inside @keyframes or a top-level grouping rule is
		//dropped by the browser — unaddressable, so a hole there bails
		if (css.valueHasHole) return false;
		resetDeclaration(css);
		return true;
	}
	if (frame.declarationsCreateRuns && frame.openRunIndex === NO_OPEN_RUN)
		frame.openRunIndex = frame.childRuleCount++;
	const propertyName = normalizePropertyName(css.activePropertyName);
	if (propertyName === null) {
		//an unreachable name only matters when an update must reach it
		if (css.valueHasHole) return false;
		resetDeclaration(css);
		return true;
	}
	if (!registerDeclaredProperty(frame, propertyName, css.valueHasHole))
		return false;
	if (!css.valueHasHole) {
		resetDeclaration(css);
		return true;
	}
	const priority = extractImportantPriority(css);
	if (priority === null) return false;
	css.dynamicDeclarations.push({
		rulePath:
			frame.openRunIndex === NO_OPEN_RUN
				? frame.rulePath
				: frame.rulePath.concat(frame.openRunIndex),
		propertyName,
		priority,
		valueParts: css.valueBuffer.slice(),
	});
	markDynamicPath(css, frame);
	resetDeclaration(css);
	return true;
};

export const compileStyleSheet = (
	parts: Array<Part>,
): CompiledStyleSheet | null => {
	const css = analyzer;
	resetCssAnalyzer(css);

	for (let partIndex = 0; partIndex < parts.length; partIndex++) {
		const part = parts[partIndex];
		if (typeof part === "number") {
			const isDeclarationValueHole =
				css.state === CSS_STATE.VALUE && !activeFrame(css).isInsideDescriptor;
			if (!isDeclarationValueHole) return null;
			css.valueBuffer.push(part);
			css.valueHasHole = true;
			continue;
		}

		css.activeStatic = part;
		css.splitIndex = 0;
		css.propertyStartIndex = 0;
		for (css.charIndex = 0; css.charIndex < part.length; css.charIndex++) {
			const code = part.charCodeAt(css.charIndex);

			if (css.state === CSS_STATE.STRING) {
				const isUnescapedClosingQuote =
					code === css.quoteCode &&
					part.charCodeAt(css.charIndex - 1) !== CHAR_CODE.BACKSLASH;
				if (isUnescapedClosingQuote) css.state = css.returnState;
				continue;
			}
			if (css.state === CSS_STATE.COMMENT) {
				const isCommentClose =
					code === CHAR_CODE.ASTERISK &&
					part.charCodeAt(css.charIndex + 1) === CHAR_CODE.SLASH;
				if (isCommentClose) {
					css.charIndex++;
					css.state = css.returnState;
				}
				continue;
			}

			if (isQuoteCode(code)) {
				css.quoteCode = code;
				css.returnState = css.state;
				css.state = CSS_STATE.STRING;
				continue;
			}
			const opensComment =
				code === CHAR_CODE.SLASH &&
				part.charCodeAt(css.charIndex + 1) === CHAR_CODE.ASTERISK;
			if (opensComment) {
				css.charIndex++; //consume the "*" so "/*/" cannot self-close
				css.returnState = css.state;
				css.state = CSS_STATE.COMMENT;
				continue;
			}
			if (code === CHAR_CODE.OPEN_PAREN) {
				css.parenDepth++;
				continue;
			}
			//structural chars are inert inside ( ) — url(), calc(), :not()
			if (css.parenDepth > 0) {
				if (code === CHAR_CODE.CLOSE_PAREN) css.parenDepth--;
				continue;
			}

			switch (code) {
				case CHAR_CODE.OPEN_BRACE: {
					//"{" never occurs in a real value: the ":" that entered VALUE belonged
					//to a nested selector's pseudo, which has no fast path
					if (css.state === CSS_STATE.VALUE) return null;
					const parent = activeFrame(css);
					const ruleIndex = registerChildRule(parent);
					css.ruleStack.push(createRuleFrame(css, parent, ruleIndex));
					css.pendingAtRuleKind = AT_RULE_KIND.NONE;
					css.state = CSS_STATE.PROPERTY;
					css.propertyStartIndex = css.charIndex + 1;
					break;
				}
				case CHAR_CODE.CLOSE_BRACE: {
					if (css.state === CSS_STATE.VALUE) {
						captureValueSpan(css, css.charIndex);
						if (!finishDeclarationValue(css)) return null;
					}
					if (css.ruleStack.length === 1) return null;
					const closedFrame = css.ruleStack.pop()!;
					if (closedFrame.isOnDynamicPath)
						css.ruleCountChecks.push({
							rulePath: closedFrame.rulePath,
							expectedRuleCount: closedFrame.childRuleCount,
						});
					css.state =
						css.ruleStack.length === 1 ? CSS_STATE.SELECTOR : CSS_STATE.PROPERTY;
					css.propertyStartIndex = css.charIndex + 1;
					break;
				}
				case CHAR_CODE.SEMICOLON:
					if (css.state === CSS_STATE.VALUE) {
						captureValueSpan(css, css.charIndex);
						if (!finishDeclarationValue(css)) return null;
					}
					//a statement at-rule (@import, @layer a;) still occupies a cssRules slot
					if (css.pendingAtRuleKind !== AT_RULE_KIND.NONE) {
						registerChildRule(activeFrame(css));
						css.pendingAtRuleKind = AT_RULE_KIND.NONE;
					}
					css.propertyStartIndex = css.charIndex + 1;
					break;
				case CHAR_CODE.COLON:
					if (css.state === CSS_STATE.PROPERTY) {
						css.activePropertyName = css.activeStatic.slice(
							css.propertyStartIndex,
							css.charIndex,
						);
						css.state = CSS_STATE.VALUE;
						css.splitIndex = css.charIndex + 1;
					}
					break;
				case CHAR_CODE.AT:
					if (css.state !== CSS_STATE.VALUE)
						css.pendingAtRuleKind = readAtRuleKind(css);
					break;
				case CHAR_CODE.BANG:
					if (css.state === CSS_STATE.VALUE) css.valueTopLevelBangCount++;
					break;
			}
		}
		if (css.state === CSS_STATE.VALUE) captureValueSpan(css, part.length);
	}

	const endedCleanly =
		css.state === CSS_STATE.SELECTOR &&
		css.ruleStack.length === 1 &&
		css.parenDepth === 0;
	if (!endedCleanly) return null;
	if (css.dynamicDeclarations.length === 0) return null;
	const sheetRoot = css.ruleStack[0];
	css.ruleCountChecks.push({
		rulePath: sheetRoot.rulePath,
		expectedRuleCount: sheetRoot.childRuleCount,
	});
	return {
		dynamicDeclarations: css.dynamicDeclarations,
		ruleCountChecks: css.ruleCountChecks,
	};
};
