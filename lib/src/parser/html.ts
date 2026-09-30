import { stringListHash } from "../utils/hashing";
import {
	BINDING,
	NO_KEY,
	OPEN_CONSTRUCT,
	STYLE_SHEET_NOT_COMPILED,
} from "./constants";
import { ParsedTemplate, Part, StaticBinding } from "./types";
import { CHAR_CODE, isQuoteCode, isWhitespaceCode, MARKUP } from "./chars";
import { compileStyleSheet } from "./css";
import { decodeTextareaParts } from "./rcdata";
import { ValueOf } from "../utils/types";
import { assertDuringDevelopment, libraryMessage } from "../utils/diagnostics";

type StateValue = ValueOf<typeof STATE>;

const PLACEHOLDER_TAG = "div";
const TEMPLATE_TAG = "template";
const SCRIPT_TAG = "script";
const TEXTAREA_TAG = "textarea";
const STYLE_TAG = "style";
const COMMENT_OPEN_LENGTH = MARKUP.COMMENT_OPEN.length;
const COMMENT_CLOSE_LENGTH = MARKUP.COMMENT_CLOSE.length;
const COMMENT_DASHES_LENGTH = "--".length;
const END_TAG_OPEN_LENGTH = MARKUP.END_TAG_OPEN.length;
const NO_OPEN_CONSTRUCT = -1;
type OpenConstructKind =
	ValueOf<typeof OPEN_CONSTRUCT> | typeof NO_OPEN_CONSTRUCT;
const parsesContentAsRaw = (parser: ParserState, tag: string) => {
	if (tag === TEMPLATE_TAG)
		return parser.rootTemplate !== ROOT_TEMPLATE.IS_THE_CURRENT_TAG;
	return tag === STYLE_TAG || tag === TEXTAREA_TAG || tag === SCRIPT_TAG;
};

const STATE = {
	COMMENT: 0,
	RAW_CONTENT: 1,
	TAG: 2,
	ATTRIBUTE_KEY: 3,
	ATTRIBUTE_VALUE: 4,
	TEXT: 5,
	ELEMENT: 6,
	END_TAG: 7,
} as const;

type BindingStartingState = Exclude<
	StateValue,
	typeof STATE.ELEMENT | typeof STATE.END_TAG
>;

//TEXT starts a binding but captures no parts: its hole becomes a marker pair, not a slice
type HoleCapturingState = Exclude<BindingStartingState, typeof STATE.TEXT>;

type HoleCapturingParts = [
	comment: Array<Part>,
	rawContent: Array<Part>,
	tagName: Array<Part>,
	attributeName: Array<Part>,
	attributeValue: Array<Part>,
];

const OPEN_CONSTRUCT_FOR_STATE: Record<
	BindingStartingState,
	ValueOf<typeof OPEN_CONSTRUCT>
> = [
	OPEN_CONSTRUCT.COMMENT,
	OPEN_CONSTRUCT.RAW_CONTENT,
	OPEN_CONSTRUCT.TAG,
	OPEN_CONSTRUCT.ATTRIBUTE,
	OPEN_CONSTRUCT.ATTRIBUTE,
	OPEN_CONSTRUCT.CONTENT,
];

const PARSE_MODE = { OPTIMISTIC_ROOT: 30, NO_ROOT_TEMPLATE: 31 } as const;
type ParseMode = ValueOf<typeof PARSE_MODE>;

const ROOT_TEMPLATE = {
	UNDECIDED: 40,
	RULED_OUT: 41,
	IS_THE_CURRENT_TAG: 42,
	CONTENT_OPEN: 43,
	CLOSED: 44,
} as const;
type RootTemplateState = ValueOf<typeof ROOT_TEMPLATE>;

//scan helpers write this struct directly: each moves three or four cursor fields, and returning
//them costs an object per character or one loop of every scanner. Parsing runs once per template
interface ParserState {
	state: StateValue;
	bindings: Array<StaticBinding>;
	startedBindingCount: number;
	openConstructKind: OpenConstructKind;
	templates: TemplateStringsArray;
	index: number;
	activeTemplate: string;
	charIndex: number;
	splitIndex: number;
	hostBindingCount: number;
	attributeQuoteCode: number;
	currentTagName: string;
	isSelfClosing: boolean;
	rootTemplate: RootTemplateState;
	hasSeenTopLevelSibling: boolean;
	hasStyleSheetBinding: boolean;
	keyValueParts: Array<Part> | typeof NO_KEY;
	parts: HoleCapturingParts;
	openTagIsDynamic: Array<boolean>;
	resultMarkup: string;
	elementMarkup: string;
	contentMarkup: string;
	endTagMarkup: string;
}

const createParser = (
	strings: TemplateStringsArray,
	mode: ParseMode,
): ParserState => ({
	state: STATE.TEXT,
	bindings: [],
	startedBindingCount: 0,
	openConstructKind: NO_OPEN_CONSTRUCT,
	templates: strings,
	index: 0,
	activeTemplate: strings[0],
	charIndex: 0,
	splitIndex: 0,
	hostBindingCount: 0,
	attributeQuoteCode: 0,
	currentTagName: "",
	isSelfClosing: false,
	rootTemplate:
		mode === PARSE_MODE.NO_ROOT_TEMPLATE
			? ROOT_TEMPLATE.RULED_OUT
			: ROOT_TEMPLATE.UNDECIDED,
	hasSeenTopLevelSibling: false,
	hasStyleSheetBinding: false,
	keyValueParts: NO_KEY,
	parts: [[], [], [], [], []],
	openTagIsDynamic: [],
	resultMarkup: "",
	elementMarkup: "",
	contentMarkup: "",
	endTagMarkup: "",
});

const asComment = (markerData: string) =>
	`${MARKUP.COMMENT_OPEN}${markerData}${MARKUP.COMMENT_CLOSE}`;

const openMarkerData = (parser: ParserState) =>
	`${MARKUP.COMMENT_IDENTIFIER} ${parser.openConstructKind}-${parser.startedBindingCount - 1}`;

const closeMarkerData = (parser: ParserState) =>
	`${MARKUP.COMMENT_IDENTIFIER} /${parser.openConstructKind}-${parser.startedBindingCount - 1}`;

const openComment = (parser: ParserState) => asComment(openMarkerData(parser));

const hasOpenConstruct = (parser: ParserState) =>
	parser.openConstructKind !== NO_OPEN_CONSTRUCT;

const takeParts = (parser: ParserState, state: HoleCapturingState) => {
	const taken = parser.parts[state];
	parser.parts[state] = [];
	return taken;
};

const updateBinding = (parser: ParserState) => {
	if (parser.state === STATE.TEXT) {
		const closeMarker = closeMarkerData(parser);
		parser.contentMarkup +=
			sliceActiveTemplate(parser, parser.splitIndex) +
			openComment(parser) +
			asComment(closeMarker);
		parser.bindings.push({
			type: BINDING.CONTENT,
			valueIndex: parser.index,
			closeMarkerData: closeMarker,
		});
		parser.openConstructKind = NO_OPEN_CONSTRUCT;
		if (parser.openTagIsDynamic.length === 0)
			parser.hasSeenTopLevelSibling = true;
		return;
	}

	if (parser.state === STATE.END_TAG) {
		parser.endTagMarkup += sliceActiveTemplate(parser, parser.splitIndex);
		return;
	}

	assertDuringDevelopment(
		parser.state !== STATE.ELEMENT,
		"a hole right after a quoted attribute value throws before it starts a binding",
	);
	const parts = parser.parts[parser.state];
	capture(parser, parts, parser.splitIndex);
	parts.push(parser.index);
};

const emptyBinding = (
	openConstructKind: Exclude<
		OpenConstructKind,
		typeof OPEN_CONSTRUCT.CONTENT | typeof NO_OPEN_CONSTRUCT
	>,
): StaticBinding => {
	switch (openConstructKind) {
		case OPEN_CONSTRUCT.COMMENT:
			return { type: BINDING.COMMENT, parts: [] };
		case OPEN_CONSTRUCT.RAW_CONTENT:
			return {
				type: BINDING.RAW_CONTENT,
				parts: [],
				compiledStyleSheet: STYLE_SHEET_NOT_COMPILED,
			};
		case OPEN_CONSTRUCT.TAG:
			return { type: BINDING.TAG, parts: [] };
		case OPEN_CONSTRUCT.ATTRIBUTE:
			return { type: BINDING.ATTRIBUTE, nameParts: [], valueParts: [""] };
		default:
			return openConstructKind satisfies never;
	}
};

const sliceActiveTemplate = (
	parser: ParserState,
	start: number,
	end?: number,
) => {
	if (end !== undefined && end <= start) return "";
	return parser.activeTemplate.slice(start, end);
};

const capture = (
	parser: ParserState,
	parts: Array<Part>,
	start: number,
	end?: number,
) => {
	const slice = sliceActiveTemplate(parser, start, end);
	if (slice) parts.push(slice);
};

const drainPartsAsMarkup = (parts: Array<Part>) => {
	const markup = parts.join("");
	parts.length = 0;
	return markup;
};

const completeComment = (parser: ParserState) => {
	if (!hasOpenConstruct(parser)) {
		parser.contentMarkup += asComment(
			drainPartsAsMarkup(parser.parts[STATE.COMMENT]),
		);
		return;
	}
	//the first dynamic comment is the list key: it never reaches the DOM, so its binding is
	//dropped here and the marker walkers never have to account for a binding index without a marker
	if (parser.keyValueParts === NO_KEY) {
		parser.keyValueParts = takeParts(parser, STATE.COMMENT);
		parser.startedBindingCount--;
		return;
	}
	parser.contentMarkup += openComment(parser) + MARKUP.EMPTY_COMMENT;
	parser.bindings.push({
		type: BINDING.COMMENT,
		parts: takeParts(parser, STATE.COMMENT),
	});
};

const completeRawContent = (parser: ParserState) => {
	if (!hasOpenConstruct(parser)) {
		parser.contentMarkup += drainPartsAsMarkup(parser.parts[STATE.RAW_CONTENT]);
		return;
	}
	parser.resultMarkup += openComment(parser);
	const parts = takeParts(parser, STATE.RAW_CONTENT);
	if (parser.currentTagName === TEXTAREA_TAG) decodeTextareaParts(parts);
	//the sheet text is composed with literal values at first commit, while the clone is
	//still detached — the cached markup deliberately carries an empty <style>
	const compiledStyleSheet =
		parser.currentTagName === STYLE_TAG
			? compileStyleSheet(parts)
			: STYLE_SHEET_NOT_COMPILED;
	if (compiledStyleSheet !== STYLE_SHEET_NOT_COMPILED)
		parser.hasStyleSheetBinding = true;
	parser.bindings.push({
		type: BINDING.RAW_CONTENT,
		parts,
		compiledStyleSheet,
	});
};

const rootTemplateAfterANonRootTag = (
	rootTemplate: RootTemplateState,
): RootTemplateState => {
	switch (rootTemplate) {
		case ROOT_TEMPLATE.UNDECIDED:
			return ROOT_TEMPLATE.RULED_OUT;
		case ROOT_TEMPLATE.IS_THE_CURRENT_TAG:
			return ROOT_TEMPLATE.CONTENT_OPEN;
		default:
			return rootTemplate;
	}
};

const completeTag = (parser: ParserState) => {
	//in the second pass the root template is already ruled out, and nothing there reads a sibling
	const isFirstTag = parser.rootTemplate === ROOT_TEMPLATE.UNDECIDED;

	const isTopLevelSibling = !isFirstTag && parser.openTagIsDynamic.length === 0;
	if (isTopLevelSibling) parser.hasSeenTopLevelSibling = true;

	if (hasOpenConstruct(parser)) {
		parser.currentTagName = PLACEHOLDER_TAG;
		parser.elementMarkup += PLACEHOLDER_TAG;
		parser.resultMarkup += openComment(parser);
		parser.bindings.push({
			type: BINDING.TAG,
			parts: takeParts(parser, STATE.TAG),
		});
		parser.openTagIsDynamic.push(true);
		parser.rootTemplate = rootTemplateAfterANonRootTag(parser.rootTemplate);
		return;
	}

	const tagNameParts = parser.parts[STATE.TAG];
	const staticTagName = tagNameParts[0];
	assertDuringDevelopment(
		typeof staticTagName === "string",
		"a tag name without a hole is captured as one text part",
	);
	parser.currentTagName = staticTagName;

	const isRoot =
		parser.rootTemplate === ROOT_TEMPLATE.UNDECIDED &&
		!parser.hasSeenTopLevelSibling &&
		parser.currentTagName === TEMPLATE_TAG;

	if (isRoot) {
		parser.rootTemplate = ROOT_TEMPLATE.IS_THE_CURRENT_TAG;
		tagNameParts.length = 0;
	} else {
		parser.rootTemplate = rootTemplateAfterANonRootTag(parser.rootTemplate);
		parser.elementMarkup += drainPartsAsMarkup(tagNameParts);
	}
	parser.openTagIsDynamic.push(false);
};

const completeEndTag = (parser: ParserState) => {
	const openerIsDynamic = parser.openTagIsDynamic.pop();
	const rootTemplateIsOpen =
		parser.rootTemplate === ROOT_TEMPLATE.IS_THE_CURRENT_TAG ||
		parser.rootTemplate === ROOT_TEMPLATE.CONTENT_OPEN;
	const closesRootTemplate =
		rootTemplateIsOpen && parser.openTagIsDynamic.length === 0;
	if (closesRootTemplate) {
		parser.rootTemplate = ROOT_TEMPLATE.CLOSED;
		parser.endTagMarkup = "";
		return;
	}
	const isDynamicClose = hasOpenConstruct(parser);
	if (isDynamicClose && !openerIsDynamic)
		throw new Error(
			libraryMessage(
				"asymmetric tag: a dynamic </${...}> close cannot pair with a static open tag. Make the open dynamic too.",
			),
		);
	if (!isDynamicClose && openerIsDynamic)
		throw new Error(
			libraryMessage(
				"asymmetric tag: a static end tag cannot pair with a dynamic <${...}> open tag. Make the close dynamic too.",
			),
		);
	if (isDynamicClose) parser.endTagMarkup = PLACEHOLDER_TAG;
	parser.resultMarkup +=
		MARKUP.END_TAG_OPEN + parser.endTagMarkup + MARKUP.TAG_CLOSE;
	parser.endTagMarkup = "";
};

const rangeHasNonWhitespace = (
	parser: ParserState,
	start: number,
	end: number,
) => {
	for (let scanIndex = start; scanIndex < end; scanIndex++)
		if (!isWhitespaceCode(parser.activeTemplate.charCodeAt(scanIndex)))
			return true;
	return false;
};

const markTopLevelTextSibling = (
	parser: ParserState,
	start: number,
	end: number,
) => {
	parser.contentMarkup += sliceActiveTemplate(parser, start, end);
	const isTopLevelText =
		parser.openTagIsDynamic.length === 0 &&
		rangeHasNonWhitespace(parser, start, end);
	if (isTopLevelText) parser.hasSeenTopLevelSibling = true;
};

const drainAttributeBinding = (parser: ParserState): StaticBinding => {
	const nameParts = takeParts(parser, STATE.ATTRIBUTE_KEY);
	const valueParts = takeParts(parser, STATE.ATTRIBUTE_VALUE);
	const isExpandableSpread =
		valueParts.length === 0 &&
		nameParts.length === 1 &&
		typeof nameParts[0] === "number";

	if (isExpandableSpread)
		return {
			type: BINDING.DYNAMIC_ATTRIBUTE,
			valueIndex: nameParts[0] as number,
		};
	return {
		type: BINDING.ATTRIBUTE,
		nameParts,
		valueParts: valueParts.length > 0 ? valueParts : [""],
	};
};

const completeAttribute = (parser: ParserState) => {
	const isOnRootTemplate =
		parser.rootTemplate === ROOT_TEMPLATE.IS_THE_CURRENT_TAG;
	if (hasOpenConstruct(parser)) {
		parser.bindings.push(drainAttributeBinding(parser));
		if (isOnRootTemplate) parser.hostBindingCount++;
		else parser.resultMarkup += openComment(parser);
		return;
	}
	if (parser.parts[STATE.ATTRIBUTE_KEY].length === 0) return;
	if (isOnRootTemplate) {
		//a static host attribute emits no marker but still owns a binding index, and every marker
		//after it is numbered from this count
		parser.startedBindingCount++;
		parser.bindings.push(drainAttributeBinding(parser));
		parser.hostBindingCount++;
		return;
	}
	parser.elementMarkup +=
		MARKUP.ATTRIBUTE_SEPARATOR +
		drainPartsAsMarkup(parser.parts[STATE.ATTRIBUTE_KEY]);
	if (parser.parts[STATE.ATTRIBUTE_VALUE].length)
		parser.elementMarkup +=
			MARKUP.ATTRIBUTE_ASSIGN +
			MARKUP.ATTRIBUTE_QUOTE +
			drainPartsAsMarkup(parser.parts[STATE.ATTRIBUTE_VALUE]) +
			MARKUP.ATTRIBUTE_QUOTE;
};

const resetElementScope = (parser: ParserState) => {
	parser.isSelfClosing = false;
	parser.currentTagName = "";
	parser.parts[STATE.TAG].length = 0;
};

const flushElement = (parser: ParserState) => {
	if (parser.elementMarkup === "") {
		parser.resultMarkup += parser.contentMarkup;
		parser.contentMarkup = "";
		resetElementScope(parser);
		return;
	}

	parser.resultMarkup +=
		MARKUP.TAG_OPEN + parser.elementMarkup + MARKUP.TAG_CLOSE;
	parser.elementMarkup = "";
	if (parser.isSelfClosing)
		parser.resultMarkup +=
			MARKUP.END_TAG_OPEN + parser.currentTagName + MARKUP.TAG_CLOSE;
	parser.resultMarkup += parser.contentMarkup;
	parser.contentMarkup = "";

	resetElementScope(parser);
};

const closeOpenTag = (parser: ParserState) => {
	parser.splitIndex = parser.charIndex + 1;
	const endsWithSlash =
		parser.activeTemplate.charCodeAt(parser.charIndex - 1) === CHAR_CODE.SLASH;
	if (endsWithSlash) {
		parser.openTagIsDynamic.pop();
		parser.isSelfClosing = true;
		flushElement(parser);
		parser.state = STATE.TEXT;
		return;
	}
	parser.state = parsesContentAsRaw(parser, parser.currentTagName)
		? STATE.RAW_CONTENT
		: STATE.TEXT;
};

const endAttribute = (parser: ParserState, parts: Array<Part>) => {
	capture(parser, parts, parser.splitIndex, parser.charIndex);
	completeAttribute(parser);
	parser.openConstructKind = NO_OPEN_CONSTRUCT;
	parser.attributeQuoteCode = 0;
	parser.state = STATE.ELEMENT;
};

const scanText = (parser: ParserState) => {
	const tagStart = parser.activeTemplate.indexOf(
		MARKUP.TAG_OPEN,
		parser.charIndex,
	);
	if (tagStart === -1) {
		parser.charIndex = parser.activeTemplate.length;
		return;
	}
	parser.charIndex = tagStart;
	markTopLevelTextSibling(parser, parser.splitIndex, parser.charIndex);
	parser.splitIndex = parser.charIndex + 1;

	const nextCode = parser.activeTemplate.charCodeAt(parser.charIndex + 1);

	if (nextCode === CHAR_CODE.BANG) {
		parser.state = STATE.COMMENT;
		parser.splitIndex = parser.charIndex + COMMENT_OPEN_LENGTH;
		//resume on the "--" so an empty <!----> still matches its "-->"
		parser.charIndex += COMMENT_OPEN_LENGTH - COMMENT_DASHES_LENGTH;
		return;
	}

	if (nextCode === CHAR_CODE.SLASH) {
		parser.state = STATE.END_TAG;
		parser.splitIndex = parser.charIndex + END_TAG_OPEN_LENGTH;
		parser.charIndex++;
		return;
	}

	flushElement(parser);
	parser.state = STATE.ELEMENT;
	parser.charIndex--;
};

const scanComment = (parser: ParserState) => {
	//searching from the opener's dashes is what lets the abrupt "<!-->" close on them
	const commentClose = parser.activeTemplate.indexOf(
		MARKUP.COMMENT_CLOSE,
		parser.charIndex - COMMENT_DASHES_LENGTH,
	);
	if (commentClose === -1) {
		parser.charIndex = parser.activeTemplate.length;
		return;
	}

	//on the closing ">", which the loop's own step moves past
	parser.charIndex = commentClose + COMMENT_CLOSE_LENGTH - 1;
	capture(parser, parser.parts[STATE.COMMENT], parser.splitIndex, commentClose);
	parser.splitIndex = parser.charIndex + 1;
	completeComment(parser);
	parser.openConstructKind = NO_OPEN_CONSTRUCT;
	parser.state = STATE.TEXT;
};

const scanRawContent = (parser: ParserState) => {
	const closeTagStart = parser.activeTemplate.indexOf(
		MARKUP.END_TAG_OPEN,
		parser.charIndex,
	);
	if (closeTagStart === -1) {
		parser.charIndex = parser.activeTemplate.length;
		return;
	}

	parser.charIndex = closeTagStart;
	const closesCurrentElement = parser.activeTemplate.startsWith(
		parser.currentTagName,
		parser.charIndex + END_TAG_OPEN_LENGTH,
	);
	if (!closesCurrentElement) return;
	capture(
		parser,
		parser.parts[STATE.RAW_CONTENT],
		parser.splitIndex,
		parser.charIndex,
	);
	parser.splitIndex =
		parser.charIndex + END_TAG_OPEN_LENGTH + parser.currentTagName.length;
	parser.charIndex += 1;
	completeRawContent(parser);
	parser.openConstructKind = NO_OPEN_CONSTRUCT;
	parser.state = STATE.END_TAG;
	parser.endTagMarkup += parser.currentTagName;
};

const scanTagName = (parser: ParserState, code: number) => {
	const endsTagName = code === CHAR_CODE.GREATER_THAN || isWhitespaceCode(code);
	if (!endsTagName) return;

	const isSelfClosing =
		code === CHAR_CODE.GREATER_THAN &&
		parser.activeTemplate.charCodeAt(parser.charIndex - 1) === CHAR_CODE.SLASH;
	const tagEnd = isSelfClosing ? parser.charIndex - 1 : parser.charIndex;
	capture(parser, parser.parts[STATE.TAG], parser.splitIndex, tagEnd);
	parser.splitIndex = parser.charIndex;
	completeTag(parser);
	parser.openConstructKind = NO_OPEN_CONSTRUCT;

	if (code !== CHAR_CODE.GREATER_THAN) {
		parser.state = STATE.ELEMENT;
		parser.charIndex--;
		return;
	}

	closeOpenTag(parser);
};

const scanBetweenAttributes = (parser: ParserState, code: number) => {
	if (code === CHAR_CODE.LESS_THAN) {
		parser.state = STATE.TAG;
		return;
	}

	if (code === CHAR_CODE.GREATER_THAN) {
		closeOpenTag(parser);
		return;
	}

	parser.state = STATE.ATTRIBUTE_KEY;
	if (!isWhitespaceCode(code)) {
		parser.splitIndex = parser.charIndex;
		parser.charIndex--;
		return;
	}

	//an indented tag separates its attributes with a whole run of whitespace,
	//and every character of it would otherwise open and close an empty attribute
	const templateLength = parser.activeTemplate.length;
	let attributeStart = parser.charIndex + 1;
	while (
		attributeStart < templateLength &&
		isWhitespaceCode(parser.activeTemplate.charCodeAt(attributeStart))
	)
		attributeStart++;
	parser.splitIndex = attributeStart;
	parser.charIndex = attributeStart - 1;
};

const scanAttributeKey = (parser: ParserState, code: number) => {
	if (code === CHAR_CODE.EQUALS) {
		capture(
			parser,
			parser.parts[STATE.ATTRIBUTE_KEY],
			parser.splitIndex,
			parser.charIndex,
		);
		parser.splitIndex = parser.charIndex + 1;
		parser.state = STATE.ATTRIBUTE_VALUE;
		return;
	}
	if (isWhitespaceCode(code)) {
		endAttribute(parser, parser.parts[STATE.ATTRIBUTE_KEY]);
		parser.splitIndex = parser.charIndex;
		parser.charIndex--;
		return;
	}
	const startsSelfClosingEnd =
		code === CHAR_CODE.SLASH &&
		parser.activeTemplate.charCodeAt(parser.charIndex + 1) ===
			CHAR_CODE.GREATER_THAN;
	if (startsSelfClosingEnd) {
		endAttribute(parser, parser.parts[STATE.ATTRIBUTE_KEY]);
		return;
	}
	if (code !== CHAR_CODE.GREATER_THAN) return;
	endAttribute(parser, parser.parts[STATE.ATTRIBUTE_KEY]);
	parser.charIndex--;
};

const scanAttributeValue = (parser: ParserState, code: number) => {
	const isInsideQuotes = parser.attributeQuoteCode !== 0;
	if (isInsideQuotes) {
		if (code !== parser.attributeQuoteCode) return;
		endAttribute(parser, parser.parts[STATE.ATTRIBUTE_VALUE]);
		parser.splitIndex = parser.charIndex + 1;
		return;
	}
	if (isQuoteCode(code)) {
		parser.attributeQuoteCode = code;
		parser.splitIndex = parser.charIndex + 1;
		//nothing between the quotes can end the value, so the scan is a search
		const closingQuote = parser.activeTemplate.indexOf(
			String.fromCharCode(code),
			parser.splitIndex,
		);
		if (closingQuote === -1) {
			parser.charIndex = parser.activeTemplate.length;
			return;
		}
		parser.charIndex = closingQuote;
		endAttribute(parser, parser.parts[STATE.ATTRIBUTE_VALUE]);
		parser.splitIndex = parser.charIndex + 1;
		return;
	}
	if (isWhitespaceCode(code)) {
		endAttribute(parser, parser.parts[STATE.ATTRIBUTE_VALUE]);
		parser.splitIndex = parser.charIndex;
		parser.charIndex--;
		return;
	}
	if (code !== CHAR_CODE.GREATER_THAN) return;
	endAttribute(parser, parser.parts[STATE.ATTRIBUTE_VALUE]);
	parser.charIndex--;
};

const scanEndTag = (parser: ParserState, code: number) => {
	if (code !== CHAR_CODE.GREATER_THAN) return;
	parser.endTagMarkup += sliceActiveTemplate(
		parser,
		parser.splitIndex,
		parser.charIndex,
	);
	parser.splitIndex = parser.charIndex + 1;
	flushElement(parser);
	completeEndTag(parser);
	parser.openConstructKind = NO_OPEN_CONSTRUCT;
	parser.state = STATE.TEXT;
};

const startBindingAtHole = (parser: ParserState) => {
	if (parser.state === STATE.END_TAG) {
		const openerIsDynamic =
			parser.openTagIsDynamic[parser.openTagIsDynamic.length - 1];
		if (!openerIsDynamic)
			throw new Error(
				libraryMessage(
					"asymmetric tag: a dynamic </${...}> close has no matching dynamic open tag. Pair `<${tag}>` with `</${tag}>`.",
				),
			);
		parser.openConstructKind = OPEN_CONSTRUCT.TAG;
		return;
	}
	//a quoted value ends its attribute on the quote, so a hole right after it belongs to no attribute
	if (parser.state === STATE.ELEMENT)
		throw new Error(
			libraryMessage(
				'a ${…} right after a quoted attribute value belongs to no attribute. Put a space before it: a="1" ${…}',
			),
		);
	parser.startedBindingCount++;
	parser.openConstructKind = OPEN_CONSTRUCT_FOR_STATE[parser.state];
};

const parse = (
	strings: TemplateStringsArray,
	mode: ParseMode = PARSE_MODE.OPTIMISTIC_ROOT,
): ParsedTemplate => {
	const parser = createParser(strings, mode);

	for (
		parser.index = 0;
		parser.index < parser.templates.length;
		parser.index++
	) {
		parser.activeTemplate = parser.templates[parser.index];
		parser.splitIndex = 0;
		const templateLength = parser.activeTemplate.length;

		for (
			parser.charIndex = 0;
			parser.charIndex < templateLength;
			parser.charIndex++
		) {
			const code = parser.activeTemplate.charCodeAt(parser.charIndex);

			switch (parser.state) {
				case STATE.TEXT:
					scanText(parser);
					break;
				case STATE.COMMENT:
					scanComment(parser);
					break;
				case STATE.RAW_CONTENT:
					scanRawContent(parser);
					break;
				case STATE.TAG:
					scanTagName(parser, code);
					break;
				case STATE.ELEMENT:
					scanBetweenAttributes(parser, code);
					break;
				case STATE.ATTRIBUTE_KEY:
					scanAttributeKey(parser, code);
					break;
				case STATE.ATTRIBUTE_VALUE:
					scanAttributeValue(parser, code);
					break;
				case STATE.END_TAG:
					scanEndTag(parser, code);
					break;
				default:
					return parser.state satisfies never;
			}
		}

		if (parser.index + 1 >= parser.templates.length) break;
		if (!hasOpenConstruct(parser)) startBindingAtHole(parser);
		updateBinding(parser);
	}
	const hasTrailingText =
		parser.state === STATE.TEXT &&
		parser.splitIndex < parser.activeTemplate.length;
	if (hasTrailingText)
		markTopLevelTextSibling(
			parser,
			parser.splitIndex,
			parser.activeTemplate.length,
		);
	flushElement(parser);

	//a started binding that never reached its completion is still owed a binding index
	if (parser.bindings.length < parser.startedBindingCount) {
		const { openConstructKind } = parser;
		assertDuringDevelopment(
			openConstructKind !== OPEN_CONSTRUCT.CONTENT &&
				openConstructKind !== NO_OPEN_CONSTRUCT,
			"a content hole completes as it starts, so only another construct is left open",
		);
		parser.bindings.push(emptyBinding(openConstructKind));
	}

	const hasRootTemplate =
		parser.rootTemplate !== ROOT_TEMPLATE.UNDECIDED &&
		parser.rootTemplate !== ROOT_TEMPLATE.RULED_OUT;
	const isFirstPass = mode === PARSE_MODE.OPTIMISTIC_ROOT;
	if (isFirstPass && hasRootTemplate && parser.hasSeenTopLevelSibling)
		return parse(strings, PARSE_MODE.NO_ROOT_TEMPLATE);

	return {
		htmlWithMarkers: parser.resultMarkup,
		bindings: parser.bindings,
		templateHash: stringListHash(strings),
		hostBindingCount: parser.hostBindingCount,
		keyValueParts: parser.keyValueParts,
		hasStyleSheetBinding: parser.hasStyleSheetBinding,
	};
};

//a tagged template hands back the same strings array every time it runs, so one parse serves every
//render of that template for as long as the page holds it
const parseCache = new WeakMap<TemplateStringsArray, ParsedTemplate>();

export const getParsedTemplate = (
	templateStrings: TemplateStringsArray,
): ParsedTemplate => {
	const cached = parseCache.get(templateStrings);
	if (cached !== undefined) return cached;
	const parsed = parse(templateStrings);
	parseCache.set(templateStrings, parsed);
	return parsed;
};
