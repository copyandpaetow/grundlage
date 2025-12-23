import { HTMLTemplate } from "./template-html";
type ValueOf<T> = T[keyof T];

export const BINDING_TYPES = {
	TAG: 1,
	ATTR: 2,
	CONTENT: 3,
} as const;

export type AttrBinding = {
	type: typeof BINDING_TYPES.ATTR;
	values: Array<number | string>;
	keys: Array<number | string>;
};

export type ContentBinding = {
	type: typeof BINDING_TYPES.CONTENT;
	values: Array<number | string>;
};

export type TagBinding = {
	type: typeof BINDING_TYPES.TAG;
	values: Array<number | string>;
	endValues: Array<number | string>;
};

export type Bindings = {
	binding: Array<AttrBinding | TagBinding | ContentBinding>;
	fragment: DocumentFragment;
	templateHash: number;
};

export type Binding = TagBinding | AttrBinding | ContentBinding;

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
	SPECIAL_CONTENT: 12,

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
let bindings: Array<AttrBinding | TagBinding | ContentBinding>;
let templates: TemplateStringsArray;

let index = 0;
let activeTemplate = "";

let charIndex = 0;
let splitIndex = -1;

let attrQuote = "";

let currentTagName = "";

let activeBinding: AttrBinding | TagBinding | ContentBinding | null = null;
const openTagBindings: Array<TagBinding> = [];

const resultBuffer: Array<string | number> = [];
const buffers = {
	element: [] as Array<string | number>,
	tag: [] as Array<string | number>,
	endTag: [] as Array<string | number>,
	content: [] as Array<string | number>,
	comment: [] as Array<string | number>,
	attributeKey: [] as Array<string | number>,
	attributeValue: [] as Array<string | number>,
	specialContent: [] as Array<string | number>,
};

const setup = (strings: TemplateStringsArray) => {
	state = STATE.TEXT;
	templates = strings;
	bindings = new Array(strings.length - 1);
	index = 0;
	activeTemplate = templates[index];
	charIndex = 0;
	splitIndex = -1;
	attrQuote = "";
	currentTagName = "";
};

const updateBinding = () => {
	switch (state) {
		case STATE.TEXT:
			// Text hole - capture any remaining text, then set up binding
			capture(buffers.content, splitIndex);
			//this happens at the end of the current template, so the index is not yet updated
			buffers.content.push(`<span data-h-${index + 1}></span>`);
			(activeBinding as ContentBinding).values.push(index);
			activeBinding = null;
			break;

		case STATE.TAG:
			capture(buffers.tag, splitIndex);
			buffers.tag.push(index);
			break;

		case STATE.END_TAG:
			capture(buffers.endTag, splitIndex);
			(activeBinding as TagBinding).endValues.push(index);
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

		case STATE.SPECIAL_CONTENT:
			capture(buffers.specialContent, splitIndex);
			buffers.specialContent.push(index);
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
			};
		case STATE.COMMENT:
		case STATE.SPECIAL_CONTENT:
		case STATE.TEXT:
			return {
				type: BINDING_TYPES.CONTENT,
				values: [],
			};
		case STATE.TAG:
			const binding = {
				type: BINDING_TYPES.TAG,
				values: [],
				endValues: [],
			};
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
			(activeBinding as ContentBinding).values
		);
		buffers.content.push(`<span data-h-${index}></span>`);
	} else {
		moveArrayContents(buffers.comment, buffers.content);
	}
	activeBinding = null;
};

const completeSpecialContent = () => {
	if (activeBinding) {
		buffers.element.push(` data-h-${index}`);
		moveArrayContents(
			buffers.specialContent,
			(activeBinding as ContentBinding).values
		);
		// content stays empty, element already has marker
	} else {
		moveArrayContents(buffers.specialContent, buffers.content);
	}
	activeBinding = null;
};

const completeTag = () => {
	if (activeBinding) {
		currentTagName = "div";
		moveArrayContents(buffers.tag, (activeBinding as TagBinding).values);
		buffers.element.push("div", ` data-h-${index}`);
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
			(activeBinding as AttrBinding).keys
		);
		moveArrayContents(
			buffers.attributeValue,
			(activeBinding as AttrBinding).values
		);
		buffers.element.push(` data-h-${index}`);
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
	//todo: new element, every needs to go
	//todo: we need a way to handle self closing tags here as well. Maybe pass in the closing tag?

	console.dir(structuredClone(buffers));

	if (buffers.element.length === 0) {
		// No element to flush (e.g., initial text content)
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

const parse = (strings: TemplateStringsArray): Bindings => {
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
					// Capture any text before this
					capture(buffers.content, splitIndex, charIndex); //todo: slice is exclusive, maybe we need to add 1 here
					splitIndex = charIndex + 1;

					if (nextChar === "!") {
						state = STATE.COMMENT;
						splitIndex = charIndex;
						continue;
					}

					if (nextChar === "/") {
						// End tag
						state = STATE.END_TAG;
						splitIndex = charIndex + 2; // skip </
						charIndex++; // skip the /
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

					// End of comment -->
					capture(buffers.comment, splitIndex, charIndex + 1);
					splitIndex = charIndex + 1;
					completeComment();
					state = STATE.TEXT;

					continue;
				case STATE.SPECIAL_CONTENT:
					if (char !== "<" || nextChar !== "/") {
						continue;
					}

					// Potential end of special element
					// Check if it's closing our special tag
					const remaining = activeTemplate.slice(charIndex + 2);
					if (remaining.startsWith(currentTagName)) {
						capture(buffers.specialContent, splitIndex, charIndex);
						splitIndex = charIndex + 2 + currentTagName.length;
						charIndex += 1; // skip to /
						completeSpecialContent();
						state = STATE.END_TAG;
						// Position splitIndex after tag name
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
						// Whitespace - go to ELEMENT, rewind
						state = STATE.ELEMENT;
						// Don't advance splitIndex, let ELEMENT see the whitespace
						charIndex--; // rewind
						continue;
					}

					if (activeTemplate[charIndex - 1] === "/") {
						// Self-closing tag - remove the trailing /
						//todo: check what is actually there
						flushElement();
						state = STATE.TEXT;
						splitIndex = charIndex + 1;
						continue;
					}

					state = specialElements.includes(currentTagName)
						? STATE.SPECIAL_CONTENT
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
							// Self-closing
							flushElement();
							state = STATE.TEXT;
						} else if (specialElements.includes(currentTagName)) {
							state = STATE.SPECIAL_CONTENT;
						} else {
							state = STATE.TEXT;
						}
						splitIndex = charIndex + 1;
						continue;
					}

					if (!isWhitespace(char)) {
						charIndex--;
					}
					// Start of attribute
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
			activeBinding = setBinding();
		}
		bindings[index] = activeBinding;
		updateBinding();
	}

	console.dir(buffers);
	console.log(bindings);
	console.log(resultBuffer.join(""));

	return {
		binding: bindings,
		fragment: range.createContextualFragment(""),
		templateHash: 0,
	};
};

const htmlCache = new WeakMap<TemplateStringsArray, Bindings>();

export const html = (
	tokens: TemplateStringsArray,
	...dynamicValues: Array<unknown>
): HTMLTemplate => {
	console.log("start");
	parse(tokens);
	console.log("end");

	// if (!htmlCache.has(tokens)) {
	// 	htmlCache.set(tokens, parse(tokens));
	// }
	// return new HTMLTemplate(htmlCache.get(tokens)!, dynamicValues);
};

// html` <div>hello ${"you"} there</div> `;

// html`
// 	<div class="card ${13} stuff">
// 		hello ${"you"}
// 		<!-- your ${"test"} name -->
// 		there
// 		<style>
// 			${"123"}
// 		</style>
// 	</div>
// `;

html`
	<section class="${"card"}">
		<h2>${"props"}</h2>
			<style media="(width < ${500}px)">
				* {
					margin: ${5}px;
				}
			</style>
			<style>
				* {
					margin: ${2}px;
				}
			</style>
			<style>${"* {all: unset}"}</style>
			<script>${"console.log('hello', 1 > 5, 2 < 4)"}</script>
			<script>console.log('hello', 1 > 5, 2 < 4)</script>
		<ul>
			<li class="class1 ${"test"} class3">complex attribute</li>
			<li class="${"test"} class3 ${"test"}">complexer attribute</li>
			<li disabled="${true}">boolean attribute</li>
		</ul>
		<div>
			<!-- some comment-->
			 ${"ignore comment"}
		</div>

		<textarea rows="${10}">tell me more about ${"parsing"}</textarea>

		<label>
			self closing tag
			<input value="${123}" />
		</label>

		<${"span"}>simple-tag</${"span"}>
		<custom-${"span"}>custom-tag</custom-${"span"}>
		<${"custom-"}${"span"}>custom-tag</${"custom-"}${"span"}>
	</section>
`;
