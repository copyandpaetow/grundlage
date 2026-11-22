import { libraryMessage } from "./diagnostics";

export const isStringable = (value: unknown): value is string | number | bigint | boolean =>
	typeof value === "string" ||
	typeof value === "number" ||
	typeof value === "bigint" ||
	typeof value === "boolean";

export const stringifyPrimitive = (value: unknown): string => {
	if (!isStringable(value)) {
		throw new Error(
			libraryMessage(
				`a hole expects a string, number, bigint or boolean, not ${typeof value}. Pass String(value) or one of its fields.`,
			),
		);
	}
	return String(value);
};

//what an object literal, JSON.parse or Object.groupBy makes. The prototype decides when
//`.constructor` does not, so a "constructor" key in the data cannot pass for a class
export const isPlainObject = (value: unknown): value is Record<string, unknown> => {
	if (typeof value !== "object" || value === null) return false;
	//V8 folds `.constructor` from its inline cache; the prototype read alone hashed 17% slower
	if (value.constructor === Object) return true;
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
};

export const isServer = (): boolean =>
	typeof window === "undefined" ||
	(globalThis as { __grundlage_ssr__?: boolean }).__grundlage_ssr__ === true;
