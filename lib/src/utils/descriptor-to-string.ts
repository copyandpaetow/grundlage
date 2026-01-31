import { toPrimitive } from "./to-primitve";

export const descriptorToString = (
	descriptor: Array<string | number>,
	expressions: Array<unknown>,
): string => {
	let result = "";

	for (const key of descriptor) {
		result += typeof key === "number" ? toPrimitive(expressions[key]) : key;
	}

	return result;
};
