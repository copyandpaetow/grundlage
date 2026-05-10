import { describe, expect, test, vi } from "vitest";
import { applyAttributeBinding } from "./attribute";

describe("applyAttributeBinding - event listeners", () => {
	test("attaches an event listener for an on* key whose value is a function", () => {
		const element = document.createElement("button");
		const events: Array<string> = [];
		const handler = () => events.push("clicked");

		applyAttributeBinding(element, "onclick", handler);

		// addEventListener path — the attribute itself must NOT be set.
		expect(element.hasAttribute("onclick")).toBe(false);

		element.click();
		expect(events).toEqual(["clicked"]);
	});

	test("removes the previous listener and attaches the new one when both are functions", () => {
		const element = document.createElement("button");
		const events: Array<string> = [];
		const firstHandler = () => events.push("first");
		const secondHandler = () => events.push("second");

		applyAttributeBinding(element, "onclick", firstHandler);
		applyAttributeBinding(element, "onclick", secondHandler, firstHandler);

		element.click();
		expect(events).toEqual(["second"]);
	});

	test("detaches the listener when value is null and oldValue is a function", () => {
		const element = document.createElement("button");
		const events: Array<string> = [];
		const handler = () => events.push("clicked");

		applyAttributeBinding(element, "onclick", handler);
		applyAttributeBinding(element, "onclick", null, handler);

		element.click();
		expect(events).toEqual([]);
	});

	test("uppercase event keys still resolve via the lowercased lookup", () => {
		// The fast path lowercases before the `in element` check, so authored
		// keys like onClick or ONCLICK still bind to the click event.
		const element = document.createElement("button");
		const events: Array<string> = [];
		const handler = () => events.push("clicked");

		applyAttributeBinding(element, "onClick", handler);
		element.click();
		expect(events).toEqual(["clicked"]);
	});

	test("on-prefixed key that is not a real event property falls through to setAttribute", () => {
		// "ondata" isn't on HTMLElement.prototype, so the `lowerKey in element`
		// guard short-circuits the listener path. Such keys (with stringable
		// values) should land as ordinary attributes.
		const element = document.createElement("div");
		expect("ondata" in element).toBe(false);

		applyAttributeBinding(element, "ondata", "payload");
		expect(element.getAttribute("ondata")).toBe("payload");
	});

	test("on-prefixed key with non-stringable value and no matching event becomes a JS property", () => {
		// The on* fast path only fires when value or oldValue is a function. A
		// non-function, non-stringable value with an unknown on* key should land
		// on the JS property side, not as an attribute.
		const element = document.createElement("div");
		const payload = { nested: 1 };

		applyAttributeBinding(element, "ondata", payload);
		expect((element as unknown as { ondata: unknown }).ondata).toBe(payload);
		expect(element.hasAttribute("ondata")).toBe(false);
	});
});

describe("applyAttributeBinding - removal", () => {
	test.each([
		["null", null],
		["undefined", undefined],
		["false", false],
	])("removes the attribute when value is %s", (_label, value) => {
		const element = document.createElement("div");
		element.setAttribute("title", "previous");

		applyAttributeBinding(element, "title", value);
		expect(element.hasAttribute("title")).toBe(false);
	});
});

describe("applyAttributeBinding - stringable values", () => {
	test("sets a string attribute", () => {
		const element = document.createElement("div");
		applyAttributeBinding(element, "title", "hello");
		expect(element.getAttribute("title")).toBe("hello");
	});

	test("coerces a number to a string attribute", () => {
		const element = document.createElement("input");
		applyAttributeBinding(element, "tabindex", 5);
		expect(element.getAttribute("tabindex")).toBe("5");
	});

	test("coerces boolean true to the literal string 'true'", () => {
		// Matches the integration test "sets boolean true as empty attribute":
		// String(true) === "true", and that's what lands on the attribute.
		const element = document.createElement("button");
		applyAttributeBinding(element, "disabled", true);
		expect(element.getAttribute("disabled")).toBe("true");
	});

	test("empty string is preserved as a present-but-empty attribute", () => {
		const element = document.createElement("div");
		applyAttributeBinding(element, "title", "");
		expect(element.hasAttribute("title")).toBe(true);
		expect(element.getAttribute("title")).toBe("");
	});

	test("transition from non-stringable oldValue to stringable value clears the JS property", () => {
		// attribute.ts:43-48 — the JS property previously set for a complex
		// value must be deleted so the attribute side becomes the source of
		// truth. Without this, the element keeps a stale property reference.
		const element = document.createElement("div");
		const previous = { nested: 1 };

		applyAttributeBinding(element, "data", previous);
		expect((element as unknown as { data: unknown }).data).toBe(previous);

		applyAttributeBinding(element, "data", "plain", previous);
		expect(element.getAttribute("data")).toBe("plain");
		expect(Object.prototype.hasOwnProperty.call(element, "data")).toBe(false);
	});
});

describe("applyAttributeBinding - non-stringable values", () => {
	test("assigns a complex value as a JS property without setting the attribute", () => {
		const element = document.createElement("div");
		const payload = { nested: { value: 1 } };

		applyAttributeBinding(element, "data", payload);
		expect((element as unknown as { data: unknown }).data).toBe(payload);
		expect(element.hasAttribute("data")).toBe(false);
	});

	test("assigns an array as a JS property", () => {
		const element = document.createElement("div");
		const items = [1, 2, 3];

		applyAttributeBinding(element, "items", items);
		expect((element as unknown as { items: unknown }).items).toBe(items);
	});

	test("calls update() when the receiver exposes one (custom-element handoff)", () => {
		// attribute.ts:52-55 — when the target has an update() method, we trigger
		// it so a custom element can react to the new property. This is the
		// component-to-component data flow path.
		const element = document.createElement("div") as HTMLDivElement & {
			update?: () => void;
		};
		const updateSpy = vi.fn();
		element.update = updateSpy;

		applyAttributeBinding(element, "config", { nested: 1 });
		expect(updateSpy).toHaveBeenCalledTimes(1);
	});

	test("does not call update() for stringable values", () => {
		// The update() trigger lives only on the property-assignment branch.
		// Plain attribute writes must not fire it — otherwise every attribute
		// flip on a child component would cause it to re-render twice.
		const element = document.createElement("div") as HTMLDivElement & {
			update?: () => void;
		};
		const updateSpy = vi.fn();
		element.update = updateSpy;

		applyAttributeBinding(element, "title", "hello");
		expect(updateSpy).not.toHaveBeenCalled();
	});
});
