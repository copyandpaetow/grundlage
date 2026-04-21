export const isStringable = (value: unknown) =>
	typeof value === "string" ||
	typeof value === "number" ||
	typeof value === "boolean";

export const assertPrimitiveString = (value: unknown): string => {
	if (typeof value === "string") return value;
	if (typeof value === "number" || typeof value === "boolean")
		return String(value);
	throw new Error(`Expected string, number, or boolean => got ${typeof value}`);
};
