import { describe, expect, test } from "vitest";
import { bindingToString } from "../binding-to-string";

describe("bindingToString", () => {
	test("emits static string parts verbatim", () => {
		expect(bindingToString(["foo-", "bar"], [])).toBe("foo-bar");
	});

	test("replaces numeric entries with expression at that index", () => {
		expect(bindingToString([0, "-", 1], ["a", "b"])).toBe("a-b");
	});

	test("coerces non-string expressions via String()", () => {
		expect(bindingToString([0, ":", 1], [42, true])).toBe("42:true");
	});

	test("returns empty string for empty binding", () => {
		expect(bindingToString([], ["unused"])).toBe("");
	});

	test("stringifies null and undefined", () => {
		//used to build attribute values; the caller decides whether to set or remove
		expect(bindingToString([0, "/", 1], [null, undefined])).toBe(
			"null/undefined",
		);
	});

	test("interleaves repeated references to the same expression", () => {
		expect(bindingToString([0, "-", 0], ["x"])).toBe("x-x");
	});
});
