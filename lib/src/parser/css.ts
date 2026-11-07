import { isLetterCode, isQuoteCode, isWhitespaceCode } from "./characters";
import * as CHARACTER_CODE from "./character-code";
import { ValueOf } from "../utils/types";
import { NO_REINSERTION, STYLE_SHEET_NOT_COMPILED } from "./constants";
import { CompiledStyleSheet, HoledDeclaration, Part, RuleCountCheck } from "./types";
import { assertDuringDevelopment } from "../utils/diagnostics";
import * as RULE_KIND from "./rule-kind";

//the parts are joined with the character html.ts reserves for holes, so every reader runs from
//its opener to its end and a hole is a character like any other

type RuleKind = ValueOf<typeof RULE_KIND>;

const HOLE = "";
const HOLE_CODE = HOLE.charCodeAt(0);
const NO_OPEN_RUN = -1;
const NO_COLON = -1;
const NOT_A_PROPERTY_NAME: unique symbol = Symbol("not a property name");
const COMMENT_OPEN = "/*";
const COMMENT_CLOSE = "*/";
const CUSTOM_PROPERTY_PREFIX = "--";
const IMPORTANT_PRIORITY = "important";

//thrown by any reader that meets something no setProperty could address; compileStyleSheet
//turns it into the text lane
const NOT_ADDRESSABLE: unique symbol = Symbol("not addressable");

//only these can match the host from inside its shadow tree, where WebKit keeps serving the
//host's style from before a setProperty; a false positive costs one rule reparse
const MATCHES_HOST_PATTERN = /:host|:scope/i;

//grouping at-rules nest style rules on an addressable CSSOM block, so a hole inside stays
//updatable; descriptor at-rules (@font-face, @property) are skipped whole
const GROUPING_AT_RULE_NAMES = new Set([
	"media",
	"supports",
	"container",
	"layer",
	"scope",
	"starting-style",
]);
const KEYFRAMES_AT_RULE_NAME = "keyframes";

const isDigitCode = (code: number) =>
	code >= CHARACTER_CODE.DIGIT_ZERO && code <= CHARACTER_CODE.DIGIT_NINE;

const isAtRuleNameCode = (code: number) => isLetterCode(code) || code === CHARACTER_CODE.DASH;

const isStandardNameCode = (code: number) =>
	isLetterCode(code) || isDigitCode(code) || code === CHARACTER_CODE.DASH;

const isCustomNameCode = (code: number) =>
	isStandardNameCode(code) || code === CHARACTER_CODE.UNDERSCORE;

//HoledRule while its block is still being read
interface OpenHoledRule {
	readonly rulePath: ReadonlyArray<number>;
	readonly reinsertedRulePath: ReadonlyArray<number> | typeof NO_REINSERTION;
	readonly declarations: Array<HoledDeclaration>;
}

interface RuleFrame {
	kind: RuleKind;
	rulePath: Array<number>;
	childRuleCount: number;
	doDeclarationsCreateRuns: boolean;
	openRunIndex: number;
	isInsideStyleRule: boolean;
	isInsideKeyframes: boolean;
	//a style rule is the one kind every block accepts back through insertRule
	reinsertedRulePath: ReadonlyArray<number> | typeof NO_REINSERTION;
	isOnDynamicPath: boolean;
	declaredPropertyNames: Set<string>;
	holedPropertyNames: Set<string>;
	ownHoledRule: OpenHoledRule | null;
	runHoledRule: OpenHoledRule | null;
}

interface StyleSheetReader {
	source: string;
	index: number;
	holeValueIndexes: Array<number>;
	readHoleCount: number;
	//written by readItem for the item it just read
	itemColonIndex: number;
	itemTopLevelBangCount: number;
	//one per open rule, innermost last; the root frame stands for the sheet itself
	openFrames: Array<RuleFrame>;
	holedRules: Array<OpenHoledRule>;
	ruleCountChecks: Array<RuleCountCheck>;
	declarationCount: number;
}

const createRuleFrame = (
	kind: RuleKind,
	rulePath: Array<number>,
	parent: RuleFrame | null,
	prelude: string,
): RuleFrame => {
	const isInsideStyleRule =
		parent !== null && (parent.kind === RULE_KIND.STYLE || parent.isInsideStyleRule);
	const isInsideKeyframes =
		parent !== null && (parent.kind === RULE_KIND.KEYFRAMES || parent.isInsideKeyframes);
	const matchesHost =
		!isInsideKeyframes &&
		(MATCHES_HOST_PATTERN.test(prelude) ||
			(parent !== null && parent.reinsertedRulePath !== NO_REINSERTION));
	const inheritedReinsertedRulePath = parent === null ? NO_REINSERTION : parent.reinsertedRulePath;
	const hostReinsertedRulePath = kind === RULE_KIND.STYLE ? rulePath : inheritedReinsertedRulePath;
	return {
		kind,
		rulePath,
		childRuleCount: 0,
		doDeclarationsCreateRuns: kind === RULE_KIND.GROUPING && isInsideStyleRule,
		openRunIndex: NO_OPEN_RUN,
		isInsideStyleRule,
		isInsideKeyframes,
		reinsertedRulePath: matchesHost ? hostReinsertedRulePath : NO_REINSERTION,
		isOnDynamicPath: false,
		declaredPropertyNames: new Set(),
		holedPropertyNames: new Set(),
		ownHoledRule: null,
		runHoledRule: null,
	};
};

const activeFrame = (reader: StyleSheetReader): RuleFrame =>
	reader.openFrames[reader.openFrames.length - 1];

const hasHoleBetween = (source: string, start: number, end: number) => {
	const holeIndex = source.indexOf(HOLE, start);
	return holeIndex !== -1 && holeIndex < end;
};

const failUnlessHoleFree = (source: string, start: number, end: number) => {
	if (hasHoleBetween(source, start, end)) throw NOT_ADDRESSABLE;
};

//the index past the closing quote; an escaped quote does not close
const endOfString = (source: string, openingQuoteIndex: number): number => {
	const quoteCode = source.charCodeAt(openingQuoteIndex);
	let index = openingQuoteIndex + 1;
	while (index < source.length) {
		const code = source.charCodeAt(index);
		if (code === CHARACTER_CODE.BACKSLASH) {
			index += 2;
			continue;
		}
		if (code === HOLE_CODE) throw NOT_ADDRESSABLE;
		if (code === quoteCode) return index + 1;
		index++;
	}
	throw NOT_ADDRESSABLE;
};

const endOfComment = (source: string, commentStart: number): number => {
	const commentClose = source.indexOf(COMMENT_CLOSE, commentStart + COMMENT_OPEN.length);
	if (commentClose === -1) throw NOT_ADDRESSABLE;
	failUnlessHoleFree(source, commentStart, commentClose);
	return commentClose + COMMENT_CLOSE.length;
};

const skipWhitespaceAndComments = (source: string, index: number): number => {
	while (index < source.length) {
		if (isWhitespaceCode(source.charCodeAt(index))) {
			index++;
			continue;
		}
		if (!source.startsWith(COMMENT_OPEN, index)) return index;
		index = endOfComment(source, index);
	}
	return index;
};

const closingCodeOf = (openingCode: number): number | null => {
	if (openingCode === CHARACTER_CODE.OPEN_PAREN) return CHARACTER_CODE.CLOSE_PAREN;
	if (openingCode === CHARACTER_CODE.OPEN_BRACKET) return CHARACTER_CODE.CLOSE_BRACKET;
	if (openingCode === CHARACTER_CODE.OPEN_BRACE) return CHARACTER_CODE.CLOSE_BRACE;
	return null;
};

//a declaration or a rule's prelude, up to its top-level ";", "{" or "}"; strings, comments,
//escapes and nested blocks are stepped over whole. Inside a block only its own closer ends it,
//so `({);` swallows the `;` exactly as the browser does
const readItem = (reader: StyleSheetReader): number => {
	const { source } = reader;
	reader.itemColonIndex = NO_COLON;
	reader.itemTopLevelBangCount = 0;
	const openBlockClosingCodes: Array<number> = [];
	let index = reader.index;
	while (index < source.length) {
		const code = source.charCodeAt(index);
		if (code === CHARACTER_CODE.BACKSLASH) {
			const escapesNothing =
				index + 1 === source.length || source.charCodeAt(index + 1) === HOLE_CODE;
			if (escapesNothing) throw NOT_ADDRESSABLE;
			index += 2;
			continue;
		}
		if (isQuoteCode(code)) {
			index = endOfString(source, index);
			continue;
		}
		if (source.startsWith(COMMENT_OPEN, index)) {
			index = endOfComment(source, index);
			continue;
		}
		const isInsideBlock = openBlockClosingCodes.length > 0;
		const closingCode = closingCodeOf(code);
		const opensNestedBlock =
			closingCode !== null && (isInsideBlock || code !== CHARACTER_CODE.OPEN_BRACE);
		if (opensNestedBlock) openBlockClosingCodes.push(closingCode);
		else if (isInsideBlock) {
			if (code === openBlockClosingCodes[openBlockClosingCodes.length - 1]) {
				openBlockClosingCodes.pop();
			}
		} else if (
			code === CHARACTER_CODE.SEMICOLON ||
			code === CHARACTER_CODE.OPEN_BRACE ||
			code === CHARACTER_CODE.CLOSE_BRACE
		) {
			return index;
		} else if (code === CHARACTER_CODE.COLON) {
			if (reader.itemColonIndex === NO_COLON) reader.itemColonIndex = index;
		} else if (code === CHARACTER_CODE.BANG && reader.itemColonIndex !== NO_COLON) {
			reader.itemTopLevelBangCount++;
		}
		index++;
	}
	if (openBlockClosingCodes.length > 0) throw NOT_ADDRESSABLE;
	return index;
};

//the end of a block whose contents are never addressed, past its closing brace
const endOfSkippedBlock = (source: string, openBraceIndex: number): number => {
	let depth = 1;
	let index = openBraceIndex + 1;
	while (index < source.length) {
		const code = source.charCodeAt(index);
		if (isQuoteCode(code)) {
			index = endOfString(source, index);
			continue;
		}
		if (source.startsWith(COMMENT_OPEN, index)) {
			index = endOfComment(source, index);
			continue;
		}
		if (code === HOLE_CODE) throw NOT_ADDRESSABLE;
		if (code === CHARACTER_CODE.OPEN_BRACE) depth++;
		if (code === CHARACTER_CODE.CLOSE_BRACE && --depth === 0) return index + 1;
		index++;
	}
	throw NOT_ADDRESSABLE;
};

const propertyNameOf = (
	source: string,
	nameStart: number,
	colonIndex: number,
): string | typeof NOT_A_PROPERTY_NAME => {
	const start = skipWhitespaceAndComments(source, nameStart);
	let end: number;
	let name: string;
	if (source.startsWith(CUSTOM_PROPERTY_PREFIX, start)) {
		const nameTailStart = start + CUSTOM_PROPERTY_PREFIX.length;
		end = nameTailStart;
		while (isCustomNameCode(source.charCodeAt(end))) end++;
		const hasNameTail = end > nameTailStart;
		if (!hasNameTail) return NOT_A_PROPERTY_NAME;
		name = source.slice(start, end);
	} else {
		let head = start;
		if (source.charCodeAt(head) === CHARACTER_CODE.DASH) head++;
		if (!isLetterCode(source.charCodeAt(head))) return NOT_A_PROPERTY_NAME;
		end = head + 1;
		while (isStandardNameCode(source.charCodeAt(end))) end++;
		name = source.slice(start, end).toLowerCase();
	}
	if (skipWhitespaceAndComments(source, end) < colonIndex) return NOT_A_PROPERTY_NAME;
	return name;
};

//every hole passes through here exactly once and in order, which is what numbers it
const valuePartsOf = (reader: StyleSheetReader, start: number, end: number): Array<Part> => {
	const { source } = reader;
	const parts: Array<Part> = [];
	let sliceStart = start;
	let holeIndex = source.indexOf(HOLE, sliceStart);
	while (holeIndex !== -1 && holeIndex < end) {
		if (holeIndex > sliceStart) parts.push(source.slice(sliceStart, holeIndex));
		parts.push(reader.holeValueIndexes[reader.readHoleCount++]);
		sliceStart = holeIndex + 1;
		holeIndex = source.indexOf(HOLE, sliceStart);
	}
	if (end > sliceStart) parts.push(source.slice(sliceStart, end));
	return parts;
};

//CSSOM takes priority as a separate setProperty argument, so a trailing !important is
//split off the last value part, which must be static text
const splitTrailingImportantPriority = (
	valueParts: Array<Part>,
	topLevelBangCount: number,
): string => {
	if (topLevelBangCount === 0) return "";
	if (topLevelBangCount > 1) throw NOT_ADDRESSABLE;
	const lastValuePart = valueParts[valueParts.length - 1];
	if (typeof lastValuePart !== "string") throw NOT_ADDRESSABLE;
	const bangIndex = lastValuePart.lastIndexOf("!");
	const keywordAfterBang = lastValuePart
		.slice(bangIndex + 1)
		.trim()
		.toLowerCase();
	if (bangIndex === -1 || keywordAfterBang !== IMPORTANT_PRIORITY) throw NOT_ADDRESSABLE;
	const valueBeforeBang = lastValuePart.slice(0, bangIndex);
	if (valueBeforeBang === "") valueParts.pop();
	else valueParts[valueParts.length - 1] = valueBeforeBang;
	return IMPORTANT_PRIORITY;
};

const LEADING_CSS_WHITESPACE = /^[ \t\n\r\f]+/;
const TRAILING_CSS_WHITESPACE = /[ \t\n\r\f]+$/;

//setProperty keeps edge whitespace in a custom property's value, and " inherit" there is the
//literal token, not the keyword. Runs after the !important split, which leaves a trailing space
const trimValueEdgeWhitespace = (valueParts: Array<Part>): void => {
	const firstPart = valueParts[0];
	if (typeof firstPart === "string") {
		const trimmedFirstPart = firstPart.replace(LEADING_CSS_WHITESPACE, "");
		if (trimmedFirstPart === "") valueParts.shift();
		else valueParts[0] = trimmedFirstPart;
	}
	const lastIndex = valueParts.length - 1;
	const lastPart = valueParts[lastIndex];
	if (typeof lastPart === "string") {
		const trimmedLastPart = lastPart.replace(TRAILING_CSS_WHITESPACE, "");
		if (trimmedLastPart === "") valueParts.pop();
		else valueParts[lastIndex] = trimmedLastPart;
	}
};

//setProperty replaces a block's whole entry for a property, so a duplicate of a holed
//property inside one rule would let an update defeat the cascade order the author wrote
const claimStaticProperty = (frame: RuleFrame, propertyName: string) => {
	if (frame.declaredPropertyNames.has(propertyName)) {
		return !frame.holedPropertyNames.has(propertyName);
	}
	frame.declaredPropertyNames.add(propertyName);
	return true;
};

const claimHoledProperty = (frame: RuleFrame, propertyName: string) => {
	if (frame.declaredPropertyNames.has(propertyName)) return false;
	frame.declaredPropertyNames.add(propertyName);
	frame.holedPropertyNames.add(propertyName);
	return true;
};

const recordChildRule = (frame: RuleFrame): void => {
	frame.childRuleCount++;
	frame.openRunIndex = NO_OPEN_RUN;
	frame.runHoledRule = null;
	if (frame.kind === RULE_KIND.STYLE) frame.doDeclarationsCreateRuns = true;
};

//declarations after a nested rule sit in an implicit nested-declarations rule, so the block a
//setProperty addresses is the frame's own or its open run's
const holedRuleFor = (reader: StyleSheetReader, frame: RuleFrame): OpenHoledRule => {
	const isInRun = frame.openRunIndex !== NO_OPEN_RUN;
	const existing = isInRun ? frame.runHoledRule : frame.ownHoledRule;
	if (existing !== null) return existing;
	const holedRule: OpenHoledRule = {
		rulePath: isInRun ? frame.rulePath.concat(frame.openRunIndex) : frame.rulePath,
		reinsertedRulePath: frame.reinsertedRulePath,
		declarations: [],
	};
	if (isInRun) frame.runHoledRule = holedRule;
	else frame.ownHoledRule = holedRule;
	reader.holedRules.push(holedRule);
	return holedRule;
};

const readDeclaration = (
	reader: StyleSheetReader,
	frame: RuleFrame,
	declarationEnd: number,
): void => {
	const { source } = reader;
	const declarationStart = reader.index;
	const colonIndex = reader.itemColonIndex;
	reader.index = declarationEnd;
	if (colonIndex === NO_COLON) {
		failUnlessHoleFree(source, declarationStart, declarationEnd);
		return;
	}
	failUnlessHoleFree(source, declarationStart, colonIndex);
	if (frame.doDeclarationsCreateRuns && frame.openRunIndex === NO_OPEN_RUN) {
		frame.openRunIndex = frame.childRuleCount++;
	}
	const isDeclarationHolder = frame.kind === RULE_KIND.STYLE || frame.doDeclarationsCreateRuns;
	const propertyName = isDeclarationHolder
		? propertyNameOf(source, declarationStart, colonIndex)
		: NOT_A_PROPERTY_NAME;
	const valueHasHole = hasHoleBetween(source, colonIndex + 1, declarationEnd);
	if (propertyName === NOT_A_PROPERTY_NAME) {
		//an escaped name (`c\olor`) may spell a holed property, and its later write would win
		const isEscapedName = source.slice(declarationStart, colonIndex).includes("\\");
		if (valueHasHole || isEscapedName) throw NOT_ADDRESSABLE;
		return;
	}
	if (!valueHasHole) {
		if (!claimStaticProperty(frame, propertyName)) throw NOT_ADDRESSABLE;
		return;
	}
	if (!claimHoledProperty(frame, propertyName)) throw NOT_ADDRESSABLE;
	const valueParts = valuePartsOf(reader, colonIndex + 1, declarationEnd);
	const priority = splitTrailingImportantPriority(valueParts, reader.itemTopLevelBangCount);
	//a keyframe drops an !important declaration at parse time, leaving nothing to address
	const isDroppedByKeyframe = frame.isInsideKeyframes && priority === IMPORTANT_PRIORITY;
	if (isDroppedByKeyframe) throw NOT_ADDRESSABLE;
	trimValueEdgeWhitespace(valueParts);
	const declaration: HoledDeclaration = { propertyName, priority, valueParts };
	holedRuleFor(reader, frame).declarations.push(declaration);
	reader.declarationCount++;
	const { openFrames } = reader;
	for (let index = 0; index < openFrames.length - 1; index++) {
		openFrames[index].isOnDynamicPath = true;
	}
	if (frame.openRunIndex !== NO_OPEN_RUN) frame.isOnDynamicPath = true;
};

const readNestedRule = (
	reader: StyleSheetReader,
	parent: RuleFrame,
	kind: RuleKind,
	openBraceIndex: number,
): void => {
	const prelude = reader.source.slice(reader.index, openBraceIndex);
	const ruleIndex = parent.childRuleCount;
	recordChildRule(parent);
	const frame = createRuleFrame(kind, parent.rulePath.concat(ruleIndex), parent, prelude);
	reader.index = openBraceIndex + 1;
	reader.openFrames.push(frame);
	//oxlint-disable-next-line no-use-before-define -- mutual recursion
	readRuleContents(reader);
	reader.openFrames.pop();
	if (frame.isOnDynamicPath) {
		reader.ruleCountChecks.push({
			rulePath: frame.rulePath,
			expectedRuleCount: frame.childRuleCount,
		});
	}
};

const atRuleKindOf = (name: string): RuleKind => {
	if (GROUPING_AT_RULE_NAMES.has(name)) return RULE_KIND.GROUPING;
	if (name === KEYFRAMES_AT_RULE_NAME) return RULE_KIND.KEYFRAMES;
	return RULE_KIND.DESCRIPTOR;
};

const readAtRule = (reader: StyleSheetReader, parent: RuleFrame): void => {
	const { source } = reader;
	let nameEnd = reader.index + 1;
	while (isAtRuleNameCode(source.charCodeAt(nameEnd))) nameEnd++;
	const name = source.slice(reader.index + 1, nameEnd).toLowerCase();
	const preludeEnd = readItem(reader);
	failUnlessHoleFree(source, reader.index, preludeEnd);
	const isStatement = source.charCodeAt(preludeEnd) !== CHARACTER_CODE.OPEN_BRACE;
	if (isStatement) {
		recordChildRule(parent);
		reader.index =
			source.charCodeAt(preludeEnd) === CHARACTER_CODE.SEMICOLON ? preludeEnd + 1 : preludeEnd;
		return;
	}
	const kind = atRuleKindOf(name);
	if (kind === RULE_KIND.DESCRIPTOR) {
		recordChildRule(parent);
		reader.index = endOfSkippedBlock(source, preludeEnd);
		return;
	}
	readNestedRule(reader, parent, kind, preludeEnd);
};

//one block's contents up to its closing brace, or the sheet up to its end
const readRuleContents = (reader: StyleSheetReader): void => {
	const { source } = reader;
	const frame = activeFrame(reader);
	const isSheet = reader.openFrames.length === 1;
	//every pass consumes at least one character, returns or throws
	while (true) {
		reader.index = skipWhitespaceAndComments(source, reader.index);
		if (reader.index === source.length) {
			if (isSheet) return;
			throw NOT_ADDRESSABLE;
		}
		const code = source.charCodeAt(reader.index);
		if (code === CHARACTER_CODE.CLOSE_BRACE) {
			if (isSheet) throw NOT_ADDRESSABLE;
			reader.index++;
			return;
		}
		if (code === CHARACTER_CODE.SEMICOLON) {
			reader.index++;
			continue;
		}
		if (code === CHARACTER_CODE.AT) {
			readAtRule(reader, frame);
			continue;
		}
		const itemEnd = readItem(reader);
		const opensBlock = source.charCodeAt(itemEnd) === CHARACTER_CODE.OPEN_BRACE;
		if (!opensBlock) {
			readDeclaration(reader, frame, itemEnd);
			continue;
		}
		//a custom property's value may hold a {} block, which no setProperty value spells
		const holdsDeclarations = frame.kind === RULE_KIND.STYLE || frame.doDeclarationsCreateRuns;
		const isCustomPropertyWithBlock =
			holdsDeclarations &&
			reader.itemColonIndex !== NO_COLON &&
			source.startsWith(CUSTOM_PROPERTY_PREFIX, skipWhitespaceAndComments(source, reader.index));
		if (isCustomPropertyWithBlock) throw NOT_ADDRESSABLE;
		failUnlessHoleFree(source, reader.index, itemEnd);
		readNestedRule(reader, frame, RULE_KIND.STYLE, itemEnd);
	}
};

export const compileStyleSheet = (
	parts: ReadonlyArray<Part>,
): CompiledStyleSheet | typeof STYLE_SHEET_NOT_COMPILED => {
	let source = "";
	const holeValueIndexes: Array<number> = [];
	for (let index = 0; index < parts.length; index++) {
		const part = parts[index];
		if (typeof part === "number") {
			source += HOLE;
			holeValueIndexes.push(part);
		} else source += part;
	}
	const sheetFrame = createRuleFrame(RULE_KIND.GROUPING, [], null, "");
	const reader: StyleSheetReader = {
		source,
		index: 0,
		holeValueIndexes,
		readHoleCount: 0,
		itemColonIndex: NO_COLON,
		itemTopLevelBangCount: 0,
		openFrames: [sheetFrame],
		holedRules: [],
		ruleCountChecks: [],
		declarationCount: 0,
	};
	try {
		readRuleContents(reader);
	} catch (error) {
		if (error === NOT_ADDRESSABLE) return STYLE_SHEET_NOT_COMPILED;
		throw error;
	}
	assertDuringDevelopment(
		reader.readHoleCount === holeValueIndexes.length,
		"every hole outside a declaration value fails the compile, so each one was read as a value",
	);
	if (reader.declarationCount === 0) return STYLE_SHEET_NOT_COMPILED;
	reader.ruleCountChecks.push({
		rulePath: sheetFrame.rulePath,
		expectedRuleCount: sheetFrame.childRuleCount,
	});
	return {
		holedRules: reader.holedRules,
		ruleCountChecks: reader.ruleCountChecks,
		declarationCount: reader.declarationCount,
	};
};
