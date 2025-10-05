import { computeHash, stringHash } from "./hashing";

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
	bindings: Array<BindingResult>;
	template: string;
	fragment: DocumentFragment;
	hash: number;
};

export type BindingResult = {
	value: Array<unknown>;
	key: Array<unknown>;
	type: "ATTR" | "TEXT" | "TAG";
	hash: number;
};

export type Result = {
	bindings: Array<BindingResult>;
	fragment: DocumentFragment;
	text: string;
};

export type MixedArray = Array<string | number>;

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
		] += `<span data-replace-${state.bindings.length}></span>`;
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
					` data-replace-${state.bindings.length} `;
			} else {
				//tag
				if (templatePartial[index + 1] === "/") {
					//! adding the end tag but not using it later, throws of the indices, so we are not using it here
					// binding.template.push(templatePartial.slice(index + 2));
					binding.type = "END_TAG";
					state.templates[state.position] =
						templatePartial.slice(0, index + 2) + "div";
				} else {
					binding.type = "TAG";
					binding.template.push(templatePartial.slice(index + 1));
					state.templates[state.position] =
						templatePartial.slice(0, index + 1) +
						`div data-replace-${state.bindings.length} `;
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
					` data-replace-${state.bindings.length} `;
			} else {
				//attr
				//TODO: why are these identical?
				binding.template.push(templatePartial.slice(nextWhitespace + 1));
				state.templates[state.position] =
					templatePartial.slice(0, nextWhitespace) +
					` data-replace-${state.bindings.length} `;
			}
			break;
		}

		foundLetters = true;
	}

	//if the template is only white space, we cant really detect it above, this is the catch
	if (binding.type === "TEXT") {
		binding.type = "ATTR";
		binding.template.push("");
		state.templates[state.position] = ` data-replace-${state.bindings.length} `;
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
const emptArray: MixedArray = [];

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
		if (binding.type !== "END_TAG") {
			state.bindings.push(binding);
		}
		state.position += 1;
	}

	const templateString = state.templates.join("");
	const updatedBindings: Array<BindingResult> = [];

	for (const { template, indices, type } of bindings) {
		switch (type) {
			case "TAG":
				updatedBindings.push({
					key: emptArray,
					value: template
						.flatMap((token, tokenIndex) => [token, indices[tokenIndex]])
						.filter(filterEmpty),
					type,
					hash: -1,
				});
				break;

			case "TEXT":
				updatedBindings.push({
					key: emptArray,
					value: indices,
					type,
					hash: -1,
				});
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
				updatedBindings.push({
					key: keys.filter(filterEmpty),
					value: values.filter(filterEmpty),
					type: "ATTR",
					hash: -1,
				});
		}
	}

	const result: UpdatedBindings = {
		bindings: updatedBindings,
		template: templateString,
		fragment: range.createContextualFragment(templateString),
		hash: stringHash(templateString),
	};

	return result;
};

export class TemplateResult {
	#fragment: DocumentFragment;
	bindings: BindingResult[];
	hash: number;
	constructor(
		fragment: DocumentFragment,
		bindings: Array<BindingResult>,
		hash: number
	) {
		this.#fragment = fragment;
		this.bindings = bindings;
		this.hash = hash;
	}

	get fragment() {
		return this.#fragment.cloneNode(true) as DocumentFragment;
	}
}

const setDynamicValues = (
	dynamicValues: Array<unknown>,
	entry: Array<Number> | MixedArray
): Array<unknown> =>
	entry.map((item) => (typeof item === "number" ? dynamicValues[item] : item));

const htmlCache = new WeakMap<TemplateStringsArray, UpdatedBindings>();

export const html = (
	tokens: TemplateStringsArray,
	...dynamicValues: Array<unknown>
): TemplateResult => {
	if (!htmlCache.has(tokens)) {
		htmlCache.set(tokens, parseTemplate(tokens));
	}

	const { fragment, bindings, hash } = htmlCache.get(tokens)!;

	const withActualValues = bindings.map((entry) => {
		const updatedKeys = setDynamicValues(
			dynamicValues,
			(entry.type === "ATTR" ? entry.key : []) as MixedArray
		);
		const updatedValues = setDynamicValues(
			dynamicValues,
			entry.value as MixedArray
		);

		return {
			...entry,
			value: updatedValues,
			key: updatedKeys,
			hash: computeHash(hash, updatedKeys, updatedValues),
		};
	});

	const resultHash = withActualValues.reduce(
		(accumulator, current) => accumulator + current.hash,
		hash
	);

	return new TemplateResult(fragment, withActualValues, resultHash);
};
