export const isStringable = (value: unknown) =>
	typeof value === "string" ||
	typeof value === "number" ||
	typeof value === "boolean";

export const assertPrimitiveString = (value: unknown): string => {
	if (typeof value === "string") return value;
	if (typeof value === "number" || typeof value === "boolean")
		return String(value);
	throw new Error(
		`grundlage: Expected string, number, or boolean => got ${typeof value}`,
	);
};

export const isPlainObject = (
	entry: unknown,
): entry is Record<string, unknown> => entry?.constructor === Object;

const generatorFunctionPrototype = Object.getPrototypeOf(function* () {});
const asyncGeneratorFunctionPrototype = Object.getPrototypeOf(
	async function* () {},
);

export const isGeneratorFunction = (value: unknown): boolean => {
	if (typeof value !== "function") return false;
	const prototype = Object.getPrototypeOf(value);
	return (
		prototype === generatorFunctionPrototype ||
		prototype === asyncGeneratorFunctionPrototype
	);
};

export const isServer = (): boolean =>
	typeof window === "undefined" ||
	(globalThis as { __grundlage_ssr__?: boolean }).__grundlage_ssr__ === true;
