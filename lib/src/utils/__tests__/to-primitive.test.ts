import { describe, expect, test } from "vitest";
import { assertPrimitiveString, isStringable } from "../to-primitive";

describe("isStringable", () => {
	test.each([
		["string", "hello"],
		["number", 42],
		["zero", 0],
		["NaN", NaN],
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

describe("assertPrimitiveString", () => {
	test("stringifies primitives", () => {
		expect(assertPrimitiveString("a")).toBe("a");
		expect(assertPrimitiveString(42)).toBe("42");
		expect(assertPrimitiveString(true)).toBe("true");
		expect(assertPrimitiveString(false)).toBe("false");
	});

	test("throws on non-stringable values", () => {
		expect(() => assertPrimitiveString({})).toThrow(
			/Expected string, number, or boolean/,
		);
		expect(() => assertPrimitiveString(null)).toThrow();
		expect(() => assertPrimitiveString(undefined)).toThrow();
		expect(() => assertPrimitiveString(() => {})).toThrow();
	});
});
