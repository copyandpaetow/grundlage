import { isWhitespace, isQuote } from "./html/dom-helper";
import { stringHash } from "./hashing";
import { addAttribute, ATTRIBUTE_CASES } from "./html/add-attribute";
import { HTMLTemplate } from "./template-html";

const BINDING_TYPES = {
	TAG: 1,
	END_TAG: 2,
	ATTR: 3,
	TEXT: 4,
	TEXT_CONTENT: 5,
} as const;

type ValueOf<T> = T[keyof T];

export type AttrBinding = {
	values: Array<number | string>;
	keys: Array<number | string>;
};

export type ContentBinding = number;

export type TagBinding = {
	values: Array<number | string>;
	endValues: Array<number | string>;
};

export type State = {
	position: number;
	binding: Array<AttrBinding | TagBinding | ContentBinding>;
	templates: Array<string>;
	lastBindingType: ValueOf<typeof BINDING_TYPES>;
	openTags: Array<number>;
	closingChar: string;
	equalChar: number;
	firstLetterChar: number;
	whiteSpaceChar: number;
	quoteChar: number;
};

export type Bindings = {
	binding: Array<AttrBinding | TagBinding | ContentBinding>;
	fragment: DocumentFragment;
	templateHash: number;
};

export type MixedArray = Array<string | number>;

const isInsideTag = (
	stringSegment: string,
	lastType: ValueOf<typeof BINDING_TYPES>
) => {
	let index = stringSegment.length - 1;
	let result;

	//we iterate the string from back to start (away from the hole) to see if we find a bracket that is not a comment
	//closing means are are inside of the content/outside of a tag
	while (index >= 0) {
		const char = stringSegment[index];

		if (char === ">") {
			if (index >= 2 && stringSegment.slice(index - 2, index + 1) === "-->") {
				index -= 3;
				continue;
			}
			result = false;
			break;
		}
		if (char === "<") {
			if (
				index + 3 < stringSegment.length &&
				stringSegment.slice(index, index + 4) === "<!--"
			) {
				index -= 1;
				continue;
			}

			result = true;
			break;
		}
		index--;
	}

	if (result !== undefined) {
		return result;
	}

	return lastType !== BINDING_TYPES.TEXT;
};

//todo: maybe the determine context function calls different completion functions for each type instead of having one for many types

/*
	we start with the first template from the end
	- we move towards the start of the template
	- if we detect we are not inside of the tag, we need to find the parent element 
		-	if it is a special tag we need to start looking left until we find the closing tag and extract everything in between. We also need to add an attribute inside of the tag
	- if we detect we are inside of a tag, we have to find the start of the tag
		- on the way we see if we are inside of an attribute, else we are in the tag itself
		- if we are inside of an attribute, we remember the closing (quotes or whitespace)
		- if we are inside of a tag, we remember the closing "/>"
	in any case we need to determine the type here and close it in the next part

	we then take the next template and move	to the right
	- we keep looking until we find the closing chars


*/

const determineContext = (state: State) => {
	let templatePartial = state.templates[state.position];
	let index = templatePartial.length;

	state.closingChar = "";
	state.firstLetterChar = -1;
	state.whiteSpaceChar = -1;
	state.equalChar = -1;

	console.log(templatePartial);

	if (!isInsideTag(templatePartial, state.lastBindingType)) {
		//TODO: find the next tag to the left
		//TODO: if it is a style,script,title, textarea return early

		/*
		at this point the special tags can either be in the templatePartial or in the templates
		
		
		*/

		state.templates[
			state.position
		] += `<span data-replace-${state.binding.length}></span>`;
		state.binding.push(state.position);
		state.lastBindingType = BINDING_TYPES.TEXT;
		return;
	}

	while (index > 0) {
		index -= 1;
		const char = templatePartial[index];

		if (isWhitespace(char)) {
			if (state.whiteSpaceChar === -1) {
				state.whiteSpaceChar = index;
			}
			continue;
		}

		//todo: we currently dont handle the new range syntax like 	<style media="(width < 500px)" >

		if (char === "<") {
			if (state.whiteSpaceChar === -1) {
				//tag
				if (templatePartial[index + 1] === "/") {
					//! adding the end tag but not using it later, throws of the indices, so we are not using it here
					state.lastBindingType = BINDING_TYPES.END_TAG;
					state.templates[state.position] =
						templatePartial.slice(0, index + 2) + "div";
					(state.binding[state.openTags.pop()!] as TagBinding).endValues.push(
						state.position
					);
				} else {
					state.lastBindingType = BINDING_TYPES.TAG;
					state.templates[state.position] =
						templatePartial.slice(0, index + 1) +
						`div data-replace-${state.binding.length} `;
					state.openTags.push(state.binding.length);
					const values = [];
					if (templatePartial.slice(index + 1)) {
						values.push(templatePartial.slice(index + 1));
					}
					values.push(state.position);
					state.binding.push({
						values,
						endValues: [],
					});
					state.closingChar = " ";
				}
			} else {
				addAttribute(state, ATTRIBUTE_CASES.BRACKET);
			}
			break;
		}

		if (isQuote(char)) {
			state.closingChar = char;
			state.quoteChar = index;
			continue;
		}

		if (char === "=") {
			state.closingChar ||= " ";
			state.equalChar = index;
			addAttribute(state, ATTRIBUTE_CASES.EQUAL);
			break;
		}

		state.firstLetterChar = index;
	}

	//if the template is only white space, we cant really detect it above, this is the catch
	if (state.firstLetterChar === -1 && state.whiteSpaceChar !== -1) {
		addAttribute(state, ATTRIBUTE_CASES.FALLBACK);
	}
};

const completeBinding = (state: State) => {
	let templatePartial = state.templates[state.position + 1];
	if (
		templatePartial === undefined ||
		state.lastBindingType === BINDING_TYPES.TEXT
	) {
		return;
	}

	//TODO: if this is special binding type, move forwards until we find the end

	let index = -1;
	let firstWhiteSpace = -1;
	let breakSign = state.closingChar || ">";
	let breakIndex = -1;
	const currentBinding = state.binding.at(-1)! as AttrBinding | TagBinding;

	while (index < templatePartial.length - 1) {
		index += 1;
		const char = templatePartial[index];
		if (isWhitespace(char)) {
			if (firstWhiteSpace === -1) {
				firstWhiteSpace = index;
			}
		}

		if (char === breakSign || char === ">") {
			breakIndex = index;

			if (
				char === ">" &&
				templatePartial.slice(index - 2, index + 1) === " />"
			) {
				//if we find a self closable tag, we remove the index we put on the openTags stack
				state.openTags.pop();
			} else {
				//if we break for another char, we still need to check if the tag closes in that snippet and if it does, check if it is a self-closing tag
				const closingTagIndex = templatePartial.indexOf(">", index);
				if (
					closingTagIndex !== -1 &&
					templatePartial.slice(closingTagIndex - 2, closingTagIndex + 1) ===
						" />"
				) {
					state.openTags.pop();
				}
			}

			break;
		}

		if (char === "=") {
			state.equalChar = index;
			const nextChar = templatePartial[index + 1];
			if (isQuote(nextChar)) {
				breakSign = nextChar;
				index += 1;
			} else {
				breakSign = " ";
			}

			continue;
		}
	}

	if (breakIndex === -1 && firstWhiteSpace !== -1 && breakSign === ">") {
		breakIndex = firstWhiteSpace;
	}

	const bindingLocation =
		state.lastBindingType === BINDING_TYPES.ATTR && state.equalChar === -1
			? (currentBinding as AttrBinding).keys
			: currentBinding.values;

	if (breakIndex === -1) {
		if (isQuote(templatePartial[templatePartial.length - 1])) {
			templatePartial = templatePartial.slice(0, -1);
		}
		if (state.equalChar !== -1) {
			if (templatePartial.length === 1) {
				templatePartial = "";
			} else {
				templatePartial =
					templatePartial.slice(0, state.equalChar) +
					templatePartial.slice(state.equalChar + 1);
			}
		}

		if (templatePartial) {
			bindingLocation.push(templatePartial);
		}

		bindingLocation.push(state.position + 1);
		state.templates[state.position + 1] = "";
		state.position += 1;
		return completeBinding(state);
	}

	const remainder = templatePartial.slice(0, breakIndex);

	if (remainder && !isQuote(remainder)) {
		bindingLocation.push(remainder);
	}

	if (isQuote(templatePartial[breakIndex])) {
		breakIndex += 1;
	}

	state.templates[state.position + 1] = templatePartial.slice(breakIndex);
};

const range = new Range();

export const parseTemplate = (strings: TemplateStringsArray): Bindings => {
	const state: State = {
		position: 0,
		binding: [],
		templates: [...strings],
		lastBindingType: BINDING_TYPES.TEXT,
		openTags: [],
		closingChar: "",
		firstLetterChar: -1,
		equalChar: -1,
		whiteSpaceChar: -1,
		quoteChar: -1,
	};

	while (state.position < state.templates.length - 1) {
		determineContext(state);
		completeBinding(state);
		state.position += 1;
	}

	const templateString = state.templates.join("");
	console.log(templateString);

	const result: Bindings = {
		binding: state.binding,
		fragment: range.createContextualFragment(templateString),
		templateHash: stringHash(templateString),
	};

	return result;
};

const htmlCache = new WeakMap<TemplateStringsArray, Bindings>();

export const html = (
	tokens: TemplateStringsArray,
	...dynamicValues: Array<unknown>
): HTMLTemplate => {
	if (!htmlCache.has(tokens)) {
		htmlCache.set(tokens, parseTemplate(tokens));
	}
	return new HTMLTemplate(htmlCache.get(tokens)!, dynamicValues);
};
