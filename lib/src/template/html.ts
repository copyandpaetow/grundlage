/*
type CssResult = {
  className: string,    // "css-abc123" 
  styleSheet: string,   // ":host { padding: 10px; } .css-abc123 { color: red; }"
  toString(): string    // returns className for template usage
}
*/

export type Binding = {
	template: Array<string>;
	indices: Array<number>;
	type: "ATTR" | "TAG" | "TEXT" | "END_TAG" | "BOOLEAN_ATTR";
	closingChar: string;
};

type State = {
	position: number;
	bindings: Array<Binding>;
	templates: Array<string>;
};

type UpdatedBindings = {
	attributes: AttrBinding[];
	texts: TextBinding[];
	tags: TagBinding[];
	template: string;
	fragment: DocumentFragment;
};

export type Result = UpdatedBindings & { dynamicValues: Array<unknown> };

type AttrBinding = {
	value: MixedArray;
	key: MixedArray;
	id: number;
};

type TextBinding = {
	value: number[];
	id: number;
};

type TagBinding = {
	value: MixedArray;
	id: number;
};

type MixedArray = Array<string | number>;

const filterEmpty = (item: unknown) => item === 0 || Boolean(item);

const isWhitespace = (char: string) => {
	return (
		char === " " ||
		char === "\t" ||
		char === "\n" ||
		char === "\r" ||
		char === "\f"
	);
};

const isInsideTag = (stringSegment: string, lastType?: Binding["type"]) => {
	let index = stringSegment.length - 1;

	while (index >= 0) {
		const char = stringSegment[index];

		if (char === ">") {
			if (index >= 2 && stringSegment.slice(index - 2, index + 1) === "-->") {
				index -= 3;
				continue;
			}
			return false;
		}
		if (char === "<") {
			if (
				index + 3 < stringSegment.length &&
				stringSegment.slice(index, index + 4) === "<!--"
			) {
				index -= 1;
				continue;
			}
			return true;
		}
		index--;
	}

	if (!lastType || lastType === "TEXT") {
		return false;
	}

	return true;
};

const determineContext = (state: State): Binding => {
	const templatePartial = state.templates[state.position];

	const binding: Binding = {
		type: "TEXT",
		template: [],
		indices: [state.position],
		closingChar: "",
	};

	if (!isInsideTag(templatePartial, state.bindings.at(-1)?.type)) {
		state.templates[
			state.position
		] += `<span data-replace="${state.bindings.length}"></span>`;
		binding.template.push("");
		return binding;
	}

	let index = templatePartial.length;
	let whitespaceStart = -1;
	let foundLetters = false;

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
				//* if letters where found this is a boolean attribute. Not sure if needed or not
				binding.type = foundLetters ? "BOOLEAN_ATTR" : "ATTR";
				binding.template.push(templatePartial.slice(whitespaceStart + 1));

				state.templates[state.position] =
					templatePartial.slice(0, whitespaceStart) +
					` data-replace="${state.bindings.length}" `;
			} else {
				//tag
				if (templatePartial[index + 1] === "/") {
					binding.type = "END_TAG";
					binding.template.push(templatePartial.slice(index + 2));
					state.templates[state.position] =
						templatePartial.slice(0, index + 2) + "div";
				} else {
					binding.type = "TAG";
					binding.template.push(templatePartial.slice(index + 1));
					state.templates[state.position] =
						templatePartial.slice(0, index + 1) +
						`div data-replace="${state.bindings.length}" `;
				}
			}
			break;
		}

		if (char === "=" || char === '"' || char === "'") {
			if (char === "=") {
				if (
					templatePartial[index + 1] === "'" ||
					templatePartial[index + 1] === '"'
				) {
					binding.closingChar = templatePartial[index + 1];
				}
			} else {
				binding.closingChar = char;
			}

			const nextWhitespace = templatePartial.lastIndexOf(" ", index);

			binding.type = "ATTR";
			if (whitespaceStart !== -1) {
				//complex attr
				binding.template.push(templatePartial.slice(nextWhitespace + 1));

				state.templates[state.position] =
					templatePartial.slice(0, nextWhitespace) +
					` data-replace="${state.bindings.length}" `;
			} else {
				//attr
				binding.template.push(templatePartial.slice(nextWhitespace + 1));
				state.templates[state.position] =
					templatePartial.slice(0, nextWhitespace) +
					` data-replace="${state.bindings.length}" `;
			}
			break;
		}

		foundLetters = true;
	}

	//if the template is only white space, we cant really detect it above, this is the catch
	if (binding.type === "TEXT") {
		binding.type = "ATTR";
		binding.template.push("");
		state.templates[
			state.position
		] = ` data-replace="${state.bindings.length}" `;
	}

	return binding;
};

const completeBinding = (binding: Binding, state: State) => {
	const templatePartial = state.templates[state.position + 1];
	if (templatePartial === undefined) {
		return;
	}

	if (binding.type === "TEXT") {
		binding.template.push("");
		return;
	}

	let index = -1;
	let firstWhiteSpace = -1;
	let breakSign = binding.closingChar || ">";
	let breakIndex = -1;

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
		binding.template.push(templatePartial);
		binding.indices.push(state.position + 1);
		state.templates[state.position + 1] = "";
		state.position += 1;
		return completeBinding(binding, state);
	}

	state.templates[state.position + 1] = templatePartial.slice(breakIndex);
	binding.template.push(templatePartial.slice(0, breakIndex));
};

const range = new Range();

export const parseTemplate = (strings: TemplateStringsArray) => {
	const bindings: Array<Binding> = [];

	const state: State = {
		position: 0,
		bindings: bindings,
		templates: [...strings],
	};

	while (state.position < state.templates.length - 1) {
		const binding = determineContext(state);
		completeBinding(binding, state);
		state.bindings.push(binding);
		state.position += 1;
	}

	const templateString = state.templates.join("");

	const updatedBindings: UpdatedBindings = {
		attributes: [],
		texts: [],
		tags: [],
		template: templateString,
		fragment: range.createContextualFragment(templateString),
	};

	//TODO: this could use a clean up... Maybe we dont even need to store this in one array and convert it into several afterwards but start with many
	bindings.forEach(({ template, indices, type }, index) => {
		switch (type) {
			case "TAG":
				updatedBindings.tags.push({
					value: template
						.flatMap((token, tokenIndex) => [token, indices[tokenIndex]])
						.filter(filterEmpty),
					id: index,
				});
				break;
			case "TEXT":
				updatedBindings.texts.push({ value: indices, id: index });
				break;
			case "BOOLEAN_ATTR":
			case "ATTR":
				const keys: MixedArray = [];
				const values: MixedArray = [];

				template.forEach((token, templateIndex) => {
					if (token.includes("=")) {
						const [currentKey, currentValue] = token.split("=");
						keys.push(currentKey);
						values.push(currentValue, indices[templateIndex]);
						return;
					}
					(values.length ? values : keys).push(token, indices[templateIndex]);
				});
				updatedBindings.attributes.push({
					value: values.filter(filterEmpty),
					key: keys.filter(filterEmpty),
					id: index,
				});
				break;

			default:
				break;
		}
	});

	return updatedBindings;
};

const htmlCache = new WeakMap<TemplateStringsArray, UpdatedBindings>();

export const html = (
	tokens: TemplateStringsArray,
	...dynamicValues: Array<unknown>
): Result => {
	if (!htmlCache.has(tokens)) {
		htmlCache.set(tokens, parseTemplate(tokens));
	}

	const { template, fragment, tags, texts, attributes } =
		htmlCache.get(tokens)!;

	return {
		template,
		fragment: fragment.cloneNode(true) as DocumentFragment,
		tags,
		texts,
		attributes,
		dynamicValues,
	};
};
