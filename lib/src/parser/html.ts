import { hashValue } from "../utils/hashing";
import { BINDING, OPEN_CONSTRUCT } from "./constants";
import { ParsedTemplate, Part, StaticBinding } from "./types";
import { CHAR_CODE, isQuoteCode, isWhitespaceCode, MARKUP } from "./chars";
import { compileStyleSheet } from "./css";
import { ValueOf } from "../utils/types";

type StateValue = ValueOf<typeof STATE>;

const PLACEHOLDER_TAG = "div";
const TEMPLATE_TAG = "template";
const SCRIPT_TAG = "script";
const TEXTAREA_TAG = "textarea";
const STYLE_TAG = "style";
const COMMENT_OPEN_LENGTH = MARKUP.COMMENT_OPEN.length;
const END_TAG_OPEN_LENGTH = MARKUP.END_TAG_OPEN.length;
const NO_OPEN_CONSTRUCT = -1;
const parsesContentAsRaw = (parser: ParserState, tag: string) => {
	if (tag === TEMPLATE_TAG) {
		return parser.forceNoRootTemplate || !parser.isRootTemplate;
	}

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

const PARSE_MODE = { OPTIMISTIC_ROOT: 0, NO_ROOT_TEMPLATE: 1 } as const;
type ParseMode = ValueOf<typeof PARSE_MODE>;

interface ParserState {
	state: StateValue;
	bindings: Array<StaticBinding>;
	startedBindingCount: number;
	openConstructKind: number;
	templates: TemplateStringsArray;
	templateHash: number;
	index: number;
	activeTemplate: string;
	charIndex: number;
	splitIndex: number;
	hostBindingCount: number;
	attributeQuoteCode: number;
	currentTagName: string;
	isSelfClosing: boolean;
	isRootTemplate: boolean;
	hasRootTemplate: boolean;
	rootTemplateClosed: boolean;
	hasSeenTopLevelSibling: boolean;
	hasOpenedAnyTag: boolean;
	hasStyleSheetBinding: boolean;
	forceNoRootTemplate: boolean;
	keyValueParts: Array<Part> | null;
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
	templateHash: hashValue(strings),
	index: 0,
	activeTemplate: strings[0],
	charIndex: 0,
	splitIndex: 0,
	hostBindingCount: 0,
	attributeQuoteCode: 0,
	currentTagName: "",
	isSelfClosing: false,
	isRootTemplate: false,
	hasRootTemplate: false,
	rootTemplateClosed: false,
	hasSeenTopLevelSibling: false,
	hasOpenedAnyTag: false,
	hasStyleSheetBinding: false,
	forceNoRootTemplate: mode === PARSE_MODE.NO_ROOT_TEMPLATE,
	keyValueParts: null,
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
		if (parser.openTagIsDynamic.length === 0) {
			parser.hasSeenTopLevelSibling = true;
		}
		return;
	}

	if (parser.state === STATE.END_TAG) {
		parser.endTagMarkup += sliceActiveTemplate(parser, parser.splitIndex);
		return;
	}

	const parts = parser.parts[parser.state as HoleCapturingState];
	capture(parser, parts, parser.splitIndex);
	parts.push(parser.index);
};

const emptyBinding = (openConstructKind: number): StaticBinding => {
	switch (openConstructKind) {
		case OPEN_CONSTRUCT.COMMENT:
			return { type: BINDING.COMMENT, parts: [] };
		case OPEN_CONSTRUCT.RAW_CONTENT:
			return { type: BINDING.RAW_CONTENT, parts: [], compiledStyleSheet: null };
		case OPEN_CONSTRUCT.TAG:
			return { type: BINDING.TAG, parts: [] };
		case OPEN_CONSTRUCT.ATTRIBUTE:
			return { type: BINDING.ATTRIBUTE, nameParts: [], valueParts: [""] };
		default:
			throw new Error(
				`grundlage: emptyBinding called for a construct that cannot be left open: ${openConstructKind}`,
			);
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
	const markup = parts.length === 1 ? (parts[0] as string) : parts.join("");
	parts.length = 0;
	return markup;
};

//the first dynamic comment is the list key: it never reaches the DOM, so its binding is
//dropped here and the marker walkers never have to account for a slot without a marker
const captureKeyBinding = (parser: ParserState) => {
	parser.keyValueParts = takeParts(parser, STATE.COMMENT);
	parser.startedBindingCount--;
};

const completeComment = (parser: ParserState) => {
	if (hasOpenConstruct(parser)) {
		if (parser.keyValueParts === null) {
			captureKeyBinding(parser);
		} else {
			parser.contentMarkup += openComment(parser) + MARKUP.EMPTY_COMMENT;
			parser.bindings.push({
				type: BINDING.COMMENT,
				parts: takeParts(parser, STATE.COMMENT),
			});
		}
	} else {
		parser.contentMarkup += asComment(
			drainPartsAsMarkup(parser.parts[STATE.COMMENT]),
		);
	}
	parser.openConstructKind = NO_OPEN_CONSTRUCT;
};

const completeRawContent = (parser: ParserState) => {
	if (hasOpenConstruct(parser)) {
		parser.resultMarkup += openComment(parser);
		const parts = takeParts(parser, STATE.RAW_CONTENT);
		//the sheet text is composed with literal values at first commit, while the clone is
		//still detached — the cached markup deliberately carries an empty <style>
		const compiledStyleSheet =
			parser.currentTagName === STYLE_TAG ? compileStyleSheet(parts) : null;
		if (compiledStyleSheet) parser.hasStyleSheetBinding = true;
		parser.bindings.push({
			type: BINDING.RAW_CONTENT,
			parts,
			compiledStyleSheet,
		});
	} else {
		parser.contentMarkup += drainPartsAsMarkup(parser.parts[STATE.RAW_CONTENT]);
	}
	parser.openConstructKind = NO_OPEN_CONSTRUCT;
};

const completeTag = (parser: ParserState) => {
	const isFirstTag = !parser.hasOpenedAnyTag;
	parser.hasOpenedAnyTag = true;

	if (!isFirstTag && parser.openTagIsDynamic.length === 0) {
		parser.hasSeenTopLevelSibling = true;
	}

	if (hasOpenConstruct(parser)) {
		parser.currentTagName = PLACEHOLDER_TAG;
		parser.elementMarkup += PLACEHOLDER_TAG;
		parser.resultMarkup += openComment(parser);
		parser.bindings.push({
			type: BINDING.TAG,
			parts: takeParts(parser, STATE.TAG),
		});
		parser.openTagIsDynamic.push(true);
		parser.isRootTemplate = false;
		parser.openConstructKind = NO_OPEN_CONSTRUCT;
		return;
	}

	const tagNameParts = parser.parts[STATE.TAG];
	parser.currentTagName = tagNameParts[0] as string;

	const isRoot =
		isFirstTag &&
		!parser.forceNoRootTemplate &&
		!parser.hasSeenTopLevelSibling &&
		parser.currentTagName === TEMPLATE_TAG;
	parser.isRootTemplate = isRoot;

	if (isRoot) {
		parser.hasRootTemplate = true;
		tagNameParts.length = 0;
	} else {
		parser.elementMarkup += drainPartsAsMarkup(tagNameParts);
	}
	parser.openTagIsDynamic.push(false);
	parser.openConstructKind = NO_OPEN_CONSTRUCT;
};

const completeEndTag = (parser: ParserState) => {
	const openerIsDynamic = parser.openTagIsDynamic.pop();
	if (
		parser.hasRootTemplate &&
		!parser.rootTemplateClosed &&
		parser.openTagIsDynamic.length === 0
	) {
		parser.rootTemplateClosed = true;
		parser.endTagMarkup = "";
		parser.openConstructKind = NO_OPEN_CONSTRUCT;
		return;
	}
	if (hasOpenConstruct(parser)) {
		if (!openerIsDynamic) {
			throw new Error(
				"grundlage: Asymmetric tag: dynamic </${...}> close cannot pair with a static open tag — make the open dynamic too.",
			);
		}
		parser.endTagMarkup = PLACEHOLDER_TAG;
	} else if (openerIsDynamic) {
		throw new Error(
			"grundlage: Asymmetric tag: static end tag cannot pair with a dynamic <${...}> open tag — make the close dynamic too.",
		);
	}
	parser.resultMarkup +=
		MARKUP.END_TAG_OPEN + parser.endTagMarkup + MARKUP.TAG_CLOSE;
	parser.endTagMarkup = "";
	parser.openConstructKind = NO_OPEN_CONSTRUCT;
};

const rangeHasNonWhitespace = (
	parser: ParserState,
	start: number,
	end: number,
) => {
	for (let scanIndex = start; scanIndex < end; scanIndex++) {
		if (!isWhitespaceCode(parser.activeTemplate.charCodeAt(scanIndex))) {
			return true;
		}
	}
	return false;
};

const markTopLevelTextSibling = (
	parser: ParserState,
	start: number,
	end: number,
) => {
	parser.contentMarkup += sliceActiveTemplate(parser, start, end);
	if (
		parser.openTagIsDynamic.length === 0 &&
		rangeHasNonWhitespace(parser, start, end)
	) {
		parser.hasSeenTopLevelSibling = true;
	}
};

const drainAttributeBinding = (parser: ParserState): StaticBinding => {
	const nameParts = takeParts(parser, STATE.ATTRIBUTE_KEY);
	const valueParts = takeParts(parser, STATE.ATTRIBUTE_VALUE);
	const isExpandableSpread =
		valueParts.length === 0 &&
		nameParts.length === 1 &&
		typeof nameParts[0] === "number";

	if (isExpandableSpread) {
		return {
			type: BINDING.DYNAMIC_ATTRIBUTE,
			valueIndex: nameParts[0] as number,
		};
	}
	if (valueParts.length === 1 && typeof valueParts[0] === "number") {
		return {
			type: BINDING.SINGLE_VALUE_ATTRIBUTE,
			nameParts,
			valueIndex: valueParts[0],
		};
	}
	return {
		type: BINDING.ATTRIBUTE,
		nameParts,
		valueParts: valueParts.length > 0 ? valueParts : [""],
	};
};

const completeAttribute = (parser: ParserState) => {
	if (hasOpenConstruct(parser)) {
		parser.bindings.push(drainAttributeBinding(parser));

		if (parser.isRootTemplate) {
			parser.hostBindingCount++;
		} else {
			parser.resultMarkup += openComment(parser);
		}
	} else if (parser.parts[STATE.ATTRIBUTE_KEY].length) {
		if (parser.isRootTemplate) {
			//a static host attribute emits no marker but still owns a slot, and every marker
			//after it is numbered from this count
			parser.startedBindingCount++;
			parser.bindings.push(drainAttributeBinding(parser));
			parser.hostBindingCount++;
		} else {
			parser.elementMarkup +=
				MARKUP.ATTRIBUTE_SEPARATOR +
				drainPartsAsMarkup(parser.parts[STATE.ATTRIBUTE_KEY]);
			if (parser.parts[STATE.ATTRIBUTE_VALUE].length) {
				parser.elementMarkup +=
					MARKUP.ATTRIBUTE_ASSIGN +
					MARKUP.ATTRIBUTE_QUOTE +
					drainPartsAsMarkup(parser.parts[STATE.ATTRIBUTE_VALUE]) +
					MARKUP.ATTRIBUTE_QUOTE;
			}
		}
	}
	parser.openConstructKind = NO_OPEN_CONSTRUCT;
	parser.attributeQuoteCode = 0;
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
	if (parser.isSelfClosing) {
		parser.resultMarkup +=
			MARKUP.END_TAG_OPEN + parser.currentTagName + MARKUP.TAG_CLOSE;
	}
	parser.resultMarkup += parser.contentMarkup;
	parser.contentMarkup = "";

	resetElementScope(parser);
};

const closeOpenTag = (parser: ParserState) => {
	if (
		parser.activeTemplate.charCodeAt(parser.charIndex - 1) === CHAR_CODE.SLASH
	) {
		parser.openTagIsDynamic.pop();
		parser.isSelfClosing = true;
		flushElement(parser);
		parser.state = STATE.TEXT;
	} else if (parsesContentAsRaw(parser, parser.currentTagName)) {
		parser.state = STATE.RAW_CONTENT;
	} else {
		parser.state = STATE.TEXT;
	}
	parser.splitIndex = parser.charIndex + 1;
};

const endAttribute = (parser: ParserState, parts: Array<Part>) => {
	capture(parser, parts, parser.splitIndex, parser.charIndex);
	completeAttribute(parser);
	parser.state = STATE.ELEMENT;
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
				case STATE.TEXT: {
					const tagStart = parser.activeTemplate.indexOf(
						MARKUP.TAG_OPEN,
						parser.charIndex,
					);
					if (tagStart === -1) {
						parser.charIndex = templateLength;
						continue;
					}
					parser.charIndex = tagStart;
					markTopLevelTextSibling(parser, parser.splitIndex, parser.charIndex);
					parser.splitIndex = parser.charIndex + 1;

					const nextCode = parser.activeTemplate.charCodeAt(
						parser.charIndex + 1,
					);

					if (nextCode === CHAR_CODE.BANG) {
						parser.state = STATE.COMMENT;
						parser.splitIndex = parser.charIndex + COMMENT_OPEN_LENGTH;
						// resume on the "--" so an empty <!----> still matches its "-->"
						parser.charIndex += 2;
						continue;
					}

					if (nextCode === CHAR_CODE.SLASH) {
						parser.state = STATE.END_TAG;
						parser.splitIndex = parser.charIndex + END_TAG_OPEN_LENGTH;
						parser.charIndex++;
						continue;
					}

					flushElement(parser);
					parser.state = STATE.ELEMENT;
					parser.charIndex--;
					continue;
				}

				case STATE.COMMENT: {
					// searching two back from the resume point is what lets the abrupt
					// "<!-->" close on the dashes of its own opener
					const commentClose = parser.activeTemplate.indexOf(
						MARKUP.COMMENT_CLOSE,
						parser.charIndex - 2,
					);
					if (commentClose === -1) {
						parser.charIndex = templateLength;
						continue;
					}

					parser.charIndex = commentClose + 2;
					capture(
						parser,
						parser.parts[STATE.COMMENT],
						parser.splitIndex,
						commentClose,
					);
					parser.splitIndex = parser.charIndex + 1;
					completeComment(parser);
					parser.state = STATE.TEXT;

					continue;
				}

				case STATE.RAW_CONTENT: {
					const closeTagStart = parser.activeTemplate.indexOf(
						MARKUP.END_TAG_OPEN,
						parser.charIndex,
					);
					if (closeTagStart === -1) {
						parser.charIndex = templateLength;
						continue;
					}

					parser.charIndex = closeTagStart;
					const closesCurrentElement = parser.activeTemplate.startsWith(
						parser.currentTagName,
						parser.charIndex + END_TAG_OPEN_LENGTH,
					);
					if (closesCurrentElement) {
						capture(
							parser,
							parser.parts[STATE.RAW_CONTENT],
							parser.splitIndex,
							parser.charIndex,
						);
						parser.splitIndex =
							parser.charIndex +
							END_TAG_OPEN_LENGTH +
							parser.currentTagName.length;
						parser.charIndex += 1;
						completeRawContent(parser);
						parser.state = STATE.END_TAG;
						parser.endTagMarkup += parser.currentTagName;
					}
					continue;
				}

				case STATE.TAG: {
					if (code !== CHAR_CODE.GREATER_THAN && !isWhitespaceCode(code)) {
						continue;
					}

					const isSelfClosing =
						code === CHAR_CODE.GREATER_THAN &&
						parser.activeTemplate.charCodeAt(parser.charIndex - 1) ===
							CHAR_CODE.SLASH;
					const tagEnd = isSelfClosing
						? parser.charIndex - 1
						: parser.charIndex;
					capture(parser, parser.parts[STATE.TAG], parser.splitIndex, tagEnd);
					parser.splitIndex = parser.charIndex;
					completeTag(parser);

					if (code !== CHAR_CODE.GREATER_THAN) {
						parser.state = STATE.ELEMENT;
						parser.charIndex--;
						continue;
					}

					closeOpenTag(parser);
					continue;
				}

				case STATE.ELEMENT: {
					if (code === CHAR_CODE.LESS_THAN) {
						parser.state = STATE.TAG;
						continue;
					}

					if (code === CHAR_CODE.GREATER_THAN) {
						closeOpenTag(parser);
						continue;
					}

					parser.state = STATE.ATTRIBUTE_KEY;
					if (!isWhitespaceCode(code)) {
						parser.splitIndex = parser.charIndex;
						parser.charIndex--;
						continue;
					}

					//an indented tag separates its attributes with a whole run of whitespace,
					//and every character of it would otherwise open and close an empty attribute
					let attributeStart = parser.charIndex + 1;
					while (
						attributeStart < templateLength &&
						isWhitespaceCode(parser.activeTemplate.charCodeAt(attributeStart))
					) {
						attributeStart++;
					}
					parser.splitIndex = attributeStart;
					parser.charIndex = attributeStart - 1;

					continue;
				}

				case STATE.ATTRIBUTE_KEY:
					if (code === CHAR_CODE.EQUALS) {
						capture(
							parser,
							parser.parts[STATE.ATTRIBUTE_KEY],
							parser.splitIndex,
							parser.charIndex,
						);
						parser.splitIndex = parser.charIndex + 1;
						parser.state = STATE.ATTRIBUTE_VALUE;
					} else if (isWhitespaceCode(code)) {
						endAttribute(parser, parser.parts[STATE.ATTRIBUTE_KEY]);
						parser.splitIndex = parser.charIndex;
						parser.charIndex--;
					} else if (
						code === CHAR_CODE.SLASH &&
						parser.activeTemplate.charCodeAt(parser.charIndex + 1) ===
							CHAR_CODE.GREATER_THAN
					) {
						endAttribute(parser, parser.parts[STATE.ATTRIBUTE_KEY]);
					} else if (code === CHAR_CODE.GREATER_THAN) {
						endAttribute(parser, parser.parts[STATE.ATTRIBUTE_KEY]);
						parser.charIndex--;
					}
					continue;

				case STATE.ATTRIBUTE_VALUE:
					if (!parser.attributeQuoteCode && isQuoteCode(code)) {
						parser.attributeQuoteCode = code;
						parser.splitIndex = parser.charIndex + 1;
						//nothing between the quotes can end the value, so the scan is a search
						const closingQuote = parser.activeTemplate.indexOf(
							String.fromCharCode(code),
							parser.splitIndex,
						);
						if (closingQuote === -1) {
							parser.charIndex = templateLength;
							continue;
						}
						parser.charIndex = closingQuote;
						endAttribute(parser, parser.parts[STATE.ATTRIBUTE_VALUE]);
						parser.splitIndex = parser.charIndex + 1;
					} else if (
						parser.attributeQuoteCode &&
						code === parser.attributeQuoteCode
					) {
						endAttribute(parser, parser.parts[STATE.ATTRIBUTE_VALUE]);
						parser.splitIndex = parser.charIndex + 1;
					} else if (!parser.attributeQuoteCode && isWhitespaceCode(code)) {
						endAttribute(parser, parser.parts[STATE.ATTRIBUTE_VALUE]);
						parser.splitIndex = parser.charIndex;
						parser.charIndex--;
					} else if (
						!parser.attributeQuoteCode &&
						code === CHAR_CODE.GREATER_THAN
					) {
						endAttribute(parser, parser.parts[STATE.ATTRIBUTE_VALUE]);
						parser.charIndex--;
					}
					continue;

				case STATE.END_TAG:
					if (code === CHAR_CODE.GREATER_THAN) {
						parser.endTagMarkup += sliceActiveTemplate(
							parser,
							parser.splitIndex,
							parser.charIndex,
						);
						parser.splitIndex = parser.charIndex + 1;
						flushElement(parser);
						completeEndTag(parser);
						parser.state = STATE.TEXT;
					}
					continue;
			}
		}

		if (parser.index + 1 >= parser.templates.length) {
			break;
		}

		if (parser.state === STATE.END_TAG) {
			if (!hasOpenConstruct(parser)) {
				const openerIsDynamic =
					parser.openTagIsDynamic[parser.openTagIsDynamic.length - 1];
				if (!openerIsDynamic) {
					throw new Error(
						"grundlage: Asymmetric tag: dynamic </${...}> close has no matching dynamic open tag — pair `<${tag}>` with `</${tag}>`.",
					);
				}
				parser.openConstructKind = OPEN_CONSTRUCT.TAG;
			}
		} else if (!hasOpenConstruct(parser)) {
			//a tag that opens on whitespace parks the scanner between the tag name and the
			//first attribute, where a hole belongs to neither and has nothing to accumulate into
			if (parser.state === STATE.ELEMENT) {
				throw new Error(
					"grundlage: a hole cannot sit between a tag name and its attributes",
				);
			}
			parser.startedBindingCount++;
			parser.openConstructKind =
				OPEN_CONSTRUCT_FOR_STATE[parser.state as BindingStartingState];
		}

		updateBinding(parser);
	}
	if (
		parser.state === STATE.TEXT &&
		parser.splitIndex < parser.activeTemplate.length
	) {
		markTopLevelTextSibling(
			parser,
			parser.splitIndex,
			parser.activeTemplate.length,
		);
	}
	flushElement(parser);

	//a started binding that never reached its completion is still owed a slot
	if (parser.bindings.length < parser.startedBindingCount) {
		parser.bindings.push(emptyBinding(parser.openConstructKind));
	}

	if (parser.hasRootTemplate && parser.hasSeenTopLevelSibling) {
		return parse(strings, PARSE_MODE.NO_ROOT_TEMPLATE);
	}

	return {
		htmlWithMarkers: parser.resultMarkup,
		bindings: parser.bindings,
		templateHash: parser.templateHash,
		fragmentCloneSource: null,
		hostBindingCount: parser.hostBindingCount,
		keyValueParts: parser.keyValueParts,
		hasStyleSheetBinding: parser.hasStyleSheetBinding,
	};
};

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
