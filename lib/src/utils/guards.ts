import { libraryMessage } from "./diagnostics";

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
			libraryMessage(
				`expected a string, number, bigint or boolean, got ${typeof value}. Pass String(value) or one of its fields.`,
			),
		);
	return String(value);
};

export const isPlainObject = (
	entry: unknown,
): entry is Record<string, unknown> => entry?.constructor === Object;

export const isServer = (): boolean =>
	typeof window === "undefined" ||
	(globalThis as { __grundlage_ssr__?: boolean }).__grundlage_ssr__ === true;
