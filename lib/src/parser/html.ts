import { stringListHash } from "../utils/hashing";
import {
	BINDING,
	NO_KEY,
	OPEN_CONSTRUCT,
	STYLE_SHEET_NOT_COMPILED,
} from "./constants";
import { ParsedTemplate, Part, StaticBinding } from "./types";
import {
	CHARACTER_CODE,
	isQuoteCode,
	isWhitespaceCode,
	MARKUP,
} from "./characters";
import { compileStyleSheet } from "./css";
import { decodeTextareaParts } from "./rcdata";
import { ValueOf } from "../utils/types";
import {
	assertDuringDevelopment,
	libraryMessage,
	warnDuringDevelopment,
} from "../utils/diagnostics";

type StateKind = ValueOf<typeof STATE>;

const PLACEHOLDER_TAG = "div";
const TEMPLATE_TAG = "template";
const SCRIPT_TAG = "script";
const TEXTAREA_TAG = "textarea";
const SELECT_TAG = "select";
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
	StateKind,
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
type ParseModeKind = ValueOf<typeof PARSE_MODE>;

const ROOT_TEMPLATE = {
	UNDECIDED: 40,
	RULED_OUT: 41,
	IS_THE_CURRENT_TAG: 42,
	CONTENT_OPEN: 43,
	CLOSED: 44,
} as const;
type RootTemplateKind = ValueOf<typeof ROOT_TEMPLATE>;

//scan helpers write this struct directly: each moves three or four cursor fields, and returning
//them costs an object per character or one loop of every scanner. Parsing runs once per template
interface ParserState {
	scanState: StateKind;
	bindings: Array<StaticBinding>;
	startedBindingCount: number;
	openConstructKind: OpenConstructKind;
	templateStrings: TemplateStringsArray;
	stringIndex: number;
	activeString: string;
	characterIndex: number;
	splitIndex: number;
	hostBindingCount: number;
	attributeQuoteCode: number;
	currentTagName: string;
	isSelfClosing: boolean;
	rootTemplate: RootTemplateKind;
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
	mode: ParseModeKind,
): ParserState => ({
	scanState: STATE.TEXT,
	bindings: [],
	startedBindingCount: 0,
	openConstructKind: NO_OPEN_CONSTRUCT,
	templateStrings: strings,
	stringIndex: 0,
	activeString: strings[0],
	characterIndex: 0,
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

const openMarkerComment = (parser: ParserState) =>
	asComment(openMarkerData(parser));

const hasOpenConstruct = (parser: ParserState) =>
	parser.openConstructKind !== NO_OPEN_CONSTRUCT;

const takeParts = (parser: ParserState, state: HoleCapturingState) => {
	const taken = parser.parts[state];
	parser.parts[state] = [];
	return taken;
};

const recordHole = (parser: ParserState) => {
	if (parser.scanState === STATE.TEXT) {
		const closeMarker = closeMarkerData(parser);
		parser.contentMarkup +=
			sliceActiveString(parser, parser.splitIndex) +
			openMarkerComment(parser) +
			asComment(closeMarker);
		parser.bindings.push({
			type: BINDING.CONTENT,
			valueIndex: parser.stringIndex,
			closeMarkerData: closeMarker,
		});
		parser.openConstructKind = NO_OPEN_CONSTRUCT;
		if (parser.openTagIsDynamic.length === 0)
			parser.hasSeenTopLevelSibling = true;
		return;
	}

	if (parser.scanState === STATE.END_TAG) {
		parser.endTagMarkup += sliceActiveString(parser, parser.splitIndex);
		return;
	}

	assertDuringDevelopment(
		parser.scanState !== STATE.ELEMENT,
		"a hole right after a quoted attribute value throws before it starts a binding",
	);
	const parts = parser.parts[parser.scanState];
	appendSlice(parser, parts, parser.splitIndex);
	parts.push(parser.stringIndex);
};

const createEmptyBinding = (
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

const sliceActiveString = (
	parser: ParserState,
	start: number,
	end?: number,
) => {
	if (end !== undefined && end <= start) return "";
	return parser.activeString.slice(start, end);
};

const appendSlice = (
	parser: ParserState,
	parts: Array<Part>,
	start: number,
	end?: number,
) => {
	const slice = sliceActiveString(parser, start, end);
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
	parser.contentMarkup += openMarkerComment(parser) + MARKUP.EMPTY_COMMENT;
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
	parser.resultMarkup += openMarkerComment(parser);
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

const rootTemplateAfterNonRootTag = (
	rootTemplate: RootTemplateKind,
): RootTemplateKind => {
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
		parser.resultMarkup += openMarkerComment(parser);
		parser.bindings.push({
			type: BINDING.TAG,
			parts: takeParts(parser, STATE.TAG),
		});
		parser.openTagIsDynamic.push(true);
		parser.rootTemplate = rootTemplateAfterNonRootTag(parser.rootTemplate);
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
		parser.rootTemplate = rootTemplateAfterNonRootTag(parser.rootTemplate);
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
		if (!isWhitespaceCode(parser.activeString.charCodeAt(scanIndex)))
			return true;
	return false;
};

const appendTextAndMarkTopLevelSibling = (
	parser: ParserState,
	start: number,
	end: number,
) => {
	parser.contentMarkup += sliceActiveString(parser, start, end);
	const isTopLevelText =
		parser.openTagIsDynamic.length === 0 &&
		rangeHasNonWhitespace(parser, start, end);
	if (isTopLevelText) parser.hasSeenTopLevelSibling = true;
};

const takeAttributeBinding = (parser: ParserState): StaticBinding => {
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

//<select> has no value attribute, and its options are not there yet when its own bindings commit
const warnOnSelectValueBinding = (
	parser: ParserState,
	binding: StaticBinding,
): void => {
	if (parser.currentTagName !== SELECT_TAG) return;
	if (binding.type !== BINDING.ATTRIBUTE) return;
	const [name] = binding.nameParts;
	const isValueName =
		binding.nameParts.length === 1 &&
		typeof name === "string" &&
		name.toLowerCase() === "value";
	if (isValueName)
		warnDuringDevelopment(
			"`<select value=${…}>` selects nothing: <select> has no value attribute. Bind `selected` on the option instead: `<option selected=${…}>`.",
		);
};

const completeAttribute = (parser: ParserState) => {
	const isOnRootTemplate =
		parser.rootTemplate === ROOT_TEMPLATE.IS_THE_CURRENT_TAG;
	if (hasOpenConstruct(parser)) {
		const binding = takeAttributeBinding(parser);
		warnOnSelectValueBinding(parser, binding);
		parser.bindings.push(binding);
		if (isOnRootTemplate) parser.hostBindingCount++;
		else parser.resultMarkup += openMarkerComment(parser);
		return;
	}
	if (parser.parts[STATE.ATTRIBUTE_KEY].length === 0) return;
	if (isOnRootTemplate) {
		//a static host attribute emits no marker but still owns a binding index, and every marker
		//after it is numbered from this count
		parser.startedBindingCount++;
		parser.bindings.push(takeAttributeBinding(parser));
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
	parser.splitIndex = parser.characterIndex + 1;
	const endsWithSlash =
		parser.activeString.charCodeAt(parser.characterIndex - 1) ===
		CHARACTER_CODE.SLASH;
	if (endsWithSlash) {
		parser.openTagIsDynamic.pop();
		parser.isSelfClosing = true;
		flushElement(parser);
		parser.scanState = STATE.TEXT;
		return;
	}
	parser.scanState = parsesContentAsRaw(parser, parser.currentTagName)
		? STATE.RAW_CONTENT
		: STATE.TEXT;
};

const endAttribute = (parser: ParserState, parts: Array<Part>) => {
	appendSlice(parser, parts, parser.splitIndex, parser.characterIndex);
	completeAttribute(parser);
	parser.openConstructKind = NO_OPEN_CONSTRUCT;
	parser.attributeQuoteCode = 0;
	parser.scanState = STATE.ELEMENT;
};

const scanText = (parser: ParserState) => {
	const tagStart = parser.activeString.indexOf(
		MARKUP.TAG_OPEN,
		parser.characterIndex,
	);
	if (tagStart === -1) {
		parser.characterIndex = parser.activeString.length;
		return;
	}
	parser.characterIndex = tagStart;
	appendTextAndMarkTopLevelSibling(
		parser,
		parser.splitIndex,
		parser.characterIndex,
	);
	parser.splitIndex = parser.characterIndex + 1;

	const nextCode = parser.activeString.charCodeAt(parser.characterIndex + 1);

	if (nextCode === CHARACTER_CODE.BANG) {
		parser.scanState = STATE.COMMENT;
		parser.splitIndex = parser.characterIndex + COMMENT_OPEN_LENGTH;
		//resume on the "--" so an empty <!----> still matches its "-->"
		parser.characterIndex += COMMENT_OPEN_LENGTH - COMMENT_DASHES_LENGTH;
		return;
	}

	if (nextCode === CHARACTER_CODE.SLASH) {
		parser.scanState = STATE.END_TAG;
		parser.splitIndex = parser.characterIndex + END_TAG_OPEN_LENGTH;
		parser.characterIndex++;
		return;
	}

	flushElement(parser);
	parser.scanState = STATE.ELEMENT;
	parser.characterIndex--;
};

const scanComment = (parser: ParserState) => {
	//searching from the opener's dashes is what lets the abrupt "<!-->" close on them
	const commentClose = parser.activeString.indexOf(
		MARKUP.COMMENT_CLOSE,
		parser.characterIndex - COMMENT_DASHES_LENGTH,
	);
	if (commentClose === -1) {
		parser.characterIndex = parser.activeString.length;
		return;
	}

	//on the closing ">", which the loop's own step moves past
	parser.characterIndex = commentClose + COMMENT_CLOSE_LENGTH - 1;
	appendSlice(
		parser,
		parser.parts[STATE.COMMENT],
		parser.splitIndex,
		commentClose,
	);
	parser.splitIndex = parser.characterIndex + 1;
	completeComment(parser);
	parser.openConstructKind = NO_OPEN_CONSTRUCT;
	parser.scanState = STATE.TEXT;
};

const scanRawContent = (parser: ParserState) => {
	const closeTagStart = parser.activeString.indexOf(
		MARKUP.END_TAG_OPEN,
		parser.characterIndex,
	);
	if (closeTagStart === -1) {
		parser.characterIndex = parser.activeString.length;
		return;
	}

	parser.characterIndex = closeTagStart;
	const closesCurrentElement = parser.activeString.startsWith(
		parser.currentTagName,
		parser.characterIndex + END_TAG_OPEN_LENGTH,
	);
	if (!closesCurrentElement) return;
	appendSlice(
		parser,
		parser.parts[STATE.RAW_CONTENT],
		parser.splitIndex,
		parser.characterIndex,
	);
	parser.splitIndex =
		parser.characterIndex + END_TAG_OPEN_LENGTH + parser.currentTagName.length;
	parser.characterIndex += 1;
	completeRawContent(parser);
	parser.openConstructKind = NO_OPEN_CONSTRUCT;
	parser.scanState = STATE.END_TAG;
	parser.endTagMarkup += parser.currentTagName;
};

const scanTagName = (parser: ParserState, code: number) => {
	const endsTagName =
		code === CHARACTER_CODE.GREATER_THAN || isWhitespaceCode(code);
	if (!endsTagName) return;

	const isSelfClosing =
		code === CHARACTER_CODE.GREATER_THAN &&
		parser.activeString.charCodeAt(parser.characterIndex - 1) ===
			CHARACTER_CODE.SLASH;
	const tagEnd = isSelfClosing
		? parser.characterIndex - 1
		: parser.characterIndex;
	appendSlice(parser, parser.parts[STATE.TAG], parser.splitIndex, tagEnd);
	parser.splitIndex = parser.characterIndex;
	completeTag(parser);
	parser.openConstructKind = NO_OPEN_CONSTRUCT;

	if (code !== CHARACTER_CODE.GREATER_THAN) {
		parser.scanState = STATE.ELEMENT;
		parser.characterIndex--;
		return;
	}

	closeOpenTag(parser);
};

const scanBetweenAttributes = (parser: ParserState, code: number) => {
	if (code === CHARACTER_CODE.LESS_THAN) {
		parser.scanState = STATE.TAG;
		return;
	}

	if (code === CHARACTER_CODE.GREATER_THAN) {
		closeOpenTag(parser);
		return;
	}

	parser.scanState = STATE.ATTRIBUTE_KEY;
	if (!isWhitespaceCode(code)) {
		parser.splitIndex = parser.characterIndex;
		parser.characterIndex--;
		return;
	}

	//an indented tag separates its attributes with a whole run of whitespace,
	//and every character of it would otherwise open and close an empty attribute
	const templateLength = parser.activeString.length;
	let attributeStart = parser.characterIndex + 1;
	while (
		attributeStart < templateLength &&
		isWhitespaceCode(parser.activeString.charCodeAt(attributeStart))
	)
		attributeStart++;
	parser.splitIndex = attributeStart;
	parser.characterIndex = attributeStart - 1;
};

const scanAttributeKey = (parser: ParserState, code: number) => {
	if (code === CHARACTER_CODE.EQUALS) {
		appendSlice(
			parser,
			parser.parts[STATE.ATTRIBUTE_KEY],
			parser.splitIndex,
			parser.characterIndex,
		);
		parser.splitIndex = parser.characterIndex + 1;
		parser.scanState = STATE.ATTRIBUTE_VALUE;
		return;
	}
	if (isWhitespaceCode(code)) {
		endAttribute(parser, parser.parts[STATE.ATTRIBUTE_KEY]);
		parser.splitIndex = parser.characterIndex;
		parser.characterIndex--;
		return;
	}
	const startsSelfClosingEnd =
		code === CHARACTER_CODE.SLASH &&
		parser.activeString.charCodeAt(parser.characterIndex + 1) ===
			CHARACTER_CODE.GREATER_THAN;
	if (startsSelfClosingEnd) {
		endAttribute(parser, parser.parts[STATE.ATTRIBUTE_KEY]);
		return;
	}
	if (code !== CHARACTER_CODE.GREATER_THAN) return;
	endAttribute(parser, parser.parts[STATE.ATTRIBUTE_KEY]);
	parser.characterIndex--;
};

const scanAttributeValue = (parser: ParserState, code: number) => {
	const isInsideQuotes = parser.attributeQuoteCode !== 0;
	if (isInsideQuotes) {
		if (code !== parser.attributeQuoteCode) return;
		endAttribute(parser, parser.parts[STATE.ATTRIBUTE_VALUE]);
		parser.splitIndex = parser.characterIndex + 1;
		return;
	}
	if (isQuoteCode(code)) {
		parser.attributeQuoteCode = code;
		parser.splitIndex = parser.characterIndex + 1;
		//nothing between the quotes can end the value, so the scan is a search
		const closingQuote = parser.activeString.indexOf(
			String.fromCharCode(code),
			parser.splitIndex,
		);
		if (closingQuote === -1) {
			parser.characterIndex = parser.activeString.length;
			return;
		}
		parser.characterIndex = closingQuote;
		endAttribute(parser, parser.parts[STATE.ATTRIBUTE_VALUE]);
		parser.splitIndex = parser.characterIndex + 1;
		return;
	}
	if (isWhitespaceCode(code)) {
		endAttribute(parser, parser.parts[STATE.ATTRIBUTE_VALUE]);
		parser.splitIndex = parser.characterIndex;
		parser.characterIndex--;
		return;
	}
	if (code !== CHARACTER_CODE.GREATER_THAN) return;
	endAttribute(parser, parser.parts[STATE.ATTRIBUTE_VALUE]);
	parser.characterIndex--;
};

const scanEndTag = (parser: ParserState, code: number) => {
	if (code !== CHARACTER_CODE.GREATER_THAN) return;
	parser.endTagMarkup += sliceActiveString(
		parser,
		parser.splitIndex,
		parser.characterIndex,
	);
	parser.splitIndex = parser.characterIndex + 1;
	flushElement(parser);
	completeEndTag(parser);
	parser.openConstructKind = NO_OPEN_CONSTRUCT;
	parser.scanState = STATE.TEXT;
};

const startBindingAtHole = (parser: ParserState) => {
	if (parser.scanState === STATE.END_TAG) {
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
	if (parser.scanState === STATE.ELEMENT)
		throw new Error(
			libraryMessage(
				'a ${…} right after a quoted attribute value belongs to no attribute. Put a space before it: a="1" ${…}',
			),
		);
	parser.startedBindingCount++;
	parser.openConstructKind = OPEN_CONSTRUCT_FOR_STATE[parser.scanState];
};

const parse = (
	strings: TemplateStringsArray,
	mode: ParseModeKind = PARSE_MODE.OPTIMISTIC_ROOT,
): ParsedTemplate => {
	const parser = createParser(strings, mode);

	for (
		parser.stringIndex = 0;
		parser.stringIndex < parser.templateStrings.length;
		parser.stringIndex++
	) {
		parser.activeString = parser.templateStrings[parser.stringIndex];
		parser.splitIndex = 0;
		const templateLength = parser.activeString.length;

		for (
			parser.characterIndex = 0;
			parser.characterIndex < templateLength;
			parser.characterIndex++
		) {
			const code = parser.activeString.charCodeAt(parser.characterIndex);

			switch (parser.scanState) {
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
					return parser.scanState satisfies never;
			}
		}

		if (parser.stringIndex + 1 >= parser.templateStrings.length) break;
		if (!hasOpenConstruct(parser)) startBindingAtHole(parser);
		recordHole(parser);
	}
	const hasTrailingText =
		parser.scanState === STATE.TEXT &&
		parser.splitIndex < parser.activeString.length;
	if (hasTrailingText)
		appendTextAndMarkTopLevelSibling(
			parser,
			parser.splitIndex,
			parser.activeString.length,
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
		parser.bindings.push(createEmptyBinding(openConstructKind));
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
