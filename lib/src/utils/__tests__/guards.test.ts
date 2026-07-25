import { describe, expect, test } from "vitest";
import {
	assertPrimitiveString,
	isGeneratorFunction,
	isStringable,
} from "../guards";

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

describe("assertPrimitiveString", () => {
	test("stringifies primitives", () => {
		expect(assertPrimitiveString("a")).toBe("a");
		expect(assertPrimitiveString(42)).toBe("42");
		expect(assertPrimitiveString(42n)).toBe("42");
		expect(assertPrimitiveString(0n)).toBe("0");
		expect(assertPrimitiveString(true)).toBe("true");
		expect(assertPrimitiveString(false)).toBe("false");
	});

	test("throws on non-stringable values", () => {
		expect(() => assertPrimitiveString({})).toThrow(
			/Expected string, number, bigint, or boolean/,
		);
		expect(() => assertPrimitiveString(null)).toThrow();
		expect(() => assertPrimitiveString(undefined)).toThrow();
		expect(() => assertPrimitiveString(() => {})).toThrow();
	});
});

describe("isGeneratorFunction", () => {
	test("returns true for a sync generator function", () => {
		expect(isGeneratorFunction(function* () {})).toBe(true);
	});

	test("returns true for an async generator function", () => {
		expect(isGeneratorFunction(async function* () {})).toBe(true);
	});

	test("returns false for a plain function", () => {
		expect(isGeneratorFunction(function () {})).toBe(false);
	});

	test("returns false for an arrow function", () => {
		expect(isGeneratorFunction(() => {})).toBe(false);
	});

	test("returns false for an async (non-generator) function", () => {
		expect(isGeneratorFunction(async () => {})).toBe(false);
		expect(isGeneratorFunction(async function () {})).toBe(false);
	});

	test("returns false for a class constructor", () => {
		expect(isGeneratorFunction(class {})).toBe(false);
	});

	test("returns false for a generator instance (not the function)", () => {
		const generatorFunction = function* () {
			yield 1;
		};
		expect(isGeneratorFunction(generatorFunction())).toBe(false);
	});

	test("returns false for non-function primitives", () => {
		expect(isGeneratorFunction(null)).toBe(false);
		expect(isGeneratorFunction(undefined)).toBe(false);
		expect(isGeneratorFunction(0)).toBe(false);
		expect(isGeneratorFunction("function*")).toBe(false);
		expect(isGeneratorFunction(true)).toBe(false);
		expect(isGeneratorFunction({})).toBe(false);
		expect(isGeneratorFunction([])).toBe(false);
	});
});
