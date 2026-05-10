import { describe, expect, test } from "vitest";
import { isGeneratorFunction } from "./is-generator";

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
