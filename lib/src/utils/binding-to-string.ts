export const bindingToString = (
	binding: Array<string | number>,
	expressions: Array<unknown>,
): string => {
	let result = "";

	for (let index = 0; index < binding.length; index++) {
		const key = binding[index];
		result += typeof key === "number" ? String(expressions[key]) : key;
	}

	return result;
};
