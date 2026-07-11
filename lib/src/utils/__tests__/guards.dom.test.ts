import { describe, expect, test } from "vitest";
import { isPlainObject } from "../guards";

describe("isPlainObject", () => {
	test("accepts plain object literals", () => {
		expect(isPlainObject({})).toBe(true);
		expect(isPlainObject({ a: 1 })).toBe(true);
	});

	test("rejects class instances, arrays, Maps, Sets", () => {
		class Foo {}
		expect(isPlainObject(new Foo())).toBe(false);
		expect(isPlainObject([])).toBe(false);
		expect(isPlainObject(new Map())).toBe(false);
		expect(isPlainObject(new Set())).toBe(false);
	});

	test("rejects null and undefined without throwing", () => {
		expect(isPlainObject(null)).toBe(false);
		expect(isPlainObject(undefined)).toBe(false);
	});

	test("rejects primitives", () => {
		expect(isPlainObject("string")).toBe(false);
		expect(isPlainObject(42)).toBe(false);
		expect(isPlainObject(true)).toBe(false);
	});
});
