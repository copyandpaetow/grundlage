export const isStringable = (value: unknown) =>
	typeof value === "string" ||
	typeof value === "number" ||
	typeof value === "boolean";

export const toPrimitive = (value: unknown): string => {
	if (isStringable(value)) return String(value);
	throw new Error(`Expected string, number, or boolean => got ${typeof value}`);
};
