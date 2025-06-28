import {
	createStub,
	isNestedRender,
	isNestedStyleRender,
	isStatic,
	mergeMaps,
	ParsingState,
	renderKey,
	sliceLastAttributeName,
} from "./helper";
import { Binding, parseTemplate } from "./parser";

const markElement = (result: ParsingResult) => {
	const template = result.template;
	const lastOpeningBracket = template.lastIndexOf("<");

	if (template.indexOf(" data-update ", lastOpeningBracket) !== -1) {
		return;
	}

	const endOfElementTag = template.indexOf(" ", lastOpeningBracket);
	const untilAttributesStart = template.slice(0, endOfElementTag);
	const afterAttributesStart = template.slice(endOfElementTag + 1);

	result.template = `${untilAttributesStart} data-update ${afterAttributesStart}`;
};

const expandAttributes = (
	value: unknown,
	result: ParsingResult,
	parsingState: ParsingState
): string => {
	if (result.template[parsingState.lastAttributeStart] === ".") {
		const name = sliceLastAttributeName(result, parsingState);
		result.properties.set(name, value);
		return "";
	}

	if (value === null || value === undefined) {
		sliceLastAttributeName(result, parsingState);
		return "";
	}

	if (isStatic(value)) {
		return String(value);
	}

	if (isNestedStyleRender(value)) {
		mergeMaps(value.values, result.values);
		result.values.set(value.name, value.template);
		return value.name;
	}

	if (Array.isArray(value) || value instanceof Set) {
		return `"${Array.from(value)
			.map((value) => expandAttributes(value, result, parsingState))
			.join(" ")}"`;
	}

	//TODO: nested objects are not handled right
	if (value && typeof value === "object") {
		const iterator =
			value instanceof Map ? Array.from(value) : Object.entries(value);
		return iterator
			.map(([key, nestedValue]) => {
				const expandedValue = expandAttributes(
					nestedValue,
					result,
					parsingState
				);
				return expandedValue ? `${key}=${expandedValue}` : "";
			})
			.join(" ");
	}

	markElement(result);
	const stub = createStub();
	result.values.set(stub, value);
	return stub;
};

const expandContent = (value: unknown, result: ParsingResult): string => {
	if (isStatic(value)) {
		return String(value);
	}

	if (isNestedRender(value)) {
		mergeMaps(value.values, result.values);
		return value.template;
	}

	if (isNestedStyleRender(value)) {
		mergeMaps(value.values, result.values);
		result.values.set(value.name, value.template);
		return `<style ${Array.from(value.values.keys()).join(" ")}>${
			value.template
		}</style>`;
	}

	const stub = createStub();
	result.values.set(stub, value);
	return `<span data-replace=${stub}></span>`;
};

export type ParsingResult = {
	template: string;
	fragment: DocumentFragment;
	bindings: Array<FilledBinding>;
};

const FRAGMENT_TYPE = {
	INIT: -1,
	TAG: 0,
	ATTRIBUTE_NAME: 2,
	ATTRIBUTE_VALUE: 3,
	CONTENT: 4,
} as const;

export type FilledBinding = {
	template: Array<string>;
	indices: Array<unknown>;
	type: "ATTR" | "TAG" | "TEXT" | "END_TAG";
	closingChar: string;
};

type ParsedTemplate = {
	bindings: Binding[];
	template: string;
	fragment: DocumentFragment;
};

const htmlCache = new WeakMap<TemplateStringsArray, ParsedTemplate>();

export const html = (
	tokens: TemplateStringsArray,
	...dynamicValues: Array<unknown>
): ParsingResult => {
	if (!htmlCache.has(tokens)) {
		htmlCache.set(tokens, parseTemplate(tokens));
	}

	const { template, bindings, fragment } = htmlCache.get(tokens)!;

	const filledBindings: Array<FilledBinding> = bindings.map((binding) => ({
		...binding,
		indices: binding.indices.map((index) => dynamicValues[index]),
	}));

	console.log(filledBindings);

	const result: ParsingResult = {
		template,
		fragment: fragment.cloneNode(true) as DocumentFragment,
		bindings: filledBindings,
	};

	return result;
};

const test = 123;
const tag = "custom";
const tag2 = "section";
const className = "hello";

//html`<${tag}>headline?</${tag}>`;
//html`<${tag} class="${className}">hallo</${tag}>`;
//html`<${tag} class="test ${className}">${test}</${tag}>`;

//html`<${tag}-${tag2} ${tag}-${tag2}="test ${className}"></${tag}-${tag2}>`;
html`<div data-test="hello ${className}">hello</div>`;
