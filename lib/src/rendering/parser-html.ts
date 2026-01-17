import { stringHash } from "./hashing";
import { HTMLTemplate } from "./template-html";
type ValueOf<T> = T[keyof T];

export const BINDING_TYPES = {
	TAG: 1,
	ATTR: 2,
	CONTENT: 3,
	RAW_CONTENT: 4,
} as const;

export type AttributeDescriptor = {
	type: typeof BINDING_TYPES.ATTR;
	values: Array<number | string>;
	keys: Array<number | string>;
};

export type ContentDescriptor = {
	type: typeof BINDING_TYPES.CONTENT;
	values: Array<number | string>;
};

export type RawContentDescriptor = {
	type: typeof BINDING_TYPES.RAW_CONTENT;
	values: Array<number | string>;
};

export type TagDescriptor = {
	type: typeof BINDING_TYPES.TAG;
	values: Array<number | string>;
	endValues: Array<number | string>;
};

export type Descriptor =
	| TagDescriptor
	| AttributeDescriptor
	| ContentDescriptor
	| RawContentDescriptor;

export type ParsedHTML = {
	descriptors: Array<Descriptor>;
	fragment: DocumentFragment;
	templateHash: number;
};

const range = new Range();
const specialElements = ["style", "script", "textarea"];

const isWhitespace = (char: string) =>
	char === " " || char === "\t" || char === "\n" || char === "\r";
const isQuote = (char: string) => {
	return char === "'" || char === '"';
};

const moveArrayContents = (from: Array<unknown>, to: Array<unknown>) => {
	for (let arrIndex = 0; arrIndex < from.length; arrIndex++) {
		to.push(from[arrIndex]);
	}
	from.length = 0;
};

const STATE = {
	// Content states
	TEXT: 10,
	COMMENT: 11,
	RAW_CONTENT: 12,

	// Element states
	ELEMENT: 20,
	TAG: 21,
	ATTRIBUTE_KEY: 22,
	ATTRIBUTE_VALUE: 33,

	// Close state
	END_TAG: 0,
} as const;

type StateValue = ValueOf<typeof STATE>;

let state: StateValue = STATE.TEXT;
let bindings: Array<Descriptor>;
let templates: TemplateStringsArray;

let bindingIndex = 0;
let index = 0;
let activeTemplate = "";

let charIndex = 0;
let splitIndex = -1;

let attrQuote = "";

let currentTagName = "";

let activeBinding: Descriptor | null = null;
const openTagBindings: Array<TagDescriptor> = [];

const resultBuffer: Array<string | number> = [];
const buffers = {
	element: [] as Array<string | number>,
	tag: [] as Array<string | number>,
	endTag: [] as Array<string | number>,
	content: [] as Array<string | number>,
	comment: [] as Array<string | number>,
	attributeKey: [] as Array<string | number>,
	attributeValue: [] as Array<string | number>,
	rawContent: [] as Array<string | number>,
};

const setup = (strings: TemplateStringsArray) => {
	state = STATE.TEXT;
	templates = strings;
	bindings = [];
	bindingIndex = 0;
	index = 0;
	activeTemplate = templates[index];
	charIndex = 0;
	splitIndex = -1;
	attrQuote = "";
	currentTagName = "";
};

const createComment = () => `<!-- h:${bindings.length - 1}:${bindingIndex} -->`;

const updateBinding = () => {
	switch (state) {
		case STATE.TEXT:
			capture(buffers.content, splitIndex);
			buffers.content.push(createComment() + createComment());
			(activeBinding as ContentDescriptor).values.push(index);
			activeBinding = null;
			break;

		case STATE.TAG:
			capture(buffers.tag, splitIndex);
			buffers.tag.push(index);
			break;

		case STATE.END_TAG:
			capture(buffers.endTag, splitIndex);
			(activeBinding as TagDescriptor).endValues.push(index);
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

const setBinding = () => {
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
			const binding = {
				type: BINDING_TYPES.TAG,
				values: [],
				endValues: [],
			} satisfies TagDescriptor;
			openTagBindings.push(binding);

			return binding;

		case STATE.END_TAG:
			return openTagBindings.at(-1)!;

		default:
			console.error("impossible state: ", state);
			throw new Error("impossible state");
	}
};

const capture = (
	buffer: Array<string | number>,
	start: number,
	end?: number
) => {
	if (!end || end > start) {
		const slice = activeTemplate.slice(start, end);
		if (slice) {
			buffer.push(slice);
		}
	}
};

const completeComment = () => {
	if (activeBinding) {
		moveArrayContents(
			buffers.comment,
			(activeBinding as ContentDescriptor).values
		);
		buffers.content.push(createComment() + createComment());
	} else {
		moveArrayContents(buffers.comment, buffers.content);
	}
	activeBinding = null;
};

const completeSpecialContent = () => {
	if (activeBinding) {
		resultBuffer.push(createComment());
		moveArrayContents(
			buffers.rawContent,
			(activeBinding as RawContentDescriptor).values
		);
	} else {
		moveArrayContents(buffers.rawContent, buffers.content);
	}
	activeBinding = null;
};

const completeTag = () => {
	if (activeBinding) {
		currentTagName = "div";
		moveArrayContents(buffers.tag, (activeBinding as TagDescriptor).values);
		buffers.element.push("div");
		resultBuffer.push(createComment());
	} else {
		currentTagName = buffers.tag[0] as string;
		moveArrayContents(buffers.tag, buffers.element);
	}
	activeBinding = null;
};

const completeEndTag = () => {
	if (activeBinding) {
		buffers.endTag.length = 0;
		buffers.endTag.push("div");
	}
	resultBuffer.push("</");
	moveArrayContents(buffers.endTag, resultBuffer);
	resultBuffer.push(">");
	activeBinding = null;
	openTagBindings.pop();
};

const completeAttribute = () => {
	if (activeBinding) {
		moveArrayContents(
			buffers.attributeKey,
			(activeBinding as AttributeDescriptor).keys
		);
		moveArrayContents(
			buffers.attributeValue,
			(activeBinding as AttributeDescriptor).values
		);
		resultBuffer.push(createComment());
	} else {
		moveArrayContents(buffers.attributeKey, buffers.element);
		if (buffers.attributeValue.length) {
			buffers.element.push("=");
			moveArrayContents(buffers.attributeValue, buffers.element);
		}
	}
	activeBinding = null;
	attrQuote = "";
};

const flushElement = () => {
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
					if (char !== "<") {
						continue;
					}
					capture(buffers.content, splitIndex, charIndex);
					splitIndex = charIndex + 1;

					if (nextChar === "!") {
						state = STATE.COMMENT;
						splitIndex = charIndex;
						continue;
					}

					if (nextChar === "/") {
						state = STATE.END_TAG;
						splitIndex = charIndex + 2;
						charIndex++;
						continue;
					}

					flushElement();
					state = STATE.ELEMENT;
					charIndex--;
					continue;
				case STATE.COMMENT:
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
					if (char !== "<" || nextChar !== "/") {
						continue;
					}

					const remaining = activeTemplate.slice(charIndex + 2);
					if (remaining.startsWith(currentTagName)) {
						capture(buffers.rawContent, splitIndex, charIndex);
						splitIndex = charIndex + 2 + currentTagName.length;
						charIndex += 1;
						completeSpecialContent();
						state = STATE.END_TAG;
						buffers.endTag.push(currentTagName);
					}
					continue;
				case STATE.TAG:
					if (char !== ">" && !isWhitespace(char)) {
						continue;
					}

					capture(buffers.tag, splitIndex, charIndex);
					splitIndex = charIndex;
					completeTag();

					if (char !== ">") {
						state = STATE.ELEMENT;
						charIndex--;
						continue;
					}

					if (activeTemplate[charIndex - 1] === "/") {
						flushElement();
						state = STATE.TEXT;
						splitIndex = charIndex + 1;
						continue;
					}

					state = specialElements.includes(currentTagName)
						? STATE.RAW_CONTENT
						: STATE.TEXT;

					splitIndex = charIndex + 1;
					continue;
				case STATE.ELEMENT:
					if (char === "<") {
						state = STATE.TAG;
						continue;
					}

					if (char === ">") {
						if (activeTemplate[charIndex - 1] === "/") {
							flushElement();
							state = STATE.TEXT;
						} else if (specialElements.includes(currentTagName)) {
							state = STATE.RAW_CONTENT;
						} else {
							state = STATE.TEXT;
						}
						splitIndex = charIndex + 1;
						continue;
					}

					if (!isWhitespace(char)) {
						charIndex--;
					}
					state = STATE.ATTRIBUTE_KEY;
					splitIndex = charIndex;

					continue;
				case STATE.ATTRIBUTE_KEY:
					if (char === "=") {
						capture(buffers.attributeKey, splitIndex, charIndex);
						splitIndex = charIndex + 1;
						state = STATE.ATTRIBUTE_VALUE;
					} else if (isWhitespace(char)) {
						// Boolean attribute
						capture(buffers.attributeKey, splitIndex, charIndex);
						splitIndex = charIndex;
						completeAttribute();
						state = STATE.ELEMENT;
						charIndex--; // rewind
					} else if (char === ">") {
						// Boolean attribute at end
						capture(buffers.attributeKey, splitIndex, charIndex);
						completeAttribute();
						state = STATE.ELEMENT;
						charIndex--; // rewind to let ELEMENT handle >
					}
					break;
				case STATE.ATTRIBUTE_VALUE:
					if (!attrQuote && isQuote(char)) {
						attrQuote = char;
						splitIndex = charIndex + 1;
					} else if (attrQuote && char === attrQuote) {
						capture(buffers.attributeValue, splitIndex, charIndex);
						splitIndex = charIndex + 1;
						completeAttribute();
						state = STATE.ELEMENT;
					} else if (!attrQuote && isWhitespace(char)) {
						// Unquoted value ended
						capture(buffers.attributeValue, splitIndex, charIndex);
						splitIndex = charIndex;
						completeAttribute();
						state = STATE.ELEMENT;
						charIndex--;
					} else if (!attrQuote && char === ">") {
						// Unquoted value at end
						capture(buffers.attributeValue, splitIndex, charIndex);
						completeAttribute();
						state = STATE.ELEMENT;
						charIndex--;
					}
					break;
				case STATE.END_TAG:
					if (char === ">") {
						capture(buffers.endTag, splitIndex, charIndex);
						splitIndex = charIndex + 1;
						flushElement();
						completeEndTag();
						state = STATE.TEXT;
					}
					break;
			}
		}

		if (!templates[index + 1]) {
			break;
		}

		if (!activeBinding) {
			bindingIndex = 0;
			activeBinding = setBinding();
			bindings.push(activeBinding);
		}
		bindingIndex++;
		updateBinding();
	}

	const result = resultBuffer.join("");

	return {
		descriptors: bindings,
		fragment: range.createContextualFragment(result),
		templateHash: stringHash(result),
	};
};

/*

todo: how do we continue from here? 

- do we keep an array with just data or add functionality to it?
- do we keep using classes or find a different way? 
? maybe we can use the array without actually changing anything in it
- if we keep the binding array from here, we need to be careful as this array is shared

*/

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

// const runTest = () => {
// 	const randomNr = Math.random();

// 	if (randomNr <= 0.33) {
// 		html` <div>hello ${"you"} there</div> `;
// 	} else if (randomNr <= 0.66) {
// 		html`
// 			<div class="card ${13} stuff">
// 				hello ${"you"}
// 				<!-- your ${"test"} name -->
// 				there
// 				<style>
// 					${"123"}
// 				</style>
// 			</div>
// 		`;
// 	} else {
// 		html`
// 	<section class="${"card"}">
// 		<h2>${"props"}</h2>
// 			<style media="(width < ${500}px)">
// 				* {
// 					margin: ${5}px;
// 				}
// 			</style>
// 			<style>
// 				* {
// 					margin: ${2}px;
// 				}
// 			</style>
// 			<style>${"* {all: unset}"}</style>
// 			<script>${"console.log('hello', 1 > 5, 2 < 4)"}</script>
// 			<script>console.log('hello', 1 > 5, 2 < 4)</script>
// 		<ul>
// 			<li class="class1 ${"test"} class3">complex attribute</li>
// 			<li class="${"test"} class3 ${"test"}">complexer attribute</li>
// 			<li disabled="${true}">boolean attribute</li>
// 		</ul>
// 		<div>
// 			<!-- some comment-->
// 			 ${"ignore comment"}
// 		</div>

// 		<textarea rows="${10}">tell me more about ${"parsing"}</textarea>

// 		<label>
// 			self closing tag
// 			<input value="${123}" />
// 		</label>

// 		<${"span"}>simple-tag</${"span"}>
// 		<custom-${"span"}>custom-tag</custom-${"span"}>
// 		<${"custom-"}${"span"}>custom-tag</${"custom-"}${"span"}>
// 	</section>
// `;
// 	}
// };

// setTimeout(() => {
// 	console.time("10000 iterations");
// 	for (let index = 0; index < 10000; index++) {
// 		runTest();
// 	}
// 	console.timeEnd("10000 iterations");
// }, 1000);
