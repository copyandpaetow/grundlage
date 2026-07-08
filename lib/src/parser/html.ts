import { stringHash } from "../utils/hashing";
import {
	ATTRIBUTE_NAME_KIND,
	ATTRIBUTE_SHAPE,
	BINDING,
	BINDING_TYPES,
	COMMENT_IDENTIFIER,
} from "./constants";
import {
	AttributeBinding,
	Binding,
	ContentBinding,
	ParsedHTML,
	ParsedTemplate,
	Part,
	RawContentBinding,
	StaticBinding,
	TagBinding,
	ValueOf
} from "./types";
import { CHAR_CODE, isQuoteCode, isWhitespaceCode } from "./chars";

type StateValue = ValueOf<typeof STATE>;
type BufferArray = Array<string | number>;

const moveArrayContents = (from: Array<unknown>, to: Array<unknown>) => {
	for (let arrIndex = 0; arrIndex < from.length; arrIndex++) {
		to.push(from[arrIndex]);
	}
	from.length = 0;
};

const PLACEHOLDER_TAG = "div";
const TEMPLATE_TAG = "template";
const SCRIPT_TAG = "script";
const TEXTAREA_TAG = "textarea";
const STYLE_TAG = "style";
const isSpecialElementTag = (parser: ParserState, tag: string) => {
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
type ParseMode = (typeof PARSE_MODE)[keyof typeof PARSE_MODE];

interface ParserState {
	state: StateValue;
	bindings: Array<Binding>;
	expressionToBinding: Array<number>;
	templates: TemplateStringsArray;
	index: number;
	activeTemplate: string;
	charIndex: number;
	splitIndex: number;
	hostBindingOffset: number;
	attributeQuoteCode: number;
	currentTagName: string;
	selfClosing: boolean;
	activeBinding: Binding | null;
	isRootTemplate: boolean;
	hasRootTemplate: boolean;
	rootTemplateClosed: boolean;
	sawTopLevelSibling: boolean;
	hasOpenedAnyTag: boolean;
	forceNoRootTemplate: boolean;
	keyBindingIndex: number;
	openTagBindings: Array<TagBinding | null>;
	resultBuffer: BufferArray;
	elementBuffer: BufferArray;
	tagBuffer: BufferArray;
	endTagBuffer: BufferArray;
	contentBuffer: BufferArray;
	commentBuffer: BufferArray;
	attributeKeyBuffer: BufferArray;
	attributeValueBuffer: BufferArray;
	rawContentBuffer: BufferArray;
}

const EMPTY_TEMPLATES = [] as unknown as TemplateStringsArray;

const createParser = (): ParserState => ({
	state: STATE.TEXT,
	bindings: [],
	expressionToBinding: [],
	templates: EMPTY_TEMPLATES,
	index: 0,
	activeTemplate: "",
	charIndex: 0,
	splitIndex: 0,
	hostBindingOffset: 0,
	attributeQuoteCode: 0,
	currentTagName: "",
	selfClosing: false,
	activeBinding: null,
	isRootTemplate: false,
	hasRootTemplate: false,
	rootTemplateClosed: false,
	sawTopLevelSibling: false,
	hasOpenedAnyTag: false,
	forceNoRootTemplate: false,
	keyBindingIndex: -1,
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
	parser.expressionToBinding = [];
	parser.templates = strings;
	parser.index = 0;
	parser.activeTemplate = strings[0];
	parser.charIndex = 0;
	parser.splitIndex = 0;
	parser.hostBindingOffset = 0;
	parser.attributeQuoteCode = 0;
	parser.currentTagName = "";
	parser.selfClosing = false;
	parser.activeBinding = null;
	parser.isRootTemplate = false;
	parser.hasRootTemplate = false;
	parser.rootTemplateClosed = false;
	parser.sawTopLevelSibling = false;
	parser.hasOpenedAnyTag = false;
	parser.forceNoRootTemplate = mode === PARSE_MODE.NO_ROOT_TEMPLATE;
	parser.keyBindingIndex = -1;
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
	`<!--${COMMENT_IDENTIFIER} ${(parser.activeBinding as Binding).type}-${parser.bindings.length - 1}-->`;

const closeComment = (parser: ParserState) =>
	`<!--${COMMENT_IDENTIFIER} /${(parser.activeBinding as Binding).type}-${parser.bindings.length - 1}-->`;

const isSingleContentHole = (values: Array<string | number>) =>
	values.length === 1 && typeof values[0] === "number";

const updateBinding = (parser: ParserState) => {
	switch (parser.state) {
		case STATE.TEXT: {
			capture(parser, parser.contentBuffer, parser.splitIndex);
			parser.contentBuffer.push(openComment(parser), closeComment(parser));
			(parser.activeBinding as ContentBinding).values.push(parser.index);
			parser.activeBinding = null;
			if (parser.openTagBindings.length === 0) {
				parser.sawTopLevelSibling = true;
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
				type: BINDING_TYPES.ATTR,
				shape: ATTRIBUTE_SHAPE.STATIC,
				values: [],
				keys: [],
				nameKind: ATTRIBUTE_NAME_KIND.UNKNOWN,
				eventName: "",
			} satisfies AttributeBinding;
		case STATE.COMMENT:
		case STATE.TEXT:
			return {
				type: BINDING_TYPES.CONTENT,
				values: [],
			} satisfies ContentBinding;
		case STATE.RAW_CONTENT:
			return {
				type: BINDING_TYPES.RAW_CONTENT,
				values: [],
			} satisfies RawContentBinding;
		case STATE.TAG:
			return {
				type: BINDING_TYPES.TAG,
				values: [],
			} satisfies TagBinding;

		default:
			throw new Error(
				`createBinding called in non-binding state: ${parser.state}`,
			);
	}
};

const capture = (
	parser: ParserState,
	buffer: BufferArray,
	start: number,
	end?: number,
) => {
	if (end !== undefined && end <= start) return;
	const slice = parser.activeTemplate.slice(start, end);
	if (slice) buffer.push(slice);
};

const completeComment = (parser: ParserState) => {
	if (parser.activeBinding) {
		const values = (parser.activeBinding as ContentBinding).values;
		moveArrayContents(parser.commentBuffer, values);
		if (isSingleContentHole(values))
			parser.contentBuffer.push(openComment(parser), closeComment(parser));
		else parser.contentBuffer.push(openComment(parser), "<!---->");
	} else {
		parser.contentBuffer.push("<!--");
		moveArrayContents(parser.commentBuffer, parser.contentBuffer);
		parser.contentBuffer.push("-->");
	}
	parser.activeBinding = null;
};

const completeSpecialContent = (parser: ParserState) => {
	if (parser.activeBinding) {
		parser.resultBuffer.push(openComment(parser));
		moveArrayContents(
			parser.rawContentBuffer,
			(parser.activeBinding as RawContentBinding).values,
		);
	} else {
		moveArrayContents(parser.rawContentBuffer, parser.contentBuffer);
	}
	parser.activeBinding = null;
};

const completeTag = (parser: ParserState) => {
	const isFirstTag = !parser.hasOpenedAnyTag;
	parser.hasOpenedAnyTag = true;

	if (!isFirstTag && parser.openTagBindings.length === 0) {
		parser.sawTopLevelSibling = true;
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
		!parser.sawTopLevelSibling &&
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
				"Asymmetric tag: dynamic </${...}> close cannot pair with a static open tag — make the open dynamic too.",
			);
		}
		parser.endTagBuffer.length = 0;
		parser.endTagBuffer.push(PLACEHOLDER_TAG);
	} else if (opener) {
		throw new Error(
			"Asymmetric tag: static end tag cannot pair with a dynamic <${...}> open tag — make the close dynamic too.",
		);
	}
	parser.resultBuffer.push("</");
	moveArrayContents(parser.endTagBuffer, parser.resultBuffer);
	parser.resultBuffer.push(">");
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

const classifyAttributeShape = (
	binding: AttributeBinding,
): ValueOf<typeof ATTRIBUTE_SHAPE> => {
	const keys = binding.keys;
	const values = binding.values;
	const dynamicName = keys.length > 1 || typeof keys[0] === "number";

	if (values.length === 0) {
		if (!dynamicName) return ATTRIBUTE_SHAPE.STATIC;
		return keys.length === 1
			? ATTRIBUTE_SHAPE.EXPANDABLE
			: ATTRIBUTE_SHAPE.DYNAMIC_NAME_BOOLEAN;
	}

	const singleDynamicValue =
		values.length === 1 && typeof values[0] === "number";

	if (dynamicName) {
		return singleDynamicValue
			? ATTRIBUTE_SHAPE.DYNAMIC_NAME_SINGLE_VALUE
			: ATTRIBUTE_SHAPE.DYNAMIC_NAME_MULTI_VALUE;
	}

	if (singleDynamicValue) return ATTRIBUTE_SHAPE.STATIC_NAME_SINGLE_VALUE;

	return values.length === 1
		? ATTRIBUTE_SHAPE.STATIC
		: ATTRIBUTE_SHAPE.STATIC_NAME_MULTI_VALUE;
};

const classifyAttributeName = (binding: AttributeBinding) => {
	const keys = binding.keys;
	if (keys.length !== 1 || typeof keys[0] !== "string") return;

	const name = keys[0];
	if (name.charCodeAt(0) !== 111 || name.charCodeAt(1) !== 110) {
		binding.nameKind = ATTRIBUTE_NAME_KIND.PLAIN;
		return;
	}
	if (name.charCodeAt(2) === 45) {
		binding.nameKind = ATTRIBUTE_NAME_KIND.EXPLICIT_EVENT;
		binding.eventName = name.slice(3).toLowerCase();
	} else {
		binding.nameKind = ATTRIBUTE_NAME_KIND.NATIVE_EVENT;
		binding.eventName = name.slice(2).toLowerCase();
	}
};
//todo: why abstracted?
const recordKeyBinding = (
	parser: ParserState,
	attributeBinding: AttributeBinding,
) => {
	if (parser.keyBindingIndex !== -1) return;
	if (parser.openTagBindings.length !== 1) return;
	if (attributeBinding.keys.length !== 1 || attributeBinding.keys[0] !== "key")
		return;
	parser.keyBindingIndex = parser.bindings.length - 1;
};

const completeAttribute = (parser: ParserState) => {
	if (parser.activeBinding) {
		const attributeBinding = parser.activeBinding as AttributeBinding;
		moveArrayContents(parser.attributeKeyBuffer, attributeBinding.keys);
		moveArrayContents(parser.attributeValueBuffer, attributeBinding.values);
		attributeBinding.shape = classifyAttributeShape(attributeBinding);
		classifyAttributeName(attributeBinding);

		if (attributeBinding.shape === ATTRIBUTE_SHAPE.EXPANDABLE) {
			attributeBinding.values.push(attributeBinding.keys[0]);
			attributeBinding.keys.length = 0;
		}

		if (parser.isRootTemplate) {
			parser.hostBindingOffset++;
		} else {
			parser.resultBuffer.push(openComment(parser));
			recordKeyBinding(parser, attributeBinding);
		}
	} else if (parser.attributeKeyBuffer.length) {
		if (parser.isRootTemplate) {
			const staticBinding: AttributeBinding = {
				type: BINDING_TYPES.ATTR,
				shape: ATTRIBUTE_SHAPE.STATIC,
				keys: [],
				values: [],
				nameKind: ATTRIBUTE_NAME_KIND.UNKNOWN,
				eventName: "",
			};
			moveArrayContents(parser.attributeKeyBuffer, staticBinding.keys);
			moveArrayContents(parser.attributeValueBuffer, staticBinding.values);
			staticBinding.shape = classifyAttributeShape(staticBinding);
			classifyAttributeName(staticBinding);
			parser.bindings.push(staticBinding);
			parser.hostBindingOffset++;
		} else {
			parser.elementBuffer.push(" ");
			moveArrayContents(parser.attributeKeyBuffer, parser.elementBuffer);
			if (parser.attributeValueBuffer.length) {
				parser.elementBuffer.push("=", "'");
				moveArrayContents(parser.attributeValueBuffer, parser.elementBuffer);
				parser.elementBuffer.push("'");
			}
		}
	}
	parser.activeBinding = null;
	parser.attributeQuoteCode = 0;
};

const resetElementScope = (parser: ParserState) => {
	parser.selfClosing = false;
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

	parser.resultBuffer.push("<");
	moveArrayContents(parser.elementBuffer, parser.resultBuffer);
	parser.resultBuffer.push(">");
	if (parser.selfClosing) {
		parser.resultBuffer.push("</", parser.currentTagName, ">");
	}
	moveArrayContents(parser.contentBuffer, parser.resultBuffer);

	resetElementScope(parser);
};

const parse = (
	parser: ParserState,
	strings: TemplateStringsArray,
	mode: ParseMode = PARSE_MODE.OPTIMISTIC_ROOT,
): ParsedHTML => {
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
					capture(
						parser,
						parser.contentBuffer,
						parser.splitIndex,
						parser.charIndex,
					);
					if (
						parser.openTagBindings.length === 0 &&
						rangeHasNonWhitespace(parser, parser.splitIndex, parser.charIndex)
					) {
						parser.sawTopLevelSibling = true;
					}
					parser.splitIndex = parser.charIndex + 1;

					const nextCode = parser.activeTemplate.charCodeAt(
						parser.charIndex + 1,
					);

					if (nextCode === CHAR_CODE.BANG) {
						parser.state = STATE.COMMENT;
						parser.splitIndex = parser.charIndex + 4;
						parser.charIndex += 2;
						continue;
					}

					if (nextCode === CHAR_CODE.SLASH) {
						parser.state = STATE.END_TAG;
						parser.splitIndex = parser.charIndex + 2;
						parser.charIndex++;
						continue;
					}

					flushElement(parser);
					parser.state = STATE.ELEMENT;
					parser.charIndex--;
					continue;
				}

				case STATE.COMMENT:
					if (
						code !== CHAR_CODE.GREATER_THAN ||
						parser.activeTemplate.charCodeAt(parser.charIndex - 1) !==
							CHAR_CODE.DASH ||
						parser.activeTemplate.charCodeAt(parser.charIndex - 2) !==
							CHAR_CODE.DASH
					) {
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

				case STATE.RAW_CONTENT:
					if (
						code !== CHAR_CODE.LESS_THAN ||
						parser.activeTemplate.charCodeAt(parser.charIndex + 1) !==
							CHAR_CODE.SLASH
					) {
						continue;
					}

					if (
						parser.activeTemplate.startsWith(
							parser.currentTagName,
							parser.charIndex + 2,
						)
					) {
						capture(
							parser,
							parser.rawContentBuffer,
							parser.splitIndex,
							parser.charIndex,
						);
						parser.splitIndex =
							parser.charIndex + 2 + parser.currentTagName.length;
						parser.charIndex += 1;
						completeSpecialContent(parser);
						parser.state = STATE.END_TAG;
						parser.endTagBuffer.push(parser.currentTagName);
					}
					continue;

				case STATE.TAG: {
					if (code !== CHAR_CODE.GREATER_THAN && !isWhitespaceCode(code)) {
						continue;
					}

					const tagEnd =
						code === CHAR_CODE.GREATER_THAN &&
						parser.activeTemplate.charCodeAt(parser.charIndex - 1) ===
							CHAR_CODE.SLASH
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

					if (
						parser.activeTemplate.charCodeAt(parser.charIndex - 1) ===
						CHAR_CODE.SLASH
					) {
						parser.openTagBindings.pop();
						parser.selfClosing = true;
						flushElement(parser);
						parser.state = STATE.TEXT;
						parser.splitIndex = parser.charIndex + 1;
						continue;
					}

					parser.state = isSpecialElementTag(parser, parser.currentTagName)
						? STATE.RAW_CONTENT
						: STATE.TEXT;

					parser.splitIndex = parser.charIndex + 1;
					continue;
				}

				case STATE.ELEMENT:
					if (code === CHAR_CODE.LESS_THAN) {
						parser.state = STATE.TAG;
						continue;
					}

					if (code === CHAR_CODE.GREATER_THAN) {
						if (
							parser.activeTemplate.charCodeAt(parser.charIndex - 1) ===
							CHAR_CODE.SLASH
						) {
							parser.openTagBindings.pop();
							parser.selfClosing = true;
							flushElement(parser);
							parser.state = STATE.TEXT;
						} else if (isSpecialElementTag(parser, parser.currentTagName)) {
							parser.state = STATE.RAW_CONTENT;
						} else {
							parser.state = STATE.TEXT;
						}
						parser.splitIndex = parser.charIndex + 1;
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
						capture(
							parser,
							parser.attributeKeyBuffer,
							parser.splitIndex,
							parser.charIndex,
						);
						parser.splitIndex = parser.charIndex;
						completeAttribute(parser);
						parser.state = STATE.ELEMENT;
						parser.charIndex--;
					} else if (
						code === CHAR_CODE.SLASH &&
						parser.activeTemplate.charCodeAt(parser.charIndex + 1) ===
							CHAR_CODE.GREATER_THAN
					) {
						capture(
							parser,
							parser.attributeKeyBuffer,
							parser.splitIndex,
							parser.charIndex,
						);
						completeAttribute(parser);
						parser.state = STATE.ELEMENT;
					} else if (code === CHAR_CODE.GREATER_THAN) {
						capture(
							parser,
							parser.attributeKeyBuffer,
							parser.splitIndex,
							parser.charIndex,
						);
						completeAttribute(parser);
						parser.state = STATE.ELEMENT;
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
						capture(
							parser,
							parser.attributeValueBuffer,
							parser.splitIndex,
							parser.charIndex,
						);
						parser.splitIndex = parser.charIndex + 1;
						completeAttribute(parser);
						parser.state = STATE.ELEMENT;
					} else if (!parser.attributeQuoteCode && isWhitespaceCode(code)) {
						capture(
							parser,
							parser.attributeValueBuffer,
							parser.splitIndex,
							parser.charIndex,
						);
						parser.splitIndex = parser.charIndex;
						completeAttribute(parser);
						parser.state = STATE.ELEMENT;
						parser.charIndex--;
					} else if (
						!parser.attributeQuoteCode &&
						code === CHAR_CODE.GREATER_THAN
					) {
						capture(
							parser,
							parser.attributeValueBuffer,
							parser.splitIndex,
							parser.charIndex,
						);
						completeAttribute(parser);
						parser.state = STATE.ELEMENT;
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
						"Asymmetric tag: dynamic </${...}> close has no matching dynamic open tag — pair `<${tag}>` with `</${tag}>`.",
					);
				}
				parser.activeBinding = opener;
			}
			parser.expressionToBinding.push(
				parser.bindings.indexOf(parser.activeBinding as TagBinding),
			);
		} else {
			if (!parser.activeBinding) {
				parser.activeBinding = createBinding(parser);
				parser.bindings.push(parser.activeBinding);
			}
			parser.expressionToBinding.push(parser.bindings.length - 1);
		}

		updateBinding(parser);
	}
	if (
		parser.state === STATE.TEXT &&
		parser.splitIndex < parser.activeTemplate.length
	) {
		const trailingStart = parser.splitIndex;
		capture(
			parser,
			parser.contentBuffer,
			trailingStart,
			parser.activeTemplate.length,
		);
		if (
			parser.openTagBindings.length === 0 &&
			rangeHasNonWhitespace(parser, trailingStart, parser.activeTemplate.length)
		) {
			parser.sawTopLevelSibling = true;
		}
	}
	flushElement(parser);

	if (parser.hasRootTemplate && parser.sawTopLevelSibling) {
		return parse(parser, strings, PARSE_MODE.NO_ROOT_TEMPLATE);
	}

	const result = parser.resultBuffer.join("");

	return {
		expressionToBinding: parser.expressionToBinding,
		bindings: parser.bindings,
		result,
		fragment: null,
		templateHash: stringHash(result),
		hostBindingOffset: parser.hostBindingOffset,
		keyBindingIndex: parser.keyBindingIndex,
	};
};

const isEventBinding = (binding: AttributeBinding): boolean =>
	(binding.nameKind === ATTRIBUTE_NAME_KIND.NATIVE_EVENT ||
		binding.nameKind === ATTRIBUTE_NAME_KIND.EXPLICIT_EVENT) &&
	binding.values.length === 1 &&
	typeof binding.values[0] === "number";

const toAttributeStaticBinding = (binding: AttributeBinding): StaticBinding => {
	if (isEventBinding(binding)) {
		return {
			type: BINDING.EVENT,
			eventType: binding.eventName,
			valueIndex: binding.values[0] as number,
		};
	}
	if (binding.shape === ATTRIBUTE_SHAPE.EXPANDABLE) {
		return {
			type: BINDING.DYNAMIC_ATTRIBUTE,
			valueIndex: binding.values[0] as number,
		};
	}
	if (binding.values.length === 1 && typeof binding.values[0] === "number") {
		return {
			type: BINDING.SINGLE_VALUE_ATTRIBUTE,
			nameParts: binding.keys.slice(),
			valueIndex: binding.values[0],
		};
	}
	//todo: why abstracted?
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
		case BINDING_TYPES.TAG:
			return {
				type: BINDING.TAG,
				parts: binding.values.slice(),
			};
		case BINDING_TYPES.ATTR:
			return toAttributeStaticBinding(binding);
		case BINDING_TYPES.CONTENT:
			return isSingleContentHole(binding.values)
				? { type: BINDING.CONTENT, valueIndex: binding.values[0] as number }
				: { type: BINDING.COMMENT, parts: binding.values.slice() };
		case BINDING_TYPES.RAW_CONTENT:
			return { type: BINDING.RAW_CONTENT, parts: binding.values.slice() };
	}
};

const toParsedTemplate = (parsed: ParsedHTML): ParsedTemplate => ({
	htmlWithMarkers: parsed.result,
	bindings: parsed.bindings.map(toStaticBinding),
	templateHash: parsed.templateHash,
	fragmentCloneSource: null,
	hostBindingCount: parsed.hostBindingOffset,
	keyBindingIndex: parsed.keyBindingIndex,
});

const parser = createParser();

const parseCache = new WeakMap<TemplateStringsArray, ParsedTemplate>();

export const getParsedTemplate = (
	templateStrings: TemplateStringsArray,
): ParsedTemplate => {
	const cached = parseCache.get(templateStrings);
	if (cached !== undefined) return cached;
	const parsed = toParsedTemplate(parse(parser, templateStrings));
	parseCache.set(templateStrings, parsed);
	return parsed;
};
