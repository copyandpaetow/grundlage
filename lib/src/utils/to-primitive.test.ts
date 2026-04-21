import { describe, expect, test } from "vitest";
import { isStringable, toPrimitive } from "./to-primitive";

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

describe("toPrimitive", () => {
	test("stringifies primitives", () => {
		expect(toPrimitive("a")).toBe("a");
		expect(toPrimitive(42)).toBe("42");
		expect(toPrimitive(true)).toBe("true");
		expect(toPrimitive(false)).toBe("false");
	});

	test("throws on non-stringable values", () => {
		expect(() => toPrimitive({})).toThrow(
			/Expected string, number, or boolean/,
		);
		expect(() => toPrimitive(null)).toThrow();
		expect(() => toPrimitive(undefined)).toThrow();
		expect(() => toPrimitive(() => {})).toThrow();
	});
});
