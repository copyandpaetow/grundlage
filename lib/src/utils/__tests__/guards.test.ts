import { describe, expect, test } from "vitest";
import { stringifyPrimitive, isStringable } from "../guards";

describe("isStringable", () => {
	test.each([
		["string", "hello"],
		["number", 42],
		["zero", 0],
		["NaN", NaN],
		["bigint", 42n],
		["bigint zero", 0n],
		["boolean true", true],
		["boolean false", false],
	])("accepts %s", (_label, value) => {
		expect(isStringable(value)).toBe(true);
	});

	test.each([
		["null", null],
		["undefined", undefined],
		["object", {}],
		["array", []],
		["function", () => {}],
		["symbol", Symbol("x")],
	])("rejects %s", (_label, value) => {
		expect(isStringable(value)).toBe(false);
	});
});

describe("stringifyPrimitive", () => {
	test("stringifies primitives", () => {
		expect(stringifyPrimitive("a")).toBe("a");
		expect(stringifyPrimitive(42)).toBe("42");
		expect(stringifyPrimitive(42n)).toBe("42");
		expect(stringifyPrimitive(0n)).toBe("0");
		expect(stringifyPrimitive(true)).toBe("true");
		expect(stringifyPrimitive(false)).toBe("false");
	});

	test("throws on non-stringable values", () => {
		expect(() => stringifyPrimitive({})).toThrow(
			/expected a string, number, bigint or boolean/,
		);
		expect(() => stringifyPrimitive(null)).toThrow();
		expect(() => stringifyPrimitive(undefined)).toThrow();
		expect(() => stringifyPrimitive(() => {})).toThrow();
	});
});
