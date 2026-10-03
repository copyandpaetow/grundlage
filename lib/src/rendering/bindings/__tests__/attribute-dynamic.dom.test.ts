import { describe, expect, test } from "vitest";
import { BINDING } from "../../../parser/constants";
import { UNSET_HASH } from "../../constants";
import { commitDynamic } from "../attribute-dynamic";
import { DynamicAttributeLiveBinding } from "../types";

const createSpreadBinding = (): DynamicAttributeLiveBinding => ({
	staticBinding: { type: BINDING.DYNAMIC_ATTRIBUTE, valueIndex: 0 },
	anchor: document.createElement("div"),
	appliedAttributes: new Map(),
	lastValueHash: UNSET_HASH,
});

const attributesAfterCommitting = (...spreadValues: Array<unknown>) => {
	const liveBinding = createSpreadBinding();
	for (const spreadValue of spreadValues)
		commitDynamic(liveBinding, [spreadValue]);
	return liveBinding.anchor
		.getAttributeNames()
		.map((name) => [name, liveBinding.anchor.getAttribute(name)]);
};

describe("spread binding - value shapes", () => {
	test("a non-empty string is a single boolean attribute name", () => {
		expect(attributesAfterCommitting("disabled")).toEqual([["disabled", ""]]);
	});

	test("an empty string yields no attribute — the conditional-boolean idiom", () => {
		//`${cond ? "" : "disabled"}` must produce no attribute in the empty branch,
		//never setAttribute("", "") which throws InvalidCharacterError
		expect(attributesAfterCommitting("")).toEqual([]);
	});

	test("falsy scalars (false, null, undefined, 0) yield no attribute", () => {
		expect(attributesAfterCommitting(false)).toEqual([]);
		expect(attributesAfterCommitting(null)).toEqual([]);
		expect(attributesAfterCommitting(undefined)).toEqual([]);
		expect(attributesAfterCommitting(0)).toEqual([]);
	});

	test("an array of names becomes one boolean attribute each", () => {
		expect(attributesAfterCommitting(["disabled", "hidden"])).toEqual([
			["disabled", ""],
			["hidden", ""],
		]);
	});

	test("a plain object maps names to their values", () => {
		expect(attributesAfterCommitting({ id: "x", tabindex: 0 })).toEqual([
			["id", "x"],
			["tabindex", "0"],
		]);
	});
});

describe("spread binding - across commits", () => {
	test("a name the next value drops comes off the element, the names it keeps stay", () => {
		expect(
			attributesAfterCommitting({ id: "x", title: "t" }, { id: "y" }),
		).toEqual([["id", "y"]]);
	});

	test("a name dropped, then brought back, is written again", () => {
		expect(attributesAfterCommitting({ id: "x" }, {}, { id: "x" })).toEqual([
			["id", "x"],
		]);
	});

	test("a name whose value is unchanged is not written again when another name changes", () => {
		//an object goes to the property mode, which has no read-before-write of its own
		const settings = { theme: "dark" };
		const liveBinding = createSpreadBinding();
		commitDynamic(liveBinding, [{ id: "x", settings }]);
		const { anchor } = liveBinding;
		const writtenNames: Array<string> = [];
		const setAttribute = anchor.setAttribute.bind(anchor);
		const removeAttribute = anchor.removeAttribute.bind(anchor);
		anchor.setAttribute = (name: string, value: string) => {
			writtenNames.push(name);
			setAttribute(name, value);
		};
		anchor.removeAttribute = (name: string) => {
			writtenNames.push(name);
			removeAttribute(name);
		};
		commitDynamic(liveBinding, [{ id: "y", settings }]);
		expect(writtenNames).toEqual(["id"]);
	});

	test("a value switching shape removes the names of the old shape", () => {
		expect(attributesAfterCommitting(["disabled", "hidden"], "hidden")).toEqual(
			[["hidden", ""]],
		);
	});
});
