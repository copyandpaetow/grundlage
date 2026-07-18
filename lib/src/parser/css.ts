import { moveArrayContents } from "../utils/arrays";
import { CHAR_CODE, isQuoteCode } from "./chars";
import { CssPlan, CssValueGroup, Part, ValueOf } from "./types";

type CssStateValue = ValueOf<typeof CSS_STATE>;

const CSS_STATE = {
	SELECTOR: 0,
	PROPERTY: 1,
	VALUE: 2,
	STRING: 3,
	COMMENT: 4,
} as const;

const NO_EXPRESSION_INDEX = -1;
const NO_VAR_UNSAFE_BLOCK = 0;

//var() never substitutes in descriptor at-rules (@font-face, @property, …), so a value
//hole is only fast under at-rules known to hold regular style declarations
const VAR_SAFE_AT_RULE_NAMES = new Set([
	"media",
	"supports",
	"container",
	"layer",
	"scope",
	"keyframes",
	"starting-style",
]);

interface CssAnalyzerState {
	state: CssStateValue;
	returnState: CssStateValue;
	quoteCode: number;
	activeStatic: string;
	charIndex: number;
	splitIndex: number;
	braceDepth: number;
	parenDepth: number;
	pendingAtRuleIsVarUnsafe: boolean;
	varUnsafeBlockDepth: number;
	valueHasHole: boolean;
	valueFirstExpressionIndex: number;
	valueTopLevelBangCount: number;
	sheetBuffer: Array<string | number>;
	valueBuffer: Array<Part>;
	groups: Array<CssValueGroup>;
	namePrefix: string;
}

const createCssAnalyzer = (): CssAnalyzerState => ({
	state: CSS_STATE.SELECTOR,
	returnState: CSS_STATE.SELECTOR,
	quoteCode: 0,
	activeStatic: "",
	charIndex: 0,
	splitIndex: 0,
	braceDepth: 0,
	parenDepth: 0,
	pendingAtRuleIsVarUnsafe: false,
	varUnsafeBlockDepth: NO_VAR_UNSAFE_BLOCK,
	valueHasHole: false,
	valueFirstExpressionIndex: NO_EXPRESSION_INDEX,
	valueTopLevelBangCount: 0,
	sheetBuffer: [],
	valueBuffer: [],
	groups: [],
	namePrefix: "",
});

const resetCssAnalyzer = (css: CssAnalyzerState, templateHash: number) => {
	css.state = CSS_STATE.SELECTOR;
	css.returnState = CSS_STATE.SELECTOR;
	css.quoteCode = 0;
	css.activeStatic = "";
	css.charIndex = 0;
	css.splitIndex = 0;
	css.braceDepth = 0;
	css.parenDepth = 0;
	css.pendingAtRuleIsVarUnsafe = false;
	css.varUnsafeBlockDepth = NO_VAR_UNSAFE_BLOCK;
	css.valueHasHole = false;
	css.valueFirstExpressionIndex = NO_EXPRESSION_INDEX;
	css.valueTopLevelBangCount = 0;
	css.valueBuffer.length = 0;
	//sheetParts and groups escape into the returned plan, so reset allocates fresh arrays
	css.sheetBuffer = [];
	css.groups = [];
	//stringHash is signed; a negative hash would put a stray "-" inside the name
	css.namePrefix = `--${(templateHash >>> 0).toString(36)}-`;
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

//a span lands in the value while composing a declaration value, in the sheet otherwise
const captureSpan = (css: CssAnalyzerState, end: number) => {
	if (end <= css.splitIndex) return;
	const slice = css.activeStatic.slice(css.splitIndex, end);
	if (css.state === CSS_STATE.VALUE) css.valueBuffer.push(slice);
	else css.sheetBuffer.push(slice);
};

const finishDeclarationValue = (css: CssAnalyzerState): boolean => {
	const valueBuffer = css.valueBuffer;
	if (!css.valueHasHole) {
		moveArrayContents(valueBuffer, css.sheetBuffer);
	} else {
		let importantSuffix = "";
		if (css.valueTopLevelBangCount === 1) {
			const lastValuePart = valueBuffer[valueBuffer.length - 1];
			if (typeof lastValuePart !== "string") return false;
			const bangIndex = lastValuePart.lastIndexOf("!");
			if (bangIndex === -1) return false;
			const afterBang = lastValuePart.slice(bangIndex + 1);
			if (afterBang.trim().toLowerCase() !== "important") return false;
			const beforeImportant = lastValuePart.slice(0, bangIndex);
			if (beforeImportant === "") valueBuffer.pop();
			else valueBuffer[valueBuffer.length - 1] = beforeImportant;
			importantSuffix = " !important";
		} else if (css.valueTopLevelBangCount > 1) {
			return false;
		}
		css.groups.push({
			ordinal: css.valueFirstExpressionIndex,
			valueParts: valueBuffer.slice(),
		});
		css.sheetBuffer.push(css.groups.length - 1);
		if (importantSuffix !== "") css.sheetBuffer.push(importantSuffix);
	}
	valueBuffer.length = 0;
	css.valueHasHole = false;
	css.valueFirstExpressionIndex = NO_EXPRESSION_INDEX;
	css.valueTopLevelBangCount = 0;
	css.state = CSS_STATE.PROPERTY;
	return true;
};

export const analyzeStyle = (
	parts: Array<Part>,
	templateHash: number,
): CssPlan | null => {
	const css = analyzer;
	resetCssAnalyzer(css, templateHash);

	for (let partIndex = 0; partIndex < parts.length; partIndex++) {
		const part = parts[partIndex];
		if (typeof part === "number") {
			const isDeclarationValueHole =
				css.state === CSS_STATE.VALUE &&
				css.varUnsafeBlockDepth === NO_VAR_UNSAFE_BLOCK;
			if (!isDeclarationValueHole) return null;
			if (!css.valueHasHole) css.valueFirstExpressionIndex = part;
			css.valueBuffer.push(part);
			css.valueHasHole = true;
			continue;
		}

		css.activeStatic = part;
		css.splitIndex = 0;
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
				case CHAR_CODE.OPEN_BRACE:
					//"{" never occurs in a real value: the ":" that entered VALUE belonged
					//to a nested selector's pseudo, which has no fast path
					if (css.state === CSS_STATE.VALUE) return null;
					css.braceDepth++;
					if (css.pendingAtRuleIsVarUnsafe) {
						if (css.varUnsafeBlockDepth === NO_VAR_UNSAFE_BLOCK)
							css.varUnsafeBlockDepth = css.braceDepth;
						css.pendingAtRuleIsVarUnsafe = false;
					}
					css.state = CSS_STATE.PROPERTY;
					break;
				case CHAR_CODE.CLOSE_BRACE:
					if (css.state === CSS_STATE.VALUE) {
						captureSpan(css, css.charIndex);
						if (!finishDeclarationValue(css)) return null;
						css.splitIndex = css.charIndex; //"}" rides into the next sheet span
					}
					if (css.braceDepth === 0) return null;
					css.braceDepth--;
					if (css.braceDepth < css.varUnsafeBlockDepth)
						css.varUnsafeBlockDepth = NO_VAR_UNSAFE_BLOCK;
					css.state =
						css.braceDepth === 0 ? CSS_STATE.SELECTOR : CSS_STATE.PROPERTY;
					break;
				case CHAR_CODE.SEMICOLON:
					if (css.state === CSS_STATE.VALUE) {
						captureSpan(css, css.charIndex);
						if (!finishDeclarationValue(css)) return null;
						css.splitIndex = css.charIndex; //";" rides into the next sheet span
					}
					//a ";" also terminates statement at-rules (@import, @charset)
					css.pendingAtRuleIsVarUnsafe = false;
					break;
				case CHAR_CODE.COLON:
					if (css.state === CSS_STATE.PROPERTY) {
						captureSpan(css, css.charIndex + 1);
						css.state = CSS_STATE.VALUE;
						css.splitIndex = css.charIndex + 1;
					}
					break;
				case CHAR_CODE.AT:
					if (css.state !== CSS_STATE.VALUE)
						css.pendingAtRuleIsVarUnsafe = !VAR_SAFE_AT_RULE_NAMES.has(
							readAtRuleName(css),
						);
					break;
				case CHAR_CODE.BANG:
					if (css.state === CSS_STATE.VALUE) css.valueTopLevelBangCount++;
					break;
			}
		}
		captureSpan(css, part.length);
	}

	const endedCleanly =
		css.state === CSS_STATE.SELECTOR &&
		css.braceDepth === 0 &&
		css.parenDepth === 0;
	if (!endedCleanly) return null;
	return {
		namePrefix: css.namePrefix,
		groupNames: css.groups.map((group) => css.namePrefix + group.ordinal),
		sheetParts: css.sheetBuffer,
		groups: css.groups,
	};
};

export const composeSheet = (
	plan: CssPlan,
	groupNames: Array<string>,
): string => {
	let result = "";
	for (let index = 0; index < plan.sheetParts.length; index++) {
		const part = plan.sheetParts[index];
		result += typeof part === "number" ? `var(${groupNames[part]})` : part;
	}
	return result;
};
