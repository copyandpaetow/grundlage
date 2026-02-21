import { toPrimitive } from "./to-primitive";

export const bindingToString = (
	binding: Array<string | number>,
	expressions: Array<unknown>,
): string => {
	let result = "";

	for (const key of binding) {
		result += typeof key === "number" ? toPrimitive(expressions[key]) : key;
	}

	return result;
};
