import { stringHash } from "../utils/hashing";
import { HTMLTemplate } from "../rendering/template-html";
import {
	AttributeBinding,
	Binding,
	BINDING_TYPES,
	ContentBinding,
	ParsedHTML,
	RawContentBinding,
	TagBinding,
	ValueOf
} from "./types";
import { COMMENT_IDENTIFIER, isQuote, isWhitespace, moveArrayContents } from "./html-util"; /*
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

const range = new Range();
/*
these elements we need to handle differently as we can't have comment markers in them, so we can only replace them as a whole
this requires a different marker strategy
*/
const isSpecialElementTag = (tag: string) =>
	tag === "style" ||
	tag === "script" ||
	tag === "textarea" ||
	tag === "template";
const PLACEHOLDER_TAG = "div";

//dense 0..N so the main switch can compile to a jump table
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

let state: StateValue = STATE.TEXT;
let bindings: Array<Binding>;
let expressionToBinding: Array<number>;
let templates: TemplateStringsArray;
let index = 0;
let activeTemplate = "";
let charIndex = 0;
let splitIndex = 0;
let attributeQuote = "";
let currentTagName = "";
let activeBinding: Binding | null = null;
let activeTagBinding: Binding | null = null;
const openTagBindings: Array<TagBinding> = [];

/*
using the module scope was chose to keep performance high / reduce memory usage as much as possible
as this is executed early and needs to be fast

if concurrency becomes a requirement, we would need to put this into a class/closure and create a pool of parsers

*/
const resultBuffer: BufferArray = [];
const elementBuffer: BufferArray = [];
const tagBuffer: BufferArray = [];
const endTagBuffer: BufferArray = [];
const contentBuffer: BufferArray = [];
const commentBuffer: BufferArray = [];
const attributeKeyBuffer: BufferArray = [];
const attributeValueBuffer: BufferArray = [];
const rawContentBuffer: BufferArray = [];

const setup = (strings: TemplateStringsArray) => {
	state = STATE.TEXT;
	bindings = [];
	expressionToBinding = [];
	templates = strings;
	index = 0;
	activeTemplate = templates[index];
	charIndex = 0;
	splitIndex = 0;
	attributeQuote = "";
	currentTagName = "";
	activeBinding = null;
	activeTagBinding = null;
	openTagBindings.length = 0;
	resultBuffer.length = 0;
	elementBuffer.length = 0;
	tagBuffer.length = 0;
	endTagBuffer.length = 0;
	contentBuffer.length = 0;
	commentBuffer.length = 0;
	attributeKeyBuffer.length = 0;
	attributeValueBuffer.length = 0;
	rawContentBuffer.length = 0;
};

const createComment = () =>
	`<!--${COMMENT_IDENTIFIER} ${(activeBinding as Binding).type}-${bindings.length - 1}-->`;

const updateBinding = () => {
	switch (state) {
		case STATE.TEXT: {
			capture(contentBuffer, splitIndex);
			const marker = createComment();
			contentBuffer.push(marker, marker);
			(activeBinding as ContentBinding).values.push(index);
			activeBinding = null;
			break;
		}

		case STATE.TAG:
			capture(tagBuffer, splitIndex);
			tagBuffer.push(index);
			break;

		case STATE.END_TAG:
			capture(endTagBuffer, splitIndex);
			(activeBinding as TagBinding).endValues.push(index);
			break;

		case STATE.ATTRIBUTE_KEY:
			capture(attributeKeyBuffer, splitIndex);
			attributeKeyBuffer.push(index);
			break;

		case STATE.ATTRIBUTE_VALUE:
			capture(attributeValueBuffer, splitIndex);
			attributeValueBuffer.push(index);
			break;

		case STATE.COMMENT:
			capture(commentBuffer, splitIndex);
			commentBuffer.push(index);
			break;

		case STATE.RAW_CONTENT:
			capture(rawContentBuffer, splitIndex);
			rawContentBuffer.push(index);
			break;
	}
};

const createBinding = () => {
	switch (state) {
		case STATE.ATTRIBUTE_KEY:
		case STATE.ATTRIBUTE_VALUE:
			return {
				type: BINDING_TYPES.ATTR,
				values: [],
				keys: [],
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
				bindingIndex: bindings.length, //set before push so it matches the eventual index
			} satisfies TagBinding;
		case STATE.END_TAG:
			return openTagBindings.at(-1)!;

		default:
			throw new Error(`createBinding called in non-binding state: ${state}`);
	}
};

const capture = (buffer: BufferArray, start: number, end?: number) => {
	if (end !== undefined && end <= start) return;
	const slice = activeTemplate.slice(start, end);
	if (slice) buffer.push(slice);
};

const completeComment = () => {
	if (activeBinding) {
		moveArrayContents(commentBuffer, (activeBinding as ContentBinding).values);
		const marker = createComment();
		contentBuffer.push(marker, marker);
	} else {
		// static comments: re-wrap with delimiters since they were stripped during capture
		contentBuffer.push("<!--");
		moveArrayContents(commentBuffer, contentBuffer);
		contentBuffer.push("-->");
	}
	activeBinding = null;
};

const completeSpecialContent = () => {
	if (activeBinding) {
		resultBuffer.push(createComment());
		moveArrayContents(
			rawContentBuffer,
			(activeBinding as RawContentBinding).values,
		);
	} else {
		moveArrayContents(rawContentBuffer, contentBuffer);
	}
	activeBinding = null;
};

const completeTag = () => {
	if (activeBinding) {
		currentTagName = PLACEHOLDER_TAG;
		moveArrayContents(tagBuffer, (activeBinding as TagBinding).values);
		elementBuffer.push(PLACEHOLDER_TAG);
		resultBuffer.push(createComment());
		activeTagBinding = activeBinding;
	} else {
		currentTagName = tagBuffer[0] as string;
		moveArrayContents(tagBuffer, elementBuffer);
	}
	activeBinding = null;
};

const completeEndTag = () => {
	if (activeBinding) {
		endTagBuffer.length = 0;
		endTagBuffer.push(PLACEHOLDER_TAG);
		openTagBindings.pop();
	}
	resultBuffer.push("</");
	moveArrayContents(endTagBuffer, resultBuffer);
	resultBuffer.push(">");
	activeBinding = null;
};

const completeAttribute = () => {
	if (activeBinding) {
		moveArrayContents(
			attributeKeyBuffer,
			(activeBinding as AttributeBinding).keys,
		);
		moveArrayContents(
			attributeValueBuffer,
			(activeBinding as AttributeBinding).values,
		);
		resultBuffer.push(createComment());
		//leading whitespace is pushed as its own single-char entry by the ELEMENT→ATTRIBUTE_KEY transition;
		//drop it here without allocating a trimmed copy
		const keys = (activeBinding as AttributeBinding).keys;
		const firstKey = keys[0];
		if (
			typeof firstKey === "string" &&
			firstKey.length === 1 &&
			isWhitespace(firstKey)
		) {
			keys.shift();
		}
		//links attribute bindings to the tag binding. This reduces complexity later on as tag updates need to communicate to attribute updates
		(activeTagBinding as TagBinding)?.relatedAttributes.push(
			bindings.length - 1,
		);
	} else {
		moveArrayContents(attributeKeyBuffer, elementBuffer);
		if (attributeValueBuffer.length) {
			elementBuffer.push("=", "'");
			moveArrayContents(attributeValueBuffer, elementBuffer);
			elementBuffer.push("'");
		}
	}
	activeBinding = null;
	attributeQuote = "";
};

const flushElement = () => {
	activeTagBinding = null;

	if (elementBuffer.length === 0) {
		if (contentBuffer.length > 0) {
			moveArrayContents(contentBuffer, resultBuffer);
			contentBuffer.length = 0;
		}
		return;
	}

	resultBuffer.push("<");
	moveArrayContents(elementBuffer, resultBuffer);
	resultBuffer.push(">");
	moveArrayContents(contentBuffer, resultBuffer);

	currentTagName = "";
};

const parse = (strings: TemplateStringsArray): ParsedHTML => {
	setup(strings);

	for (index = 0; index < templates.length; index++) {
		activeTemplate = templates[index];
		splitIndex = 0; //always points to the start of the uncaptured portion of activeTemplate

		for (charIndex = 0; charIndex < activeTemplate.length; charIndex++) {
			const char = activeTemplate[charIndex];

			switch (state) {
				case STATE.TEXT: {
					//inside an element, we only care for the exit, which is either another tag (e.g. <strong>), the currents tag end (e.g. </div>), or a comment (e.g. <!-- -->)
					if (char !== "<") {
						continue;
					}
					capture(contentBuffer, splitIndex, charIndex);
					splitIndex = charIndex + 1;

					const nextChar = activeTemplate[charIndex + 1];

					//comment
					if (nextChar === "!") {
						state = STATE.COMMENT;
						splitIndex = charIndex + 4; // skip past "<!--"
						charIndex += 2; // advance past "<!"
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
				}

				case STATE.COMMENT:
					//inside a comment we can only exit when the comment is ended by -->
					if (
						char !== ">" ||
						activeTemplate[charIndex - 1] !== "-" ||
						activeTemplate[charIndex - 2] !== "-"
					) {
						continue;
					}

					capture(commentBuffer, splitIndex, charIndex - 2); // exclude "-->"
					splitIndex = charIndex + 1;
					completeComment();
					state = STATE.TEXT;

					continue;

				case STATE.RAW_CONTENT:
					//here we also only care for the exit of the current element
					if (char !== "<" || activeTemplate[charIndex + 1] !== "/") {
						continue;
					}

					if (activeTemplate.startsWith(currentTagName, charIndex + 2)) {
						capture(rawContentBuffer, splitIndex, charIndex);
						splitIndex = charIndex + 2 + currentTagName.length;
						charIndex += 1;
						completeSpecialContent();
						state = STATE.END_TAG;
						endTagBuffer.push(currentTagName);
					}
					continue;

				case STATE.TAG:
					//the tag only refers to the name (div, span, etc.) and can be exited by a white space, indicating attributes, or by a closing bracket
					if (char !== ">" && !isWhitespace(char)) {
						continue;
					}

					capture(tagBuffer, splitIndex, charIndex);
					splitIndex = charIndex;
					completeTag();

					//white space means attributes
					if (char !== ">") {
						state = STATE.ELEMENT;
						charIndex--; // we rewind the counter so the overarching element state can handle the white space, otherwise we would need more transitions here
						continue;
					}

					//special case of a self-closing tag
					if (activeTemplate[charIndex - 1] === "/") {
						flushElement();
						state = STATE.TEXT;
						splitIndex = charIndex + 1;
						continue;
					}

					state = isSpecialElementTag(currentTagName)
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
						} else if (isSpecialElementTag(currentTagName)) {
							state = STATE.RAW_CONTENT;
						} else {
							state = STATE.TEXT;
						}
						splitIndex = charIndex + 1;
						continue;
					}

					state = STATE.ATTRIBUTE_KEY;
					if (isWhitespace(char)) {
						//push the whitespace directly as its own buffer entry so downstream capture
						//starts past it — static attrs still get their separator; dynamic attrs can
						//drop this single-char entry in completeAttribute without trimming a string
						attributeKeyBuffer.push(char);
						splitIndex = charIndex + 1;
					} else {
						splitIndex = charIndex;
						charIndex--; //rewind so the attribute starts correctly
					}

					continue;

				case STATE.ATTRIBUTE_KEY:
					//there are different types of attributes - boolean attributes and attributes with a value
					//if we find an equal sign it's a value attribute
					if (char === "=") {
						capture(attributeKeyBuffer, splitIndex, charIndex);
						splitIndex = charIndex + 1;
						state = STATE.ATTRIBUTE_VALUE;
						//a white space marks the end of the current attribute and we move back to the element
					} else if (isWhitespace(char)) {
						capture(attributeKeyBuffer, splitIndex, charIndex);
						splitIndex = charIndex;
						completeAttribute();
						state = STATE.ELEMENT;
						charIndex--; // rewind for element state management
						//self-closing tag: "/" before ">" ends the attribute without including the "/"
					} else if (char === "/" && activeTemplate[charIndex + 1] === ">") {
						capture(attributeKeyBuffer, splitIndex, charIndex);
						completeAttribute();
						// transition to ELEMENT without rewinding — the next char ">" will be handled there
						state = STATE.ELEMENT;
						//special case if the element ends directly after the boolean attribute
					} else if (char === ">") {
						capture(attributeKeyBuffer, splitIndex, charIndex);
						completeAttribute();
						state = STATE.ELEMENT;
						charIndex--; // rewind for element state management
					}
					continue;

				case STATE.ATTRIBUTE_VALUE:
					//here we need to check if we have a quoting char to detect the end of the attribute, either " or ' or a whitespace
					if (!attributeQuote && isQuote(char)) {
						attributeQuote = char;
						splitIndex = charIndex + 1;
					} else if (attributeQuote && char === attributeQuote) {
						capture(attributeValueBuffer, splitIndex, charIndex);
						splitIndex = charIndex + 1;
						completeAttribute();
						state = STATE.ELEMENT;
					} else if (!attributeQuote && isWhitespace(char)) {
						capture(attributeValueBuffer, splitIndex, charIndex);
						splitIndex = charIndex;
						completeAttribute();
						state = STATE.ELEMENT;
						charIndex--; // rewind for element state management
					} else if (!attributeQuote && char === ">") {
						//special case if the unquoted attribute is ended by the element end
						capture(attributeValueBuffer, splitIndex, charIndex);
						completeAttribute();
						state = STATE.ELEMENT;
						charIndex--; // rewind for element state management
					}
					continue;

				case STATE.END_TAG:
					if (char === ">") {
						capture(endTagBuffer, splitIndex, charIndex);
						splitIndex = charIndex + 1;
						flushElement();
						completeEndTag();
						state = STATE.TEXT;
					}
					continue;
			}
		}

		if (index + 1 >= templates.length) {
			break;
		}

		if (!activeBinding) {
			activeBinding = createBinding();

			/*
             bindings for tags require special handling
             - the end tag has no binding but the tag binding still needs to know about them
             - so we store them in a stack to connect them
            */
			if (state === STATE.TAG) {
				openTagBindings.push(activeBinding as TagBinding);
			}

			if (state !== STATE.END_TAG) {
				bindings.push(activeBinding);
			}
		}

		if (state !== STATE.END_TAG) {
			expressionToBinding.push(bindings.length - 1);
		} else {
			expressionToBinding.push((activeBinding as TagBinding).bindingIndex);
		}

		updateBinding();
	}

	flushElement();

	const result = resultBuffer.join("");

	return {
		expressionToBinding,
		bindings,
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
