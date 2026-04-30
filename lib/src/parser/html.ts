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
import { COMMENT_IDENTIFIER, isQuote, isWhitespace, moveArrayContents } from "./html-util";
/*
parse a tagged template string into:
- a document fragment
- a hash
- an array of expression bindings
- a mapping from each expression index to its owning binding

Several expressions can share one binding:
  <div class="${dynamicA} static ${dynamicB}">  -> one attribute binding

The expressions also don't have to be adjacent. The two `${level}` slots below
share a single tag binding because open and close are paired:
  <h${level}>Hello, ${name}</h${level}>  -> one tag binding + one content binding

We walk character by character through a state machine. On each state change
we move the captured slice into the buffer array dedicated to that state, so
dynamic parts can be substituted without intermediate string allocations.
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
let selfClosing = false;
let activeBinding: Binding | null = null;
let activeTagBinding: Binding | null = null;
//tracks every open tag in source order, dynamic or static. A dynamic open pushes its TagBinding;
//a static open pushes null. Close tags pop and verify the kind matches — `<${tag}>...</div>` and
//`<div>...</${tag}>` both throw rather than silently picking the wrong opener via at(-1).
const openTagBindings: Array<TagBinding | null> = [];

/*
using the module scope was chose to keep performance high / reduce memory usage as much as possible
as this is executed early and needs to be fast

if concurrency becomes a requirement, we would need to put this into a class/closure and create a pool of parsers

a thrown exception mid-parse is safe: the next call enters through setup() which resets every buffer
and state field before reading anything, so leftover state from a failed parse cannot leak into the next one
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
	selfClosing = false;
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
		case STATE.END_TAG: {
			//end tags don't get their own binding — they reuse the matching open tag's binding
			//so a dynamic `</${tag}>` updates in lockstep with its `<${tag}>`. The caller in the
			//parse loop relies on this asymmetry and skips the bindings.push() for END_TAG state.
			const opener = openTagBindings.at(-1);
			if (!opener) {
				throw new Error(
					"Asymmetric tag: dynamic </${...}> close has no matching dynamic open tag — pair `<${tag}>` with `</${tag}>`.",
				);
			}
			return opener;
		}

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
		openTagBindings.push(activeBinding as TagBinding);
	} else {
		currentTagName = tagBuffer[0] as string;
		moveArrayContents(tagBuffer, elementBuffer);
		openTagBindings.push(null);
	}
	activeBinding = null;
};

const completeEndTag = () => {
	const opener = openTagBindings.pop();
	if (activeBinding) {
		if (!opener) {
			throw new Error(
				"Asymmetric tag: dynamic </${...}> close cannot pair with a static open tag — make the open dynamic too.",
			);
		}
		endTagBuffer.length = 0;
		endTagBuffer.push(PLACEHOLDER_TAG);
	} else if (opener) {
		throw new Error(
			"Asymmetric tag: static end tag cannot pair with a dynamic <${...}> open tag — make the close dynamic too.",
		);
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
	//`<div />` parses as an open tag in HTML5 — without a synthetic close, siblings get adopted as children.
	//currentTagName is the static tag name, or PLACEHOLDER_TAG ("div") for dynamic tags so updateTag still finds a complete element.
	if (selfClosing) {
		resultBuffer.push("</", currentTagName, ">");
		selfClosing = false;
	}
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
					//inside an element, we only care about the exit: a child tag (e.g. <strong>), the current tag's end (e.g. </div>), or a comment (e.g. <!-- -->)
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

				case STATE.TAG: {
					//the tag only refers to the name (div, span, etc.) and can be exited by a white space, indicating attributes, or by a closing bracket
					if (char !== ">" && !isWhitespace(char)) {
						continue;
					}

					//`<div/>` (no space): trailing slash is part of the self-close, not the tag name
					const tagEnd =
						char === ">" && activeTemplate[charIndex - 1] === "/"
							? charIndex - 1
							: charIndex;
					capture(tagBuffer, splitIndex, tagEnd);
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
						openTagBindings.pop();
						selfClosing = true;
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
				}

				case STATE.ELEMENT:
					//this is a meta state, coordinating tags and attributes, and marks the transition to the elements content
					if (char === "<") {
						state = STATE.TAG;
						continue;
					}

					if (char === ">") {
						if (activeTemplate[charIndex - 1] === "/") {
							openTagBindings.pop();
							selfClosing = true;
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

			//end tags reuse the matching open tag's binding (see createBinding STATE.END_TAG);
			//all other states get a fresh entry. The push of the open-tag stack happens in completeTag
			//so dynamic and static opens stay symmetric.
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
