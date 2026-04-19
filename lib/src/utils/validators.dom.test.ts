import {describe, expect, test} from "vitest";
import {html} from "../parser/html";
import {isComment, isObject, isSameTemplate} from "./validators";

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

describe("isObject", () => {
    test("accepts plain object literals", () => {
        expect(isObject({})).toBe(true);
        expect(isObject({a: 1})).toBe(true);
    });

    test("rejects class instances, arrays, Maps, Sets", () => {
        //renderer uses this to decide whether to iterate keys vs. treat as opaque value
        class Foo {}
        expect(isObject(new Foo())).toBe(false);
        expect(isObject([])).toBe(false);
        expect(isObject(new Map())).toBe(false);
        expect(isObject(new Set())).toBe(false);
    });

    test("rejects null and undefined without throwing", () => {
        expect(isObject(null)).toBe(false);
        expect(isObject(undefined)).toBe(false);
    });

    test("rejects primitives", () => {
        expect(isObject("string")).toBe(false);
        expect(isObject(42)).toBe(false);
        expect(isObject(true)).toBe(false);
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
