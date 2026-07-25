import { moveArrayContents } from "../utils/move-array-contents";
import { hashValue } from "../utils/hashing";
import { BINDING, PARSE_BINDING } from "./constants";
import {
	AttributeBinding,
	Binding,
	CommentBinding,
	ContentBinding,
	ParsedTemplate,
	Part,
	RawContentBinding,
	StaticBinding,
	TagBinding
} from "./types";
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
const parsesContentAsRaw = (parser: ParserState, tag: string) => {
	if (tag === TEMPLATE_TAG) {
		return parser.forceNoRootTemplate || !parser.isRootTemplate;
	}

	return tag === STYLE_TAG || tag === TEXTAREA_TAG || tag === SCRIPT_TAG;
};

const STATE = {
	TEXT: 0,
	COMMENT: 1,
	RAW_CONTENT: 2,
	ELEMENT: 3,
	TAG: 4,
	ATTRIBUTE_KEY: 5,
	ATTRIBUTE_VALUE: 6,
	END_TAG: 7,
} as const;

const PARSE_MODE = { OPTIMISTIC_ROOT: 0, NO_ROOT_TEMPLATE: 1 } as const;
type ParseMode = ValueOf<typeof PARSE_MODE>;

interface ParserState {
	state: StateValue;
	bindings: Array<Binding>;
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
	activeBinding: Binding | null;
	isRootTemplate: boolean;
	hasRootTemplate: boolean;
	rootTemplateClosed: boolean;
	hasSeenTopLevelSibling: boolean;
	hasOpenedAnyTag: boolean;
	forceNoRootTemplate: boolean;
	keyValueParts: Array<Part> | null;
	openTagBindings: Array<TagBinding | null>;
	resultBuffer: Array<Part>;
	elementBuffer: Array<Part>;
	tagBuffer: Array<Part>;
	endTagBuffer: Array<Part>;
	contentBuffer: Array<Part>;
	commentBuffer: Array<Part>;
	attributeKeyBuffer: Array<Part>;
	attributeValueBuffer: Array<Part>;
	rawContentBuffer: Array<Part>;
}

const EMPTY_TEMPLATES = [] as unknown as TemplateStringsArray;

const createParser = (): ParserState => ({
	state: STATE.TEXT,
	bindings: [],
	templates: EMPTY_TEMPLATES,
	templateHash: 0,
	index: 0,
	activeTemplate: "",
	charIndex: 0,
	splitIndex: 0,
	hostBindingCount: 0,
	attributeQuoteCode: 0,
	currentTagName: "",
	isSelfClosing: false,
	activeBinding: null,
	isRootTemplate: false,
	hasRootTemplate: false,
	rootTemplateClosed: false,
	hasSeenTopLevelSibling: false,
	hasOpenedAnyTag: false,
	forceNoRootTemplate: false,
	keyValueParts: null,
	openTagBindings: [],
	resultBuffer: [],
	elementBuffer: [],
	tagBuffer: [],
	endTagBuffer: [],
	contentBuffer: [],
	commentBuffer: [],
	attributeKeyBuffer: [],
	attributeValueBuffer: [],
	rawContentBuffer: [],
});

const resetParser = (
	parser: ParserState,
	strings: TemplateStringsArray,
	mode: ParseMode,
) => {
	parser.state = STATE.TEXT;
	parser.bindings = [];
	parser.templates = strings;
	parser.templateHash = hashValue(strings);
	parser.index = 0;
	parser.activeTemplate = strings[0];
	parser.charIndex = 0;
	parser.splitIndex = 0;
	parser.hostBindingCount = 0;
	parser.attributeQuoteCode = 0;
	parser.currentTagName = "";
	parser.isSelfClosing = false;
	parser.activeBinding = null;
	parser.isRootTemplate = false;
	parser.hasRootTemplate = false;
	parser.rootTemplateClosed = false;
	parser.hasSeenTopLevelSibling = false;
	parser.hasOpenedAnyTag = false;
	parser.forceNoRootTemplate = mode === PARSE_MODE.NO_ROOT_TEMPLATE;
	parser.keyValueParts = null;
	parser.openTagBindings.length = 0;
	parser.resultBuffer.length = 0;
	parser.elementBuffer.length = 0;
	parser.tagBuffer.length = 0;
	parser.endTagBuffer.length = 0;
	parser.contentBuffer.length = 0;
	parser.commentBuffer.length = 0;
	parser.attributeKeyBuffer.length = 0;
	parser.attributeValueBuffer.length = 0;
	parser.rawContentBuffer.length = 0;
};

const openComment = (parser: ParserState) =>
	`${MARKUP.COMMENT_OPEN}${MARKUP.COMMENT_IDENTIFIER} ${(parser.activeBinding as Binding).type}-${parser.bindings.length - 1}${MARKUP.COMMENT_CLOSE}`;

const closeComment = (parser: ParserState) =>
	`${MARKUP.COMMENT_OPEN}${MARKUP.COMMENT_IDENTIFIER} /${(parser.activeBinding as Binding).type}-${parser.bindings.length - 1}${MARKUP.COMMENT_CLOSE}`;

const isSingleHole = (parts: Array<string | number>) =>
	parts.length === 1 && typeof parts[0] === "number";

const updateBinding = (parser: ParserState) => {
	switch (parser.state) {
		case STATE.TEXT: {
			capture(parser, parser.contentBuffer, parser.splitIndex);
			parser.contentBuffer.push(openComment(parser), closeComment(parser));
			(parser.activeBinding as ContentBinding).values.push(parser.index);
			parser.activeBinding = null;
			if (parser.openTagBindings.length === 0) {
				parser.hasSeenTopLevelSibling = true;
			}
			break;
		}

		case STATE.TAG:
			capture(parser, parser.tagBuffer, parser.splitIndex);
			parser.tagBuffer.push(parser.index);
			break;

		case STATE.END_TAG:
			capture(parser, parser.endTagBuffer, parser.splitIndex);
			break;

		case STATE.ATTRIBUTE_KEY:
			capture(parser, parser.attributeKeyBuffer, parser.splitIndex);
			parser.attributeKeyBuffer.push(parser.index);
			break;

		case STATE.ATTRIBUTE_VALUE:
			capture(parser, parser.attributeValueBuffer, parser.splitIndex);
			parser.attributeValueBuffer.push(parser.index);
			break;

		case STATE.COMMENT:
			capture(parser, parser.commentBuffer, parser.splitIndex);
			parser.commentBuffer.push(parser.index);
			break;

		case STATE.RAW_CONTENT:
			capture(parser, parser.rawContentBuffer, parser.splitIndex);
			parser.rawContentBuffer.push(parser.index);
			break;
	}
};

const createBinding = (parser: ParserState) => {
	switch (parser.state) {
		case STATE.ATTRIBUTE_KEY:
		case STATE.ATTRIBUTE_VALUE:
			return {
				type: PARSE_BINDING.ATTRIBUTE,
				isExpandable: false,
				values: [],
				keys: [],
			} satisfies AttributeBinding;
		case STATE.COMMENT:
			return {
				type: PARSE_BINDING.COMMENT,
				values: [],
			} satisfies CommentBinding;
		case STATE.TEXT:
			return {
				type: PARSE_BINDING.CONTENT,
				values: [],
			} satisfies ContentBinding;
		case STATE.RAW_CONTENT:
			return {
				type: PARSE_BINDING.RAW_CONTENT,
				values: [],
				tag: parser.currentTagName,
				compiledStyleSheet: null,
			} satisfies RawContentBinding;
		case STATE.TAG:
			return {
				type: PARSE_BINDING.TAG,
				values: [],
			} satisfies TagBinding;

		default:
			throw new Error(
				`grundlage: createBinding called in non-binding state: ${parser.state}`,
			);
	}
};

const capture = (
	parser: ParserState,
	buffer: Array<Part>,
	start: number,
	end?: number,
) => {
	if (end !== undefined && end <= start) return;
	const slice = parser.activeTemplate.slice(start, end);
	if (slice) buffer.push(slice);
};

//the first dynamic comment is the list key: it never reaches the DOM, so its binding is
//dropped here and the marker walkers never have to account for a slot without a marker
const captureKeyBinding = (parser: ParserState) => {
	parser.keyValueParts = [];
	moveArrayContents(parser.commentBuffer, parser.keyValueParts);
	parser.bindings.pop();
};

const completeComment = (parser: ParserState) => {
	if (parser.activeBinding) {
		if (parser.keyValueParts === null) {
			captureKeyBinding(parser);
		} else {
			const values = (parser.activeBinding as CommentBinding).values;
			moveArrayContents(parser.commentBuffer, values);
			parser.contentBuffer.push(openComment(parser), MARKUP.EMPTY_COMMENT);
		}
	} else {
		parser.contentBuffer.push(MARKUP.COMMENT_OPEN);
		moveArrayContents(parser.commentBuffer, parser.contentBuffer);
		parser.contentBuffer.push(MARKUP.COMMENT_CLOSE);
	}
	parser.activeBinding = null;
};

const completeRawContent = (parser: ParserState) => {
	if (parser.activeBinding) {
		parser.resultBuffer.push(openComment(parser));
		const binding = parser.activeBinding as RawContentBinding;
		moveArrayContents(parser.rawContentBuffer, binding.values);
		//the sheet text is composed with literal values at first commit, while the clone is
		//still detached — the cached markup deliberately carries an empty <style>
		if (binding.tag === STYLE_TAG)
			binding.compiledStyleSheet = compileStyleSheet(binding.values);
	} else {
		moveArrayContents(parser.rawContentBuffer, parser.contentBuffer);
	}
	parser.activeBinding = null;
};

const completeTag = (parser: ParserState) => {
	const isFirstTag = !parser.hasOpenedAnyTag;
	parser.hasOpenedAnyTag = true;

	if (!isFirstTag && parser.openTagBindings.length === 0) {
		parser.hasSeenTopLevelSibling = true;
	}

	if (parser.activeBinding) {
		parser.currentTagName = PLACEHOLDER_TAG;
		moveArrayContents(
			parser.tagBuffer,
			(parser.activeBinding as TagBinding).values,
		);
		parser.elementBuffer.push(PLACEHOLDER_TAG);
		parser.resultBuffer.push(openComment(parser));
		parser.openTagBindings.push(parser.activeBinding as TagBinding);
		parser.isRootTemplate = false;
		parser.activeBinding = null;
		return;
	}

	parser.currentTagName = parser.tagBuffer[0] as string;

	const isRoot =
		isFirstTag &&
		!parser.forceNoRootTemplate &&
		!parser.hasSeenTopLevelSibling &&
		parser.currentTagName === TEMPLATE_TAG;
	parser.isRootTemplate = isRoot;

	if (isRoot) {
		parser.hasRootTemplate = true;
		parser.tagBuffer.length = 0;
	} else {
		moveArrayContents(parser.tagBuffer, parser.elementBuffer);
	}
	parser.openTagBindings.push(null);
	parser.activeBinding = null;
};

const completeEndTag = (parser: ParserState) => {
	const opener = parser.openTagBindings.pop();
	if (
		parser.hasRootTemplate &&
		!parser.rootTemplateClosed &&
		parser.openTagBindings.length === 0
	) {
		parser.rootTemplateClosed = true;
		parser.endTagBuffer.length = 0;
		parser.activeBinding = null;
		return;
	}
	if (parser.activeBinding) {
		if (!opener) {
			throw new Error(
				"grundlage: Asymmetric tag: dynamic </${...}> close cannot pair with a static open tag — make the open dynamic too.",
			);
		}
		parser.endTagBuffer.length = 0;
		parser.endTagBuffer.push(PLACEHOLDER_TAG);
	} else if (opener) {
		throw new Error(
			"grundlage: Asymmetric tag: static end tag cannot pair with a dynamic <${...}> open tag — make the close dynamic too.",
		);
	}
	parser.resultBuffer.push(MARKUP.END_TAG_OPEN);
	moveArrayContents(parser.endTagBuffer, parser.resultBuffer);
	parser.resultBuffer.push(MARKUP.TAG_CLOSE);
	parser.activeBinding = null;
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
	capture(parser, parser.contentBuffer, start, end);
	if (
		parser.openTagBindings.length === 0 &&
		rangeHasNonWhitespace(parser, start, end)
	) {
		parser.hasSeenTopLevelSibling = true;
	}
};

const isExpandableSpread = (binding: AttributeBinding): boolean =>
	binding.values.length === 0 &&
	binding.keys.length === 1 &&
	typeof binding.keys[0] === "number";

const finalizeAttributeBinding = (
	parser: ParserState,
	binding: AttributeBinding,
) => {
	moveArrayContents(parser.attributeKeyBuffer, binding.keys);
	moveArrayContents(parser.attributeValueBuffer, binding.values);
	binding.isExpandable = isExpandableSpread(binding);
	if (binding.isExpandable) {
		binding.values.push(binding.keys[0]);
		binding.keys.length = 0;
	}
};

const completeAttribute = (parser: ParserState) => {
	if (parser.activeBinding) {
		const attributeBinding = parser.activeBinding as AttributeBinding;
		finalizeAttributeBinding(parser, attributeBinding);

		if (parser.isRootTemplate) {
			parser.hostBindingCount++;
		} else {
			parser.resultBuffer.push(openComment(parser));
		}
	} else if (parser.attributeKeyBuffer.length) {
		if (parser.isRootTemplate) {
			const staticBinding = {
				type: PARSE_BINDING.ATTRIBUTE,
				isExpandable: false,
				values: [],
				keys: [],
			} satisfies AttributeBinding;
			finalizeAttributeBinding(parser, staticBinding);
			parser.bindings.push(staticBinding);
			parser.hostBindingCount++;
		} else {
			parser.elementBuffer.push(MARKUP.ATTRIBUTE_SEPARATOR);
			moveArrayContents(parser.attributeKeyBuffer, parser.elementBuffer);
			if (parser.attributeValueBuffer.length) {
				parser.elementBuffer.push(
					MARKUP.ATTRIBUTE_ASSIGN,
					MARKUP.ATTRIBUTE_QUOTE,
				);
				moveArrayContents(parser.attributeValueBuffer, parser.elementBuffer);
				parser.elementBuffer.push(MARKUP.ATTRIBUTE_QUOTE);
			}
		}
	}
	parser.activeBinding = null;
	parser.attributeQuoteCode = 0;
};

const resetElementScope = (parser: ParserState) => {
	parser.isSelfClosing = false;
	parser.currentTagName = "";
	parser.tagBuffer.length = 0;
};

const flushElement = (parser: ParserState) => {
	if (parser.elementBuffer.length === 0) {
		if (parser.contentBuffer.length > 0) {
			moveArrayContents(parser.contentBuffer, parser.resultBuffer);
		}
		resetElementScope(parser);
		return;
	}

	parser.resultBuffer.push(MARKUP.TAG_OPEN);
	moveArrayContents(parser.elementBuffer, parser.resultBuffer);
	parser.resultBuffer.push(MARKUP.TAG_CLOSE);
	if (parser.isSelfClosing) {
		parser.resultBuffer.push(
			MARKUP.END_TAG_OPEN,
			parser.currentTagName,
			MARKUP.TAG_CLOSE,
		);
	}
	moveArrayContents(parser.contentBuffer, parser.resultBuffer);

	resetElementScope(parser);
};

const closeOpenTag = (parser: ParserState) => {
	if (
		parser.activeTemplate.charCodeAt(parser.charIndex - 1) === CHAR_CODE.SLASH
	) {
		parser.openTagBindings.pop();
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

const endAttribute = (parser: ParserState, buffer: Array<Part>) => {
	capture(parser, buffer, parser.splitIndex, parser.charIndex);
	completeAttribute(parser);
	parser.state = STATE.ELEMENT;
};

//without knowing the type of the expression slot we can detect if it is an event listener or something that just starts with "on" => "once", "online" etc/
const isHandlerName = (binding: AttributeBinding): boolean =>
	typeof binding.keys[0] === "string" &&
	binding.keys[0].startsWith(MARKUP.EVENT_PREFIX) &&
	isSingleHole(binding.values);

const toAttributeStaticBinding = (binding: AttributeBinding): StaticBinding => {
	if (isHandlerName(binding)) {
		return {
			type: BINDING.NAMED_DYNAMIC,
			name: binding.keys[0] as string,
			valueIndex: binding.values[0] as number,
		};
	}
	if (binding.isExpandable) {
		return {
			type: BINDING.DYNAMIC_ATTRIBUTE,
			valueIndex: binding.values[0] as number,
		};
	}
	if (isSingleHole(binding.values)) {
		return {
			type: BINDING.SINGLE_VALUE_ATTRIBUTE,
			nameParts: binding.keys.slice(),
			valueIndex: binding.values[0] as number,
		};
	}
	const valueParts: Array<Part> =
		binding.values.length > 0 ? binding.values.slice() : [""];
	return {
		type: BINDING.ATTRIBUTE,
		nameParts: binding.keys.slice(),
		valueParts,
	};
};

const toStaticBinding = (binding: Binding): StaticBinding => {
	switch (binding.type) {
		case PARSE_BINDING.TAG:
			return {
				type: BINDING.TAG,
				parts: binding.values.slice(),
			};
		case PARSE_BINDING.ATTRIBUTE:
			return toAttributeStaticBinding(binding);
		case PARSE_BINDING.CONTENT:
			return { type: BINDING.CONTENT, valueIndex: binding.values[0] as number };
		case PARSE_BINDING.COMMENT:
			return { type: BINDING.COMMENT, parts: binding.values.slice() };
		case PARSE_BINDING.RAW_CONTENT:
			return {
				type: BINDING.RAW_CONTENT,
				parts: binding.values.slice(),
				compiledStyleSheet: binding.compiledStyleSheet,
			};
	}
};

const parse = (
	parser: ParserState,
	strings: TemplateStringsArray,
	mode: ParseMode = PARSE_MODE.OPTIMISTIC_ROOT,
): ParsedTemplate => {
	resetParser(parser, strings, mode);

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
					if (code !== CHAR_CODE.LESS_THAN) {
						continue;
					}
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
					const isCommentEnd =
						code === CHAR_CODE.GREATER_THAN &&
						parser.activeTemplate.charCodeAt(parser.charIndex - 1) ===
							CHAR_CODE.DASH &&
						parser.activeTemplate.charCodeAt(parser.charIndex - 2) ===
							CHAR_CODE.DASH;
					if (!isCommentEnd) {
						continue;
					}

					capture(
						parser,
						parser.commentBuffer,
						parser.splitIndex,
						parser.charIndex - 2,
					);
					parser.splitIndex = parser.charIndex + 1;
					completeComment(parser);
					parser.state = STATE.TEXT;

					continue;
				}

				case STATE.RAW_CONTENT: {
					const isCloseTagStart =
						code === CHAR_CODE.LESS_THAN &&
						parser.activeTemplate.charCodeAt(parser.charIndex + 1) ===
							CHAR_CODE.SLASH;
					if (!isCloseTagStart) {
						continue;
					}

					const closesCurrentElement = parser.activeTemplate.startsWith(
						parser.currentTagName,
						parser.charIndex + END_TAG_OPEN_LENGTH,
					);
					if (closesCurrentElement) {
						capture(
							parser,
							parser.rawContentBuffer,
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
						parser.endTagBuffer.push(parser.currentTagName);
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
					capture(parser, parser.tagBuffer, parser.splitIndex, tagEnd);
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

				case STATE.ELEMENT:
					if (code === CHAR_CODE.LESS_THAN) {
						parser.state = STATE.TAG;
						continue;
					}

					if (code === CHAR_CODE.GREATER_THAN) {
						closeOpenTag(parser);
						continue;
					}

					parser.state = STATE.ATTRIBUTE_KEY;
					if (isWhitespaceCode(code)) {
						parser.splitIndex = parser.charIndex + 1;
					} else {
						parser.splitIndex = parser.charIndex;
						parser.charIndex--;
					}

					continue;

				case STATE.ATTRIBUTE_KEY:
					if (code === CHAR_CODE.EQUALS) {
						capture(
							parser,
							parser.attributeKeyBuffer,
							parser.splitIndex,
							parser.charIndex,
						);
						parser.splitIndex = parser.charIndex + 1;
						parser.state = STATE.ATTRIBUTE_VALUE;
					} else if (isWhitespaceCode(code)) {
						endAttribute(parser, parser.attributeKeyBuffer);
						parser.splitIndex = parser.charIndex;
						parser.charIndex--;
					} else if (
						code === CHAR_CODE.SLASH &&
						parser.activeTemplate.charCodeAt(parser.charIndex + 1) ===
							CHAR_CODE.GREATER_THAN
					) {
						endAttribute(parser, parser.attributeKeyBuffer);
					} else if (code === CHAR_CODE.GREATER_THAN) {
						endAttribute(parser, parser.attributeKeyBuffer);
						parser.charIndex--;
					}
					continue;

				case STATE.ATTRIBUTE_VALUE:
					if (!parser.attributeQuoteCode && isQuoteCode(code)) {
						parser.attributeQuoteCode = code;
						parser.splitIndex = parser.charIndex + 1;
					} else if (
						parser.attributeQuoteCode &&
						code === parser.attributeQuoteCode
					) {
						endAttribute(parser, parser.attributeValueBuffer);
						parser.splitIndex = parser.charIndex + 1;
					} else if (!parser.attributeQuoteCode && isWhitespaceCode(code)) {
						endAttribute(parser, parser.attributeValueBuffer);
						parser.splitIndex = parser.charIndex;
						parser.charIndex--;
					} else if (
						!parser.attributeQuoteCode &&
						code === CHAR_CODE.GREATER_THAN
					) {
						endAttribute(parser, parser.attributeValueBuffer);
						parser.charIndex--;
					}
					continue;

				case STATE.END_TAG:
					if (code === CHAR_CODE.GREATER_THAN) {
						capture(
							parser,
							parser.endTagBuffer,
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
			if (!parser.activeBinding) {
				const opener =
					parser.openTagBindings[parser.openTagBindings.length - 1];
				if (!opener) {
					throw new Error(
						"grundlage: Asymmetric tag: dynamic </${...}> close has no matching dynamic open tag — pair `<${tag}>` with `</${tag}>`.",
					);
				}
				parser.activeBinding = opener;
			}
		} else if (!parser.activeBinding) {
			parser.activeBinding = createBinding(parser);
			parser.bindings.push(parser.activeBinding);
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

	if (parser.hasRootTemplate && parser.hasSeenTopLevelSibling) {
		return parse(parser, strings, PARSE_MODE.NO_ROOT_TEMPLATE);
	}

	return {
		htmlWithMarkers: parser.resultBuffer.join(""),
		bindings: parser.bindings.map(toStaticBinding),
		templateHash: parser.templateHash,
		fragmentCloneSource: null,
		hostBindingCount: parser.hostBindingCount,
		keyValueParts: parser.keyValueParts,
		hasStyleSheetBinding: parser.bindings.some(
			(binding) =>
				binding.type === PARSE_BINDING.RAW_CONTENT &&
				binding.compiledStyleSheet,
		),
	};
};

const parser = createParser();

const parseCache = new WeakMap<TemplateStringsArray, ParsedTemplate>();

export const getParsedTemplate = (
	templateStrings: TemplateStringsArray,
): ParsedTemplate => {
	const cached = parseCache.get(templateStrings);
	if (cached !== undefined) return cached;
	const parsed = parse(parser, templateStrings);
	parseCache.set(templateStrings, parsed);
	return parsed;
};
