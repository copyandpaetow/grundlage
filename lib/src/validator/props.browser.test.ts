import { describe, it, expect } from "vitest";
import { props } from "./props";

const createElement = (
	attributes: Record<string, string> = {},
	properties: Record<string, unknown> = {},
): HTMLElement => {
	const element = document.createElement("div");
	for (const [key, value] of Object.entries(attributes)) {
		element.setAttribute(key, value);
	}
	for (const [key, value] of Object.entries(properties)) {
		(element as unknown as Record<string, unknown>)[key] = value;
	}
	return element;
};

describe("props", () => {
	describe("String", () => {
		it("reads from attribute", () => {
			const element = createElement({ label: "hello" });
			const { label } = props(element, { label: String });
			expect(label).toBe("hello");
		});

		it("returns empty string for empty attribute", () => {
			const element = createElement({ label: "" });
			const { label } = props(element, { label: String });
			expect(label).toBe("");
		});

		it("falls back to property when attribute is missing", () => {
			const element = createElement({}, { label: "from-prop" });
			const { label } = props(element, { label: String });
			expect(label).toBe("from-prop");
		});

		it("throws when required and missing", () => {
			const element = createElement();
			expect(() => props(element, { label: String })).toThrow(
				'Missing required prop: "label"',
			);
		});

		it("uses default when missing", () => {
			const element = createElement();
			const { label } = props(element, { label: [String, "fallback"] });
			expect(label).toBe("fallback");
		});

		it("returns undefined when optional and missing", () => {
			const element = createElement();
			const { label } = props(element, { label: [String] });
			expect(label).toBeUndefined();
		});
	});

	describe("Number", () => {
		it("reads and coerces from attribute", () => {
			const element = createElement({ count: "42" });
			const { count } = props(element, { count: Number });
			expect(count).toBe(42);
		});

		it("handles zero correctly", () => {
			const element = createElement({ count: "0" });
			const { count } = props(element, { count: Number });
			expect(count).toBe(0);
		});

		it("handles negative numbers", () => {
			const element = createElement({ count: "-5" });
			const { count } = props(element, { count: Number });
			expect(count).toBe(-5);
		});

		it("handles floating point", () => {
			const element = createElement({ ratio: "3.14" });
			const { ratio } = props(element, { ratio: Number });
			expect(ratio).toBeCloseTo(3.14);
		});

		it("throws on NaN", () => {
			const element = createElement({ count: "hello" });
			expect(() => props(element, { count: Number })).toThrow(
				'Invalid number value for attribute "count": "hello"',
			);
		});

		it("falls back to property when attribute is missing", () => {
			const element = createElement({}, { count: 99 });
			const { count } = props(element, { count: Number });
			expect(count).toBe(99);
		});

		it("uses default when missing", () => {
			const element = createElement();
			const { count } = props(element, { count: [Number, 0] });
			expect(count).toBe(0);
		});

		it("throws when required and missing", () => {
			const element = createElement();
			expect(() => props(element, { count: Number })).toThrow(
				'Missing required prop: "count"',
			);
		});
	});

	describe("Boolean", () => {
		it("returns true when attribute is present", () => {
			const element = createElement({ disabled: "" });
			const { disabled } = props(element, { disabled: Boolean });
			expect(disabled).toBe(true);
		});

		it("returns true when attribute has a value", () => {
			const element = createElement({ disabled: "anything" });
			const { disabled } = props(element, { disabled: Boolean });
			expect(disabled).toBe(true);
		});

		it("returns false when attribute is absent", () => {
			const element = createElement();
			const { disabled } = props(element, { disabled: Boolean });
			expect(disabled).toBe(false);
		});

		it("uses default when absent", () => {
			const element = createElement();
			const { enabled } = props(element, { enabled: [Boolean, true] });
			expect(enabled).toBe(true);
		});

		it("returns true over default when present", () => {
			const element = createElement({ enabled: "" });
			const { enabled } = props(element, { enabled: [Boolean, false] });
			expect(enabled).toBe(true);
		});
	});

	describe("Function", () => {
		it("reads from property", () => {
			const fn = () => 42;
			const element = createElement({}, { callback: fn });
			const { callback } = props(element, { callback: Function });
			expect(callback).toBe(fn);
		});

		it("throws when required and missing", () => {
			const element = createElement();
			expect(() => props(element, { callback: Function })).toThrow(
				'Missing required prop: "callback"',
			);
		});

		it("uses default when missing", () => {
			const element = createElement();
			const { callback } = props(element, { callback: [Function, null] });
			expect(callback).toBeNull();
		});

		it("returns undefined when optional and missing", () => {
			const element = createElement();
			const { callback } = props(element, { callback: [Function] });
			expect(callback).toBeUndefined();
		});
	});

	describe("Array", () => {
		it("reads from property", () => {
			const items = [1, 2, 3];
			const element = createElement({}, { items });
			const { items: result } = props(element, { items: Array });
			expect(result).toBe(items);
		});

		it("throws when required and missing", () => {
			const element = createElement();
			expect(() => props(element, { items: Array })).toThrow(
				'Missing required prop: "items"',
			);
		});
	});

	describe("Object", () => {
		it("reads from property", () => {
			const config = { a: 1, b: 2 };
			const element = createElement({}, { config });
			const { config: result } = props(element, { config: Object });
			expect(result).toBe(config);
		});
	});

	describe("Map", () => {
		it("reads from property", () => {
			const data = new Map([["key", "value"]]);
			const element = createElement({}, { data });
			const { data: result } = props(element, { data: Map });
			expect(result).toBe(data);
		});
	});

	describe("Set", () => {
		it("reads from property", () => {
			const tags = new Set(["a", "b"]);
			const element = createElement({}, { tags });
			const { tags: result } = props(element, { tags: Set });
			expect(result).toBe(tags);
		});
	});

	describe("native element properties", () => {
		it("reads children", () => {
			const element = document.createElement("div");
			element.innerHTML = "<span>a</span><span>b</span>";
			const { children } = props(element, { children: HTMLCollection });
			expect(children).toBe(element.children);
			expect(children.length).toBe(2);
		});

		it("reads id from attribute", () => {
			const element = createElement({ id: "my-id" });
			const { id } = props(element, { id: String });
			expect(id).toBe("my-id");
		});
	});

	describe("mixed schema", () => {
		it("resolves each type correctly", () => {
			const fn = () => {};
			const items = [1, 2];
			const element = createElement(
				{ label: "hello", count: "5", disabled: "" },
				{ callback: fn, items },
			);

			const result = props(element, {
				label: String,
				count: Number,
				disabled: Boolean,
				callback: Function,
				items: Array,
				missing: [String, "default"],
			});

			expect(result.label).toBe("hello");
			expect(result.count).toBe(5);
			expect(result.disabled).toBe(true);
			expect(result.callback).toBe(fn);
			expect(result.items).toBe(items);
			expect(result.missing).toBe("default");
		});
	});
});
