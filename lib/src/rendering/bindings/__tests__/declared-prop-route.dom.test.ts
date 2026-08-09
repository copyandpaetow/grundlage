import { describe, expect, test, vi } from "vitest";
import { component } from "../../../index";
import {
	assignDeclaredProp,
	isAwaitingDefinition,
	isDeclaredPropName,
	reapplyOnSwap as reapplySingleValueOnSwap,
} from "../attribute-single-value";
import {
	applyDynamicAttribute,
	reapplyOnSwap as reapplyDynamicOnSwap,
} from "../attribute-dynamic";
import { reapplyOnSwap as reapplyNamedDynamicOnSwap } from "../attribute-named-dynamic";

const record = (element: Element): Record<string, unknown> =>
	element as unknown as Record<string, unknown>;

describe("isDeclaredPropName", () => {
	test("a tag without a dash declares nothing", () => {
		expect(isDeclaredPropName(document.createElement("div"), "tags")).toBe(
			false,
		);
	});

	test("an unregistered dashed tag declares nothing yet", () => {
		const element = document.createElement("never-defined-el");
		expect(isDeclaredPropName(element, "tags")).toBe(false);
		expect(isAwaitingDefinition(element)).toBe(true);
	});

	test("a registered definition without the static declares nothing", () => {
		customElements.define("plain-registered-el", class extends HTMLElement {});
		const element = document.createElement("plain-registered-el");
		expect(isDeclaredPropName(element, "tags")).toBe(false);
		expect(isAwaitingDefinition(element)).toBe(false);
	});

	test("a registered definition answers for its declared names", () => {
		class DeclaringElement extends HTMLElement {
			static declaredPropNames = new Set(["tags"]);
		}
		customElements.define("declaring-el", DeclaringElement);
		const element = document.createElement("declaring-el");
		expect(isDeclaredPropName(element, "tags")).toBe(true);
		expect(isDeclaredPropName(element, "other")).toBe(false);
	});
});

describe("assignDeclaredProp before the element upgrades", () => {
	//a fragment's elements upgrade on insertion, so a binding routinely commits against a child
	//whose accessors do not exist yet
	test("a value lands as an own property, for recovery to run back through the setter", () => {
		const element = document.createElement("not-yet-upgraded-el");
		assignDeclaredProp(element, "tags", ["a"]);
		expect(Object.hasOwn(element, "tags")).toBe(true);
		expect(record(element).tags).toEqual(["a"]);
	});

	test("a dropped binding lands as absence, which the accessor resolves at recovery", () => {
		const element = document.createElement("not-yet-upgraded-el");
		record(element).count = 5;

		assignDeclaredProp(element, "count", null);
		expect(Object.hasOwn(element, "count")).toBe(true);
		expect(record(element).count).toBe(null);
	});
});

//reflection spells a value out rather than preserving it, so all three variants reassign a declared
//prop instead of leaving it to the attribute copy, and hydrateDynamic reuses the spread variant
describe("a swap or hydration carries a declared prop holding a stringable value", () => {
	const asVariant = (incoming: unknown) =>
		incoming === "solid" || incoming === "outline" ? incoming : undefined;

	customElements.define(
		"swap-carried-el",
		component(
			function* () {
				yield () => null;
			},
			//`once` rather than a plainer name: the parser routes every single-hole attribute whose
			//name starts with "on" through the named-dynamic binding
			{ props: { variant: asVariant, once: asVariant } },
		),
	);

	test("single value binding", () => {
		const element = document.createElement("swap-carried-el");
		reapplySingleValueOnSwap(
			{
				lastComposedName: "variant",
				staticBinding: { valueIndex: 0 },
			} as never,
			element,
			["solid"],
		);
		expect(record(element).variant).toBe("solid");
	});

	test("named dynamic binding", () => {
		const element = document.createElement("swap-carried-el");
		reapplyNamedDynamicOnSwap(
			{ lastValue: "solid", staticBinding: { name: "once" } } as never,
			element,
		);
		expect(record(element).once).toBe("solid");
	});

	test("spread binding", () => {
		const element = document.createElement("swap-carried-el");
		reapplyDynamicOnSwap(
			{
				appliedAttributes: new Map([["variant", { value: "solid", hash: 0 }]]),
			} as never,
			element,
			[],
		);
		expect(record(element).variant).toBe("solid");
	});

	//the event sniff asks `key in element`, which the prop's own accessor answers
	test('a declared name starting with "on" is assigned, not bound as a listener', () => {
		const element = document.createElement("swap-carried-el");
		const addEventListener = vi.spyOn(element, "addEventListener");

		applyDynamicAttribute(element, "once", "outline");

		expect(record(element).once).toBe("outline");
		expect(addEventListener).not.toHaveBeenCalled();
	});

	test("an undeclared stringable is still left to the attribute copy", () => {
		const element = document.createElement("swap-carried-el");
		reapplyDynamicOnSwap(
			{
				appliedAttributes: new Map([["title", { value: "hi", hash: 0 }]]),
			} as never,
			element,
			[],
		);
		expect(element.hasAttribute("title")).toBe(false);
	});
});
