import { describe, expect, test } from "vitest";
import { html } from "../parser/html";
import { isComment, isPlainObject, isSameTemplate } from "./validators";

describe("isComment", () => {
	test("returns true for a comment node", () => {
		expect(isComment(document.createComment("x"))).toBe(true);
	});

	test("returns false for an element", () => {
		expect(isComment(document.createElement("div"))).toBe(false);
	});

	test("returns false for a text node", () => {
		expect(isComment(document.createTextNode("x"))).toBe(false);
	});
});

describe("isPlainObject", () => {
	test("accepts plain object literals", () => {
		expect(isPlainObject({})).toBe(true);
		expect(isPlainObject({ a: 1 })).toBe(true);
	});

	test("rejects class instances, arrays, Maps, Sets", () => {
		//renderer uses this to decide whether to iterate keys vs. treat as opaque value
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

describe("isSameTemplate", () => {
	test("true when two templates share the same tagged-template strings", () => {
		const a = html`<p>${"a"}</p>`;
		const b = html`<p>${"b"}</p>`;
		expect(isSameTemplate(a, b)).toBe(true);
	});

	test("false when structure differs", () => {
		const a = html`<p>${"x"}</p>`;
		const b = html`<span>${"x"}</span>`;
		expect(isSameTemplate(a, b)).toBe(false);
	});
});
