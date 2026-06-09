import { stringHash } from "../utils/hashing";
import { HTMLTemplate } from "../rendering/template-html";
import {
	AttributeBinding,
	ATTRIBUTE_NAME_KIND,
	ATTRIBUTE_SHAPE,
	Binding,
	BINDING_TYPES,
	ContentBinding,
	ParsedHTML,
	RawContentBinding,
	TagBinding,
	ValueOf,
} from "./types";
import {
	CHAR_CODE,
	COMMENT_IDENTIFIER,
	isQuoteCode,
	isWhitespaceCode,
	moveArrayContents,
} from "./html-util";

/*
the idea here is to analyze and parse a tagged template string to give us
- a document fragment
- a hash
- an array of expressions bindings
- a mapping array of which expression maps to which binding

several expressions can be part of one binding like
<div class="${dynamic1} static ${dynamic1}">
=> one attribute binding

They also don't have to be next to each other
<h${headingLevel}>Hello, ${name}<h${headingLevel}>
=> one tag binding
=> one content binding

We walk each character and listen for different character combinations to change the state machine.
Depending on the state we move the last characters since the state change to the dedicated buffer array.
=> this way we can change and insert parts dynamically while also keeping memory usage low / performance up
*/

type StateValue = ValueOf<typeof STATE>;
type BufferArray = Array<string | number>;

const PLACEHOLDER_TAG = "div";
const TEMPLATE_TAG = "template";
const SCRIPT_TAG = "script";
const TEXTAREA_TAG = "textarea";
const STYLE_TAG = "style";
/*
the parser drops a comment marker at every dynamic position so we can find it again later — but these elements either don't render html children (style, script, textarea) or are inert (template), so a comment inside them wouldn't survive as a usable marker
=> for these we treat the whole element body as a single replaceable chunk and emit one marker before it instead of marking inner positions
*/
const isSpecialElementTag = (parser: ParserState, tag: string) => {
	if (tag === TEMPLATE_TAG) {
		//if there is a template element as single root, we allow it, and it gets the normal element treatment
		//UNLESS in certain cases. Our parser cant see ahead, so html`<template></template><div></div>` would initially look like a root template — the post-parse check then sets forceNoRootTemplate and reparses
		return parser.forceNoRootTemplate || !parser.isRootTemplate;
	}

	return tag === STYLE_TAG || tag === TEXTAREA_TAG || tag === SCRIPT_TAG;
};

//we keep the values dense 0..N so the main switch can compile to a jump table
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
	//true only between the root template's open tag and its first child tag — that window is when host attributes lower into bindings. recomputed every completeTag, so a nested <template> (not the first tag) is never a host.
	isRootTemplate: boolean;
	//persistent: an optimistic root <template> was detected and its wrapper is being suppressed. unlike isRootTemplate this stays set across the whole element so completeEndTag can suppress the matching </template> and the tail can decide on a reparse.
	hasRootTemplate: boolean;
	//the suppressed root template's end tag has been consumed — anything real after it is a trailing sibling that disqualifies the root
	rootTemplateClosed: boolean;
	//a non-comment, non-whitespace top-level node other than the root <template> was seen (before or after it). combined with hasRootTemplate at the tail it triggers the reparse.
	sawTopLevelSibling: boolean;
	hasOpenedAnyTag: boolean;
	//set per-parse from the parse() parameter; reset in resetParser() so a thrown parse can't leak state to the next call
	forceNoRootTemplate: boolean;
	//tracks every open tag in source order, dynamic or static. A dynamic open pushes its TagBinding;
	//a static open pushes null. Close tags pop and verify the kind matches — `<${tag}>...</div>` and
	//`<div>...</${tag}>` both throw rather than silently picking the wrong opener via at(-1).
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
	force: boolean,
) => {
	parser.state = STATE.TEXT;
	//bindings and expressionToBinding escape into the returned ParsedHTML (and the WeakMap cache), so they must be fresh each parse rather than reused
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
	parser.forceNoRootTemplate = force;
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

const createComment = (parser: ParserState) =>
	`<!--${COMMENT_IDENTIFIER} ${(parser.activeBinding as Binding).type}-${parser.bindings.length - 1}-->`;

const updateBinding = (parser: ParserState) => {
	switch (parser.state) {
		case STATE.TEXT: {
			capture(parser, parser.contentBuffer, parser.splitIndex);
			const marker = createComment(parser);
			parser.contentBuffer.push(marker, marker);
			(parser.activeBinding as ContentBinding).values.push(parser.index);
			parser.activeBinding = null;
			//a dynamic ${...} at the top level is a real sibling node of the root template
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
			(parser.activeBinding as TagBinding).endValues.push(parser.index);
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
			//shape and nameKind are finalized in completeAttribute once keys/values are populated; we initialize them up front so the object's hidden class is stable from the start
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
				endValues: [],
				relatedAttributes: [],
				bindingIndex: parser.bindings.length, //we set this before the push so it matches the eventual index
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
		moveArrayContents(
			parser.commentBuffer,
			(parser.activeBinding as ContentBinding).values,
		);
		const marker = createComment(parser);
		parser.contentBuffer.push(marker, marker);
	} else {
		//for static comments we re-wrap with delimiters since they were stripped during capture
		parser.contentBuffer.push("<!--");
		moveArrayContents(parser.commentBuffer, parser.contentBuffer);
		parser.contentBuffer.push("-->");
	}
	parser.activeBinding = null;
};

const completeSpecialContent = (parser: ParserState) => {
	if (parser.activeBinding) {
		parser.resultBuffer.push(createComment(parser));
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

	//a second top-level element (openTagBindings empty, but a prior tag already opened) is a sibling of the optimistic root — disqualifying
	if (!isFirstTag && parser.openTagBindings.length === 0) {
		parser.sawTopLevelSibling = true;
	}

	if (parser.activeBinding) {
		//a dynamic open uses PLACEHOLDER_TAG ("div"), so a dynamic outer tag is never a root template
		parser.currentTagName = PLACEHOLDER_TAG;
		moveArrayContents(
			parser.tagBuffer,
			(parser.activeBinding as TagBinding).values,
		);
		parser.elementBuffer.push(PLACEHOLDER_TAG);
		parser.resultBuffer.push(createComment(parser));
		parser.openTagBindings.push(parser.activeBinding as TagBinding);
		parser.isRootTemplate = false;
		parser.activeBinding = null;
		return;
	}

	parser.currentTagName = parser.tagBuffer[0] as string;

	//optimistic root template: the first tag, a literal <template>, not forced, with no preceding top-level sibling.
	//we suppress the wrapper (open here, close in completeEndTag) so the result string is already unwrapped; a later disqualifier triggers the tail reparse.
	const isRoot =
		isFirstTag &&
		!parser.forceNoRootTemplate &&
		!parser.sawTopLevelSibling &&
		parser.currentTagName === TEMPLATE_TAG;
	parser.isRootTemplate = isRoot;

	if (isRoot) {
		parser.hasRootTemplate = true;
		parser.tagBuffer.length = 0; //drop the suppressed <template> name instead of emitting it
	} else {
		moveArrayContents(parser.tagBuffer, parser.elementBuffer);
	}
	parser.openTagBindings.push(null);
	parser.activeBinding = null;
};

const completeEndTag = (parser: ParserState) => {
	const opener = parser.openTagBindings.pop();
	//the optimistic root template's close: it is the outermost element, so it is the only close that returns the stack to empty. suppress its </template> the same way completeTag suppressed the open.
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

//scans a source range for any non-whitespace char; top-level whitespace-only text is tolerated around a root template, real text is not
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

//classifies an attribute binding into one of the ATTRIBUTE_SHAPE constants so updateAttribute / removeAttributeBinding can dispatch through a shape table without re-probing keys/values per flush
const classifyAttributeShape = (
	binding: AttributeBinding,
): ValueOf<typeof ATTRIBUTE_SHAPE> => {
	const keys = binding.keys;
	const values = binding.values;
	//a dynamic segment list either contains an expression slot (number) or has been split across multiple captures (length > 1) — both cases require concatenation at render time
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

	//static name + non-single-dynamic value: a single literal string (STATIC) or a concatenated form with at least one expression
	return values.length === 1
		? ATTRIBUTE_SHAPE.STATIC
		: ATTRIBUTE_SHAPE.STATIC_NAME_MULTI_VALUE;
};

//event-handler names always start with "on"; we sniff char codes ('o'=111, 'n'=110, '-'=45) to match the runtime probe in applyAttributeBinding
//a static single-segment name is fully known here, so we resolve the listener name once at parse time and the write path never re-derives it
const classifyAttributeName = (binding: AttributeBinding) => {
	const keys = binding.keys;
	//a dynamic name (expression slot or split across captures) isn't known until render — leave it UNKNOWN so the write path probes the resolved key
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

const completeAttribute = (parser: ParserState) => {
	if (parser.activeBinding) {
		const attributeBinding = parser.activeBinding as AttributeBinding;
		moveArrayContents(parser.attributeKeyBuffer, attributeBinding.keys);
		moveArrayContents(parser.attributeValueBuffer, attributeBinding.values);
		attributeBinding.shape = classifyAttributeShape(attributeBinding);
		classifyAttributeName(attributeBinding);

		//EXPANDABLE parses its single expression into key position (no `=value`), but every other shape carries its expression slot in `values`. relocate it so consumers read the slot from one consistent place regardless of shape.
		if (attributeBinding.shape === ATTRIBUTE_SHAPE.EXPANDABLE) {
			attributeBinding.values.push(attributeBinding.keys[0]);
			attributeBinding.keys.length = 0;
		}

		//attributes on the root template don't need a comment marker but we need to know how many bindings we have on it
		if (parser.isRootTemplate) {
			parser.hostBindingOffset++;
		} else {
			parser.resultBuffer.push(createComment(parser));
		}

		//replacing a tag means creating a new element and copying attributes over — but JS-property attributes (e.g. event listeners) don't survive that copy
		//=> we record which attribute bindings live on the surrounding tag so updateTag can mark them dirty and have them re-applied on the new element
		//the stack-top is the matching dynamic open (or null for a static open / empty stack), so the optional chain handles all three cases without an extra flag
		parser.openTagBindings[
			parser.openTagBindings.length - 1
		]?.relatedAttributes.push(parser.bindings.length - 1);
	} else if (parser.attributeKeyBuffer.length) {
		if (parser.isRootTemplate) {
			//static host attrs lower into AttributeBindings so they ride the same target/dirty machinery as everything else
			//no expression slot means update() never marks them dirty — zero per-update cost — and the renderer treats them uniformly with dynamic host bindings
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
			//a static attr needs a single-space separator from the preceding tag name or attr — we add it here instead of preserving the source whitespace, which avoids the extra push/shift dance for the dynamic case
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

//the single per-element boundary, clearing the open-tag scratch that isn't already drained by its own producer: the suppressed root <template> path can leave tagBuffer and currentTagName dangling, and a parsed-but-unconsumed selfClosing flag would leak to the next element. elementBuffer (drained by moveArrayContents above) and the attribute buffers (drained by completeAttribute) are provably empty here, so we only clear the buffers that can actually carry state across the boundary
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
	//`<div />` parses as an open tag in HTML5 — without a synthetic close, siblings get adopted as children.
	//currentTagName is the static tag name, or PLACEHOLDER_TAG ("div") for dynamic tags so updateTag still finds a complete element.
	if (parser.selfClosing) {
		parser.resultBuffer.push("</", parser.currentTagName, ">");
	}
	moveArrayContents(parser.contentBuffer, parser.resultBuffer);

	resetElementScope(parser);
};

const parse = (
	parser: ParserState,
	strings: TemplateStringsArray,
	force = false,
): ParsedHTML => {
	resetParser(parser, strings, force);

	for (
		parser.index = 0;
		parser.index < parser.templates.length;
		parser.index++
	) {
		parser.activeTemplate = parser.templates[parser.index];
		parser.splitIndex = 0; //always points to the start of the uncaptured portion of activeTemplate
		//caching the length keeps the loop bound as a simple int compare and dodges a property load per char
		const templateLength = parser.activeTemplate.length;

		for (
			parser.charIndex = 0;
			parser.charIndex < templateLength;
			parser.charIndex++
		) {
			//we read the char as a numeric code so peeks and compares stay in integer land
			const code = parser.activeTemplate.charCodeAt(parser.charIndex);

			switch (parser.state) {
				case STATE.TEXT: {
					//inside an element, we only care for the exit, which is either another tag (e.g. <strong>), the current tag's end (e.g. </div>), or a comment (e.g. <!-- -->)
					if (code !== CHAR_CODE.LESS_THAN) {
						continue;
					}
					capture(
						parser,
						parser.contentBuffer,
						parser.splitIndex,
						parser.charIndex,
					);
					//top-level non-whitespace text (before or after the root template) is a disqualifying sibling
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

					//comment
					if (nextCode === CHAR_CODE.BANG) {
						parser.state = STATE.COMMENT;
						parser.splitIndex = parser.charIndex + 4; // skip past "<!--"
						parser.charIndex += 2; // advance past "<!"
						continue;
					}

					//end tag
					if (nextCode === CHAR_CODE.SLASH) {
						parser.state = STATE.END_TAG;
						parser.splitIndex = parser.charIndex + 2;
						parser.charIndex++;
						continue;
					}

					//new element
					flushElement(parser);
					parser.state = STATE.ELEMENT;
					parser.charIndex--;
					continue;
				}

				case STATE.COMMENT:
					//inside a comment we can only exit when the comment is ended by -->
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
					); // exclude "-->"
					parser.splitIndex = parser.charIndex + 1;
					completeComment(parser);
					parser.state = STATE.TEXT;

					continue;

				case STATE.RAW_CONTENT:
					//here we also only care for the exit of the current element
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
					//the tag only refers to the name (div, span, etc.) and can be exited by a white space, indicating attributes, or by a closing bracket
					if (code !== CHAR_CODE.GREATER_THAN && !isWhitespaceCode(code)) {
						continue;
					}

					//`<div/>` (no space): trailing slash is part of the self-close, not the tag name
					const tagEnd =
						code === CHAR_CODE.GREATER_THAN &&
						parser.activeTemplate.charCodeAt(parser.charIndex - 1) ===
							CHAR_CODE.SLASH
							? parser.charIndex - 1
							: parser.charIndex;
					capture(parser, parser.tagBuffer, parser.splitIndex, tagEnd);
					parser.splitIndex = parser.charIndex;
					completeTag(parser);

					//white space means attributes
					if (code !== CHAR_CODE.GREATER_THAN) {
						parser.state = STATE.ELEMENT;
						parser.charIndex--; // we rewind the counter so the overarching element state can handle the white space, otherwise we would need more transitions here
						continue;
					}

					//special case of a self-closing tag
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
					//this is a meta state, coordinating tags and attributes, and marks the transition to the elements content
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
						//completeAttribute adds the separator for static attrs, so we just skip past the source whitespace
						parser.splitIndex = parser.charIndex + 1;
					} else {
						parser.splitIndex = parser.charIndex;
						parser.charIndex--; //we rewind so the attribute starts correctly
					}

					continue;

				case STATE.ATTRIBUTE_KEY:
					//there are different types of attributes - boolean attributes and attributes with a value
					//if we find an equal sign it's a value attribute
					if (code === CHAR_CODE.EQUALS) {
						capture(
							parser,
							parser.attributeKeyBuffer,
							parser.splitIndex,
							parser.charIndex,
						);
						parser.splitIndex = parser.charIndex + 1;
						parser.state = STATE.ATTRIBUTE_VALUE;
						//a white space marks the end of the current attribute and we move back to the element
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
						parser.charIndex--; //we rewind for element state management
						//self-closing tag: "/" before ">" ends the attribute without including the "/"
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
						//we transition to ELEMENT without rewinding — the next char ">" will be handled there
						parser.state = STATE.ELEMENT;
						//special case if the element ends directly after the boolean attribute
					} else if (code === CHAR_CODE.GREATER_THAN) {
						capture(
							parser,
							parser.attributeKeyBuffer,
							parser.splitIndex,
							parser.charIndex,
						);
						completeAttribute(parser);
						parser.state = STATE.ELEMENT;
						parser.charIndex--; //we rewind for element state management
					}
					continue;

				case STATE.ATTRIBUTE_VALUE:
					//here we need to check if we have a quoting char to detect the end of the attribute, either " or ' or a whitespace
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
						parser.charIndex--; //we rewind for element state management
					} else if (
						!parser.attributeQuoteCode &&
						code === CHAR_CODE.GREATER_THAN
					) {
						//special case if the unquoted attribute is ended by the element end
						capture(
							parser,
							parser.attributeValueBuffer,
							parser.splitIndex,
							parser.charIndex,
						);
						completeAttribute(parser);
						parser.state = STATE.ELEMENT;
						parser.charIndex--; //we rewind for element state management
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
			//end tags reuse the matching open tag's binding so a dynamic `</${tag}>` updates in lockstep with its `<${tag}>`
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
				(parser.activeBinding as TagBinding).bindingIndex,
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
		//trailing text in the final template string can also be a top-level sibling of the root
		if (
			parser.openTagBindings.length === 0 &&
			rangeHasNonWhitespace(parser, trailingStart, parser.activeTemplate.length)
		) {
			parser.sawTopLevelSibling = true;
		}
	}
	flushElement(parser);

	//our optimistic root pass suppressed the <template> wrapper; a real sibling proves it wasn't a root.
	//reparse with force so the template lowers as an ordinary (raw-content) element instead. the pooled instance is reused — the outer call reads nothing after this return.
	if (parser.hasRootTemplate && parser.sawTopLevelSibling) {
		return parse(parser, strings, true);
	}

	const result = parser.resultBuffer.join("");

	//document-free: we return the string seed and leave materialization to the rendering layer's buildFragment, run lazily on first setup()
	return {
		expressionToBinding: parser.expressionToBinding,
		bindings: parser.bindings,
		result,
		fragment: null,
		templateHash: stringHash(result),
		hostBindingOffset: parser.hostBindingOffset,
	};
};

//a single pooled parser instance, reset per parse: zero per-parse allocation on a render-time path.
//this is safe because parse() runs fully synchronously and can't re-enter — the only self-recursion is the `parse(parser, strings, true)` reparse at the tail, and the outer call reads nothing from `parser` after that `return`.
//if concurrent parsing ever becomes a requirement, allocate a parser per parse instead of pooling.
const parser = createParser();

//engines hand us the same TemplateStringsArray identity for every call from a given tagged-template literal site
//=> by keying a WeakMap on it, we get a per-call-site parse cache for free
//and the entry can GC once the call site (e.g. a dynamically loaded module) is unloaded
const htmlCache = new WeakMap<TemplateStringsArray, ParsedHTML>();

export const html = (
	tokens: TemplateStringsArray,
	...dynamicValues: Array<unknown>
): HTMLTemplate => {
	let parsed = htmlCache.get(tokens);
	if (!parsed) {
		parsed = parse(parser, tokens);
		htmlCache.set(tokens, parsed);
	}
	return new HTMLTemplate(parsed, dynamicValues);
};
