import { HTMLTemplate } from "./template-html";
type ValueOf<T> = T[keyof T];

export const BINDING_TYPES = {
	TAG: 1,
	ATTR: 2,
	CONTENT: 3,
	SPECIAL: 4,
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

const range = new Range();
const specialElements = ["style", "script", "textArea"];

const isWhiteSpace = (char: string) => {
	return (
		char === " " ||
		char === "\t" ||
		char === "\n" ||
		char === "\r" ||
		char === "\f"
	);
};
const isQuote = (char: string) => {
	return char === "'" || char === '"';
};

const STATE = {
	TEXT_CONTENT: 1,
	COMMENT: 2,
	ELEMENT: 3,
	TAG: 4,
	END_TAG: 5,
	ATTRIBUTE_KEY: 6,
	ATTRIBUTE_VALUE: 7,
	SPECIAL_TAG: 9,
} as const;
type StateValue = ValueOf<typeof STATE>;

let state: StateValue = STATE.TEXT_CONTENT;
let bindings: Array<AttrBinding | TagBinding | ContentBinding> = [];
let templates: Array<string> = [];

let index = -1;
let activeTemplate = templates[index];

let charIndex = 0;
let splitIndex = -1;
let openTags: Array<string> = [];

let attrEqual = -1;
let attrQuote = "";

const setup = (strings: TemplateStringsArray) => {
	templates = [...strings];
	bindings = [];
	index = 0;
	activeTemplate = templates[index];
	charIndex = 0;
	splitIndex = -1;
	attrEqual = -1;
	attrQuote = "";
	openTags.length = 0;
};

const completeComment = () => {
	templates[index] =
		activeTemplate.slice(0, splitIndex) +
		` <span data-replace-${bindings.length}></span> `;
	const binding = {
		type: BINDING_TYPES.CONTENT,
		values: [activeTemplate.slice(splitIndex), index],
	};

	outer: for (index = index + 1; index < templates.length; index++) {
		activeTemplate = templates[index];

		for (charIndex = 0; index < activeTemplate.length; charIndex++) {
			const char = activeTemplate[charIndex];
			if (char !== ">") {
				continue;
			}
			if (
				activeTemplate[charIndex - 1] === "-" &&
				activeTemplate[charIndex - 2] === "-"
			) {
				templates[index] = activeTemplate.slice(charIndex + 1);
				binding.values.push(activeTemplate.slice(0, charIndex + 1));

				state = STATE.TEXT_CONTENT;
				break outer;
			}
		}
		templates[index] = "";
		binding.values.push(activeTemplate);
	}

	bindings.push(binding);
};

const completeTag = () => {
	templates[index] =
		activeTemplate.slice(0, splitIndex) +
		`div data-replace-${bindings.length} `;
	const binding = {
		type: BINDING_TYPES.TAG,
		values: [activeTemplate.slice(splitIndex), index],
		endValues: [],
	};

	outer: for (index = index + 1; index < templates.length; index++) {
		activeTemplate = templates[index];

		for (charIndex = 0; index < activeTemplate.length; charIndex++) {
			const char = activeTemplate[charIndex];
			if (isWhiteSpace(char) || char === ">") {
				templates[index] = activeTemplate.slice(charIndex + 1);
				binding.values.push(activeTemplate.slice(0, charIndex + 1));
				state = STATE.ELEMENT;
				break outer;
			}
		}
		templates[index] = "";
		binding.values.push(activeTemplate);
	}
	bindings.push(binding);
};

const completeEndTag = () => {
	templates[index] = activeTemplate.slice(0, splitIndex) + "div";
	const binding = bindings.at(-1)! as TagBinding;
	binding.endValues.push(index);

	outer: for (index = index + 1; index < templates.length; index++) {
		activeTemplate = templates[index];

		for (charIndex = 0; index < activeTemplate.length; charIndex++) {
			const char = activeTemplate[charIndex];
			if (char === ">") {
				templates[index] = activeTemplate.slice(charIndex + 1);
				state = STATE.ELEMENT;
				break outer;
			}
		}
		templates[index] = "";
		binding.endValues.push(index);
	}
};

const completeHole = () => {
	if (state === STATE.TEXT_CONTENT) {
		templates[index] =
			activeTemplate + ` <span data-replace-${bindings.length}></span> `;
		bindings.push({ type: BINDING_TYPES.CONTENT, values: [index] });
		return;
	}

	if (state === STATE.COMMENT) {
		completeComment();
	}

	if (state === STATE.TAG) {
		completeTag();
	}

	if (state === STATE.END_TAG) {
		completeEndTag();
	}
	//todo: add remaining cases
};

const parse = (strings: TemplateStringsArray): Bindings => {
	setup(strings);

	for (index = 0; index < templates.length; index++) {
		activeTemplate = templates[index];

		for (charIndex = 0; index < activeTemplate.length; charIndex++) {
			const char = activeTemplate[charIndex];

			if (!char) {
				break;
			}

			if (state === STATE.TEXT_CONTENT) {
				if (char !== "<") {
					continue;
				}

				if (activeTemplate[charIndex + 1] === "!") {
					state = STATE.COMMENT;
					charIndex += 3;
					splitIndex = charIndex;
					continue;
				}

				state = STATE.ELEMENT;
				charIndex--;
			}

			if (state === STATE.SPECIAL_TAG) {
				if (char !== "<") {
					continue;
				}

				const lastTag = openTags.at(-1)!;
				if (
					lastTag ===
					activeTemplate.slice(charIndex + 2, charIndex + 2 + lastTag.length)
				) {
					state = STATE.ELEMENT;
					charIndex--;
				}
			}

			if (state === STATE.COMMENT) {
				if (char !== ">") {
					continue;
				}
				if (
					activeTemplate[charIndex - 1] === "-" &&
					activeTemplate[charIndex - 2] === "-"
				) {
					splitIndex = -1;

					state = STATE.TEXT_CONTENT;
				}
			}

			if (state === STATE.ELEMENT) {
				if (char === "<") {
					if (activeTemplate[charIndex + 1] === "/") {
						state = STATE.END_TAG;
					} else {
						state = STATE.TAG;
					}
					splitIndex = charIndex + 1;
					continue;
				}

				if (isWhiteSpace(char)) {
					splitIndex = charIndex + 1;

					state = STATE.ATTRIBUTE_KEY;
					continue;
				}
				if (char === ">") {
					if (activeTemplate[charIndex - 1] === "/") {
						openTags.pop();
					}

					if (specialElements.includes(openTags.at(-1) ?? "")) {
						state = STATE.SPECIAL_TAG;
					} else {
						state = STATE.TEXT_CONTENT;
					}
					splitIndex = charIndex + 1;
				}
			}

			if (state === STATE.TAG) {
				if (isWhiteSpace(char) || char === ">") {
					openTags.push(activeTemplate.slice(splitIndex, charIndex));

					state = STATE.ELEMENT;
					splitIndex = -1;
					charIndex--;
				}
			}

			if (state === STATE.END_TAG) {
				if (char === ">") {
					splitIndex = -1;

					state = STATE.TEXT_CONTENT;
					openTags.pop();
				}
			}

			if (state === STATE.ATTRIBUTE_KEY) {
				if (isWhiteSpace(char)) {
					state = STATE.ELEMENT;
					splitIndex = -1;
					continue;
				}
				if (char === "=") {
					attrEqual = charIndex;

					state = STATE.ATTRIBUTE_VALUE;
				}
			}

			if (state === STATE.ATTRIBUTE_VALUE) {
				if (attrQuote && char === attrQuote) {
					state = STATE.ELEMENT;
					splitIndex = -1;
					attrQuote = "";
					continue;
				}

				if (isQuote(char)) {
					attrQuote = char;
					continue;
				}

				if (
					!attrQuote &&
					(isWhiteSpace(char) ||
						char === ">" ||
						(char === "/" && activeTemplate[charIndex + 1] === ">"))
				) {
					state = STATE.ELEMENT;
					splitIndex = -1;
					charIndex--;
				}
			}
		}

		if (state === STATE.ELEMENT) {
			state = STATE.ATTRIBUTE_KEY;
		}
		//completeHole();
	}

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
