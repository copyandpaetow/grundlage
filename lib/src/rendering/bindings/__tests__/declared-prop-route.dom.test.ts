import { describe, expect, test, vi } from "vitest";
import { component } from "../../../index";
import {
	applyAttributeValue,
	isAwaitingDefinition,
	isDeclaredPropName,
	reapplyValueOnSwap,
} from "../attribute-apply";

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

//reflection spells a value out rather than preserving it, so both variants reassign a declared
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
			//`once` guards the event sniff: a declared name starting with "on" must not be read
			//as a listener
			{ props: { variant: asVariant, once: asVariant } },
		),
	);

	test("a declared prop is written again, because reflection spelled it out", () => {
		const element = document.createElement("swap-carried-el");
		reapplyValueOnSwap(element, "variant", "solid");
		expect(record(element).variant).toBe("solid");
	});

	//the event sniff asks `key in element`, which the prop's own accessor answers
	test('a declared name starting with "on" is assigned, not bound as a listener', () => {
		const element = document.createElement("swap-carried-el");
		const addEventListener = vi.spyOn(element, "addEventListener");

		applyAttributeValue(element, "once", "outline");

		expect(record(element).once).toBe("outline");
		expect(addEventListener).not.toHaveBeenCalled();
	});

	test("an undeclared stringable is still left to the attribute copy", () => {
		const element = document.createElement("swap-carried-el");
		reapplyValueOnSwap(element, "title", "hi");
		expect(element.hasAttribute("title")).toBe(false);
	});
});
