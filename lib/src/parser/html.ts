import { stringHash } from "../utils/hashing";
import { HTMLTemplate } from "../rendering/template-html";
import {
	ValueOf,
	Descriptor,
	TagDescriptor,
	ContentDescriptor,
	BINDING_TYPES,
	AttributeDescriptor,
	RawContentDescriptor,
	ParsedHTML,
} from "./types";
import {
	COMMENT_IDENTIFIER,
	isQuote,
	isWhitespace,
	moveArrayContents,
} from "./html-util";

/*
the idea here is to analyse and parse a tagged template string to give us
- a document fragment
- a hash
- an array of expressions descriptions aka "descriptors"
- a mapping of which expressions map to which descriptor

several expressions can be part of one descriptor like
<div class="${dynamic1} static ${dynamic1}"> 
=> one attribute descriptor

They also dont have to be next to each other
<h${headingLevel}>Hello, ${name}<h${headingLevel}>
=> one tag descriptor
=> one content descriptor

We walk each character and listen for different character combinations to change the state machine. 
Depending on the state we move the last characters sine the state change to the dedicated buffer array.
=> this way we can change and insert parts dynamically while also keeping memory usage low / performance up

*/

type StateValue = ValueOf<typeof STATE>;
type BufferArray = Array<string | number>;

const range = new Range();
/*
these elements we need to handle differently as we cant have comment markers in them, so we can only replace them as a hole
this requires a different marker strategy
*/
const SPECIAL_ELEMENT_TAGS = ["style", "script", "textarea", "template"];

const STATE = {
	TEXT: 10,
	COMMENT: 11,
	RAW_CONTENT: 12,
	ELEMENT: 20,
	TAG: 21,
	ATTRIBUTE_KEY: 22,
	ATTRIBUTE_VALUE: 33,
	END_TAG: 0,
} as const;

let state: StateValue = STATE.TEXT;
let descriptors: Array<Descriptor>;
let expressionToDescriptor: Array<number>;
let templates: TemplateStringsArray;
let index = 0;
let activeTemplate = "";
let charIndex = 0;
let splitIndex = 0;
let attrQuote = "";
let currentTagName = "";
let activeDescriptor: Descriptor | null = null;
let activeTagDescriptor: Descriptor | null = null;
const openTagDescriptors: Array<TagDescriptor> = [];

/*
using the module scope was chose to keep performance high / reduce memory usage as much as possible
as this is executed early and needs to be fast

if concurrency becomes a requirement, we would need to put this into a class/closure and create a pool of parsers 

*/
const setup = (strings: TemplateStringsArray) => {
	state = STATE.TEXT;
	descriptors = [];
	expressionToDescriptor = [];
	templates = strings;
	index = 0;
	activeTemplate = templates[index];
	charIndex = 0;
	splitIndex = 0;
	attrQuote = "";
	currentTagName = "";
	activeDescriptor = null;
	activeTagDescriptor = null;
	openTagDescriptors.length = 0;
	resultBuffer.length = 0;
	buffers.element.length = 0;
	buffers.tag.length = 0;
	buffers.endTag.length = 0;
	buffers.content.length = 0;
	buffers.comment.length = 0;
	buffers.attributeKey.length = 0;
	buffers.attributeValue.length = 0;
	buffers.rawContent.length = 0;
};

const resultBuffer: BufferArray = [];
const buffers = {
	element: [] as BufferArray,
	tag: [] as BufferArray,
	endTag: [] as BufferArray,
	content: [] as BufferArray,
	comment: [] as BufferArray,
	attributeKey: [] as BufferArray,
	attributeValue: [] as BufferArray,
	rawContent: [] as BufferArray,
};

const createComment = () =>
	`<!--${COMMENT_IDENTIFIER}${activeDescriptor?.type}-${descriptors.length - 1}${COMMENT_IDENTIFIER}-->`;

const updateDescriptor = () => {
	switch (state) {
		case STATE.TEXT:
			capture(buffers.content, splitIndex);
			buffers.content.push(createComment(), createComment());
			(activeDescriptor as ContentDescriptor).values.push(index);
			activeDescriptor = null;
			break;

		case STATE.TAG:
			capture(buffers.tag, splitIndex);
			buffers.tag.push(index);
			break;

		case STATE.END_TAG:
			capture(buffers.endTag, splitIndex);
			(activeDescriptor as TagDescriptor).endValues.push(index);
			break;

		case STATE.ATTRIBUTE_KEY:
			capture(buffers.attributeKey, splitIndex);
			buffers.attributeKey.push(index);
			break;

		case STATE.ATTRIBUTE_VALUE:
			capture(buffers.attributeValue, splitIndex);
			buffers.attributeValue.push(index);
			break;

		case STATE.COMMENT:
			capture(buffers.comment, splitIndex);
			buffers.comment.push(index);
			break;

		case STATE.RAW_CONTENT:
			capture(buffers.rawContent, splitIndex);
			buffers.rawContent.push(index);
			break;

		default:
			console.warn("you shouldnt be here");
			break;
	}
};

const setDescriptor = () => {
	switch (state) {
		case STATE.ATTRIBUTE_KEY:
		case STATE.ATTRIBUTE_VALUE:
			return {
				type: BINDING_TYPES.ATTR,
				values: [],
				keys: [],
			} satisfies AttributeDescriptor;
		case STATE.COMMENT:
		case STATE.TEXT:
			return {
				type: BINDING_TYPES.CONTENT,
				values: [],
			} satisfies ContentDescriptor;
		case STATE.RAW_CONTENT:
			return {
				type: BINDING_TYPES.RAW_CONTENT,
				values: [],
			} satisfies RawContentDescriptor;
		case STATE.TAG:
			return {
				type: BINDING_TYPES.TAG,
				values: [],
				endValues: [],
				relatedAttributes: [],
			} satisfies TagDescriptor;
		case STATE.END_TAG:
			return openTagDescriptors.at(-1)!;

		default:
			console.error("impossible state: ", state);
			throw new Error("impossible state");
	}
};

const capture = (buffer: BufferArray, start: number, end?: number) => {
	if (!end || end > start) {
		const slice = activeTemplate.slice(start, end);
		if (slice) {
			buffer.push(slice);
		}
	}
};

const completeComment = () => {
	if (activeDescriptor) {
		moveArrayContents(
			buffers.comment,
			(activeDescriptor as ContentDescriptor).values,
		);
		buffers.content.push(createComment(), createComment());
	} else {
		moveArrayContents(buffers.comment, buffers.content);
	}
	activeDescriptor = null;
};

const completeSpecialContent = () => {
	if (activeDescriptor) {
		resultBuffer.push(createComment());
		moveArrayContents(
			buffers.rawContent,
			(activeDescriptor as RawContentDescriptor).values,
		);
	} else {
		moveArrayContents(buffers.rawContent, buffers.content);
	}
	activeDescriptor = null;
};

const completeTag = () => {
	if (activeDescriptor) {
		currentTagName = "div";
		moveArrayContents(buffers.tag, (activeDescriptor as TagDescriptor).values);
		buffers.element.push("div");
		resultBuffer.push(createComment());
		activeTagDescriptor = activeDescriptor;
	} else {
		currentTagName = buffers.tag[0] as string;
		moveArrayContents(buffers.tag, buffers.element);
	}
	activeDescriptor = null;
};

const completeEndTag = () => {
	if (activeDescriptor) {
		buffers.endTag.length = 0;
		buffers.endTag.push("div");
	}
	resultBuffer.push("</");
	moveArrayContents(buffers.endTag, resultBuffer);
	resultBuffer.push(">");
	activeDescriptor = null;
	openTagDescriptors.pop();
};

const completeAttribute = () => {
	if (activeDescriptor) {
		moveArrayContents(
			buffers.attributeKey,
			(activeDescriptor as AttributeDescriptor).keys,
		);
		moveArrayContents(
			buffers.attributeValue,
			(activeDescriptor as AttributeDescriptor).values,
		);
		resultBuffer.push(createComment());
		const firstKey = (activeDescriptor as AttributeDescriptor).keys[0];
		if (typeof firstKey === "string") {
			(activeDescriptor as AttributeDescriptor).keys[0] = firstKey.trimStart();
		}
		(activeTagDescriptor as TagDescriptor)?.relatedAttributes.push(
			descriptors.length - 1,
		);
	} else {
		moveArrayContents(buffers.attributeKey, buffers.element);
		if (buffers.attributeValue.length) {
			buffers.element.push("=");
			moveArrayContents(buffers.attributeValue, buffers.element);
		}
	}
	activeDescriptor = null;
	attrQuote = "";
};

const flushElement = () => {
	activeTagDescriptor = null;

	if (buffers.element.length === 0) {
		if (buffers.content.length > 0) {
			moveArrayContents(buffers.content, resultBuffer);
			buffers.content.length = 0;
		}
		return;
	}

	resultBuffer.push("<");
	moveArrayContents(buffers.element, resultBuffer);
	resultBuffer.push(">");
	moveArrayContents(buffers.content, resultBuffer);

	currentTagName = "";
};

const parse = (strings: TemplateStringsArray): ParsedHTML => {
	setup(strings);

	for (index = 0; index < templates.length; index++) {
		activeTemplate = templates[index];
		splitIndex = 0;

		for (charIndex = 0; charIndex < activeTemplate.length; charIndex++) {
			const char = activeTemplate[charIndex];
			const nextChar = activeTemplate[charIndex + 1];

			switch (state) {
				case STATE.TEXT:
					//inside an element, we only care for the exit, which is either another tag (e.g. <strong>), the currents tag end (e.g. </div>), or a comment (e.g. <!-- -->)
					if (char !== "<") {
						continue;
					}
					capture(buffers.content, splitIndex, charIndex);
					splitIndex = charIndex + 1;

					//comment
					if (nextChar === "!") {
						state = STATE.COMMENT;
						splitIndex = charIndex;
						continue;
					}

					//end tag
					if (nextChar === "/") {
						state = STATE.END_TAG;
						splitIndex = charIndex + 2;
						charIndex++;
						continue;
					}

					//new element
					flushElement();
					state = STATE.ELEMENT;
					charIndex--;
					continue;

				case STATE.COMMENT:
					//inside a comment we can only exit when the comment is ended by -->
					if (
						char !== ">" ||
						activeTemplate[charIndex - 1] !== "-" ||
						activeTemplate[charIndex - 2] !== "-"
					) {
						continue;
					}

					capture(buffers.comment, splitIndex, charIndex + 1);
					splitIndex = charIndex + 1;
					completeComment();
					state = STATE.TEXT;

					continue;

				case STATE.RAW_CONTENT:
					//here we also only care for the exit of the current element
					if (char !== "<" || nextChar !== "/") {
						continue;
					}

					if (activeTemplate.startsWith(currentTagName, charIndex + 2)) {
						capture(buffers.rawContent, splitIndex, charIndex);
						splitIndex = charIndex + 2 + currentTagName.length;
						charIndex += 1;
						completeSpecialContent();
						state = STATE.END_TAG;
						buffers.endTag.push(currentTagName);
					}
					continue;

				case STATE.TAG:
					//the tag only refers to the name (div, span, etc.) and can be exited by a white space, indicated attributes, or by a closing braket
					if (char !== ">" && !isWhitespace(char)) {
						continue;
					}

					capture(buffers.tag, splitIndex, charIndex);
					splitIndex = charIndex;
					completeTag();

					//white space means attributes
					if (char !== ">") {
						state = STATE.ELEMENT;
						charIndex--; // we rewind the counter so the overarching element state can handle the white space, otherwise we would need more transitions here
						continue;
					}

					//special case of a self closing tag
					if (activeTemplate[charIndex - 1] === "/") {
						flushElement();
						state = STATE.TEXT;
						splitIndex = charIndex + 1;
						continue;
					}

					state = SPECIAL_ELEMENT_TAGS.includes(currentTagName)
						? STATE.RAW_CONTENT
						: STATE.TEXT;

					splitIndex = charIndex + 1;
					continue;

				case STATE.ELEMENT:
					//this is a meta state, coordinating tags and attributes, and marks the transition to the elements content
					if (char === "<") {
						state = STATE.TAG;
						continue;
					}

					if (char === ">") {
						if (activeTemplate[charIndex - 1] === "/") {
							flushElement();
							state = STATE.TEXT;
						} else if (SPECIAL_ELEMENT_TAGS.includes(currentTagName)) {
							state = STATE.RAW_CONTENT;
						} else {
							state = STATE.TEXT;
						}
						splitIndex = charIndex + 1;
						continue;
					}

					if (!isWhitespace(char)) {
						charIndex--; //rewind so the attribute starts correctly
					}
					state = STATE.ATTRIBUTE_KEY;
					splitIndex = charIndex;

					continue;

				case STATE.ATTRIBUTE_KEY:
					//there are different types of attributes - boolean attributes and attributes with a value
					//if we find an equal sign its a value attribute
					if (char === "=") {
						capture(buffers.attributeKey, splitIndex, charIndex);
						splitIndex = charIndex + 1;
						state = STATE.ATTRIBUTE_VALUE;
						//a white space marks the end of the current attribute and we move back to the element
					} else if (isWhitespace(char)) {
						capture(buffers.attributeKey, splitIndex, charIndex);
						splitIndex = charIndex;
						completeAttribute();
						state = STATE.ELEMENT;
						charIndex--; // rewind for element state management
						//special case if the element ends directly after the boolean attribute
					} else if (char === ">") {
						capture(buffers.attributeKey, splitIndex, charIndex);
						completeAttribute();
						state = STATE.ELEMENT;
						charIndex--; // rewind for element state management
					}
					continue;

				case STATE.ATTRIBUTE_VALUE:
					//here we need to check if we have a quoting char to detect the end of the attribute, either " or ' or a whitespace
					if (!attrQuote && isQuote(char)) {
						attrQuote = char;
						splitIndex = charIndex + 1;
					} else if (attrQuote && char === attrQuote) {
						capture(buffers.attributeValue, splitIndex, charIndex);
						splitIndex = charIndex + 1;
						completeAttribute();
						state = STATE.ELEMENT;
					} else if (!attrQuote && isWhitespace(char)) {
						capture(buffers.attributeValue, splitIndex, charIndex);
						splitIndex = charIndex;
						completeAttribute();
						state = STATE.ELEMENT;
						charIndex--; // rewind for element state management
					} else if (!attrQuote && char === ">") {
						//special case if the unquoted attribute is ended by the element end
						capture(buffers.attributeValue, splitIndex, charIndex);
						completeAttribute();
						state = STATE.ELEMENT;
						charIndex--; // rewind for element state management
					}
					continue;

				case STATE.END_TAG:
					if (char === ">") {
						capture(buffers.endTag, splitIndex, charIndex);
						splitIndex = charIndex + 1;
						flushElement();
						completeEndTag();
						state = STATE.TEXT;
					}
					continue;
			}
		}

		if (!templates[index + 1]) {
			break;
		}

		if (!activeDescriptor) {
			activeDescriptor = setDescriptor();

			/*
			 bindings for tags require special handling
			 - the end tag has no binding but the tag descriptor still needs to know about them
			 - so we store them in a stack to conenct them
			*/
			if (state === STATE.TAG) {
				openTagDescriptors.push(activeDescriptor as TagDescriptor);
			}

			if (state !== STATE.END_TAG) {
				descriptors.push(activeDescriptor);
			}
		}

		if (state !== STATE.END_TAG) {
			expressionToDescriptor.push(descriptors.length - 1);
		} else {
			expressionToDescriptor.push(descriptors.indexOf(activeDescriptor));
		}

		updateDescriptor();
	}

	flushElement();

	const result = resultBuffer.join("");

	return {
		expressionToDescriptor,
		descriptors,
		fragment: range.createContextualFragment(result),
		templateHash: stringHash(result),
	};
};

const htmlCache = new WeakMap<TemplateStringsArray, ParsedHTML>();

export const html = (
	tokens: TemplateStringsArray,
	...dynamicValues: Array<unknown>
): HTMLTemplate => {
	if (!htmlCache.has(tokens)) {
		htmlCache.set(tokens, parse(tokens));
	}
	return new HTMLTemplate(htmlCache.get(tokens)!, dynamicValues);
};
