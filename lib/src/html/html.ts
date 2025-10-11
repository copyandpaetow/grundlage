type BindingTypes = "ATTR" | "TAG" | "TEXT" | "END_TAG" | "BOOLEAN_ATTR";

type AttrBinding = {
	values: Array<number | string>;
	keys: Array<number | string>;
};

type ContentBinding = number;

type TagBinding = {
	values: Array<number | string>;
};

type State = {
	position: number;
	closingChar: string;
	attrBinding: Array<AttrBinding>;
	tagBinding: Array<TagBinding>;
	contentBinding: Array<ContentBinding>;
	templates: Array<string>;
	lastBindingType: BindingTypes;
	foundLetters: boolean;
};

type Bindings = {
	attrBinding: Array<AttrBinding>;
	tagBinding: Array<TagBinding>;
	contentBinding: Array<ContentBinding>;
	fragment: DocumentFragment;
};

export type TemplateResult = Bindings & {
	__type__: "template";
	dynamicValues: Array<unknown>;
};

export type MixedArray = Array<string | number>;

const isWhitespace = (char: string) => {
	return (
		char === " " ||
		char === "\t" ||
		char === "\n" ||
		char === "\r" ||
		char === "\f"
	);
};

const isInsideTag = (stringSegment: string, lastType: BindingTypes) => {
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

	return lastType !== "TEXT";
};

const determineContext = (state: State) => {
	let templatePartial = state.templates[state.position];
	let index = templatePartial.length;
	let whitespaceStart = -1;

	state.closingChar = "";
	state.foundLetters = false;

	if (!isInsideTag(templatePartial, state.lastBindingType)) {
		state.templates[
			state.position
		] += `<span data-content-replace-${state.contentBinding.length}></span>`;
		state.contentBinding.push(state.position);
		state.lastBindingType = "TEXT";
		return;
	}

	while (index > 0) {
		index -= 1;
		const char = templatePartial[index];

		if (isWhitespace(char)) {
			if (whitespaceStart === -1) {
				whitespaceStart = index;
			}
			continue;
		}

		if (char === "<") {
			if (whitespaceStart !== -1) {
				//attribute

				state.lastBindingType = "ATTR";
				state.templates[state.position] =
					templatePartial.slice(0, whitespaceStart) +
					` data-attr-replace-${state.attrBinding.length} `;
				state.attrBinding.push({
					values: [templatePartial.slice(whitespaceStart + 1), state.position],
					keys: [],
				});
			} else {
				//tag
				if (templatePartial[index + 1] === "/") {
					//! adding the end tag but not using it later, throws of the indices, so we are not using it here
					state.lastBindingType = "END_TAG";
					state.templates[state.position] =
						templatePartial.slice(0, index + 2) + "div";
				} else {
					state.lastBindingType = "TAG";
					state.templates[state.position] =
						templatePartial.slice(0, index + 1) +
						`div data-tag-replace-${state.tagBinding.length} `;
					state.tagBinding.push({
						values: [templatePartial.slice(index + 1), state.position],
					});
				}
			}
			break;
		}

		state.foundLetters = true;

		if (char === "=" || char === '"' || char === "'") {
			if (char === "=") {
				if (
					templatePartial[index + 1] === "'" ||
					templatePartial[index + 1] === '"'
				) {
					state.closingChar = templatePartial[index + 1];
				}
			} else {
				state.closingChar = char;
			}

			const nextWhitespace = templatePartial.lastIndexOf(" ", index);
			//we need to remove the quote at this point otherwise it will make the attribute creation difficult later on
			templatePartial =
				templatePartial.slice(0, index) + templatePartial.slice(index + 1);

			state.lastBindingType = "ATTR";
			state.templates[state.position] =
				templatePartial.slice(0, nextWhitespace) +
				` data-attr-replace-${state.attrBinding.length} `;
			state.attrBinding.push({
				values: [templatePartial.slice(nextWhitespace + 1), state.position],
				keys: [],
			});

			//if needed, if the attribute has no whitespaces, its a complex attribute with more than one hole
			break;
		}
	}

	//if the template is only white space, we cant really detect it above, this is the catch
	if (!state.foundLetters && whitespaceStart > -1) {
		state.lastBindingType = "ATTR";
		state.templates[
			state.position
		] = ` data-attr-replace-${state.attrBinding.length} `;
		state.attrBinding.push({
			values: [state.position],
			keys: [],
		});
	}

	return;
};

const completeBinding = (state: State) => {
	const templatePartial = state.templates[state.position + 1];
	if (templatePartial === undefined || state.lastBindingType === "TEXT") {
		return;
	}

	let index = -1;
	let firstWhiteSpace = -1;
	let breakSign = state.closingChar || ">";
	let breakIndex = -1;
	const currentBinding = (
		state.lastBindingType === "TAG" || state.lastBindingType === "END_TAG"
			? state.tagBinding
			: state.attrBinding
	).at(-1)!;

	while (index < templatePartial.length - 1) {
		index += 1;
		const char = templatePartial[index];
		if (isWhitespace(char)) {
			if (firstWhiteSpace === -1) {
				firstWhiteSpace = index;
			}
			continue;
		}

		if (char === breakSign) {
			breakIndex = index;
			break;
		}

		if (char === "=") {
			const nextChar = templatePartial[index + 1];
			if (nextChar === "'" || nextChar === '"') {
				breakSign = nextChar;
				index += 1;
				continue;
			}
		}
	}

	if (breakIndex === -1 && firstWhiteSpace !== -1 && breakSign === ">") {
		breakIndex = firstWhiteSpace;
	}

	if (breakIndex === -1) {
		currentBinding.values.push(templatePartial, state.position + 1);
		state.templates[state.position + 1] = "";
		state.position += 1;
		return completeBinding(state);
	}

	state.templates[state.position + 1] = templatePartial.slice(breakIndex);
	currentBinding.values.push(templatePartial.slice(0, breakIndex));
};

const range = new Range();

export const parseTemplate = (strings: TemplateStringsArray): Bindings => {
	const state: State = {
		position: 0,
		attrBinding: [],
		tagBinding: [],
		contentBinding: [],
		templates: [...strings],
		closingChar: "",
		lastBindingType: "TEXT",
		foundLetters: false,
	};

	while (state.position < state.templates.length - 1) {
		determineContext(state);
		completeBinding(state);
		state.position += 1;
	}

	//[data-, 0, =', 1, ']

	for (let index = 0; index < state.attrBinding.length; index++) {
		const attribute = state.attrBinding[index]!;

		for (
			let valueIndex = 0;
			valueIndex < attribute.values.length;
			valueIndex++
		) {
			const value = attribute.values[valueIndex];

			if (typeof value === "number") {
				attribute.keys.push(attribute.values.splice(valueIndex, 1)[0]);
				valueIndex--;
				continue;
			}

			const includesEqualSign = value.indexOf("=");
			if (includesEqualSign === -1) {
				attribute.keys.push(attribute.values.splice(valueIndex, 1)[0]);
				valueIndex--;
				continue;
			}
			const start = value.slice(0, includesEqualSign);
			const end = value.slice(includesEqualSign + 1);

			if (start) {
				attribute.keys.push(start);
			}
			if (end) {
				attribute.values[valueIndex] = end;
			} else {
				attribute.values.splice(valueIndex, 1);
			}
			break;
		}
	}

	const templateString = state.templates.join("");

	const result: Bindings = {
		contentBinding: state.contentBinding,
		attrBinding: state.attrBinding,
		tagBinding: state.tagBinding,
		fragment: range.createContextualFragment(templateString),
	};

	return result;
};

const htmlCache = new WeakMap<TemplateStringsArray, Bindings>();

export const html = (
	tokens: TemplateStringsArray,
	...dynamicValues: Array<unknown>
): TemplateResult => {
	if (!htmlCache.has(tokens)) {
		htmlCache.set(tokens, parseTemplate(tokens));
	}

	const cachedResult = htmlCache.get(tokens)!;

	return {
		__type__: "template",
		dynamicValues,
		fragment: cachedResult.fragment,
		contentBinding: cachedResult.contentBinding,
		tagBinding: cachedResult.tagBinding,
		attrBinding: cachedResult.attrBinding,
	};
};
