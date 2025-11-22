import { State, AttrBinding } from "../parser-html";

export const ATTRIBUTE_CASES = {
	BRACKET: 1,
	EQUAL: 2,
	FALLBACK: 0,
} as const;

export const addAttribute = (state: State, attributeCase: number) => {
	const result: AttrBinding = {
		keys: [],
		values: [],
	};

	let templatePartial = state.templates[state.position];
	let templateStart = 0;
	let templateEnd = state.whiteSpaceChar;
	state.lastBindingType = "ATTR";

	switch (attributeCase) {
		case ATTRIBUTE_CASES.BRACKET:
			//we reached a <

			const partialTemplate = templatePartial.slice(state.whiteSpaceChar + 1);
			if (partialTemplate) {
				result.keys.push(partialTemplate);
			}
			result.keys.push(state.position);
			break;

		case ATTRIBUTE_CASES.EQUAL:
			//we reached a =

			templateEnd = templatePartial.lastIndexOf(" ", state.equalChar);
			const templateFromAttributeStart = templatePartial.slice(
				templateEnd,
				state.equalChar
			);
			const valueStart =
				state.quoteChar === -1 ? state.equalChar : state.quoteChar;
			const templateTillCurrentAttributeEnd = templatePartial.slice(
				valueStart + 1
			);

			if (templateFromAttributeStart) {
				result.keys.push(templateFromAttributeStart);
			}
			if (templateTillCurrentAttributeEnd) {
				result.values.push(templateTillCurrentAttributeEnd);
			}
			result.values.push(state.position);
			break;

		case ATTRIBUTE_CASES.FALLBACK:
			// only whitespace
			result.keys.push(state.position);
			break;

		default:
			break;
	}

	state.templates[state.position] =
		templatePartial.slice(templateStart, templateEnd) +
		` data-replace-${state.binding.length} `;
	state.binding.push(result);
};
