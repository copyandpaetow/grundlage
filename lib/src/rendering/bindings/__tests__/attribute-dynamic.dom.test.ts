import { describe, expect, test } from "vitest";
import { normalizeToAttributeMap } from "../attribute-dynamic";

describe("normalizeToAttributeMap - scalar bare value", () => {
	test("a non-empty string is a single boolean attribute name", () => {
		expect([...normalizeToAttributeMap("disabled")]).toEqual([
			["disabled", ""],
		]);
	});

	test("an empty string yields no attribute — the conditional-boolean idiom", () => {
		//`${cond ? "" : "disabled"}` must produce no attribute in the empty branch,
		//never setAttribute("", "") which throws InvalidCharacterError
		expect(normalizeToAttributeMap("").size).toBe(0);
	});

	test("falsy scalars (false, null, undefined, 0) yield no attribute", () => {
		expect(normalizeToAttributeMap(false).size).toBe(0);
		expect(normalizeToAttributeMap(null).size).toBe(0);
		expect(normalizeToAttributeMap(undefined).size).toBe(0);
		expect(normalizeToAttributeMap(0).size).toBe(0);
	});

	test("an array of names becomes one boolean attribute each", () => {
		expect([...normalizeToAttributeMap(["disabled", "hidden"])]).toEqual([
			["disabled", ""],
			["hidden", ""],
		]);
	});

	test("a plain object maps names to their values", () => {
		expect([...normalizeToAttributeMap({ id: "x", tabindex: 0 })]).toEqual([
			["id", "x"],
			["tabindex", 0],
		]);
	});
});
