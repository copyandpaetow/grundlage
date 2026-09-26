import { ComponentGenerator } from "../types";

export const isStringable = (
	value: unknown,
): value is string | number | bigint | boolean =>
	typeof value === "string" ||
	typeof value === "number" ||
	typeof value === "bigint" ||
	typeof value === "boolean";

export const assertPrimitiveString = (value: unknown): string => {
	if (!isStringable(value))
		throw new Error(
			`grundlage: Expected string, number, bigint, or boolean => got ${typeof value}`,
		);
	return String(value);
};

export const isPlainObject = (
	entry: unknown,
): entry is Record<string, unknown> => entry?.constructor === Object;

const generatorFunctionPrototype = Object.getPrototypeOf(function* () {});
const asyncGeneratorFunctionPrototype = Object.getPrototypeOf(
	async function* () {},
);

//a generator function's props signature is unknowable at runtime, so the narrowing is wider than the
//check: any generator function reads as a ComponentGenerator
export const isGeneratorFunction = (
	value: unknown,
): value is ComponentGenerator => {
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
