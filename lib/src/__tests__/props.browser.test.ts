import { describe, expect, it, vi } from "vitest";
import { props } from "../props/read";

const asList = (incoming: unknown): Array<unknown> | undefined =>
	Array.isArray(incoming) ? incoming : undefined;
const asCallback = (incoming: unknown): (() => void) | undefined =>
	typeof incoming === "function" ? (incoming as () => void) : undefined;

const createElement = (
	attributes: Record<string, string> = {},
	properties: Record<string, unknown> = {},
): HTMLElement => {
	const element = document.createElement("div");
	for (const [key, value] of Object.entries(attributes))
		element.setAttribute(key, value);
	for (const [key, value] of Object.entries(properties))
		(element as unknown as Record<string, unknown>)[key] = value;
	return element;
};

describe("props on a plain element", () => {
	describe("the attribute channel", () => {
		it("reads and parses each shipped token", () => {
			const element = createElement({
				label: "hello",
				count: "42",
				total: "9",
				open: "",
			});
			expect(
				props(element, {
					label: String,
					count: Number,
					total: BigInt,
					open: Boolean,
				}),
			).toEqual({ label: "hello", count: 42, total: 9n, open: true });
		});

		it("reads the attribute under the lowercased prop name", () => {
			const element = createElement({ userid: "8" });
			expect(props(element, { userId: String }).userId).toBe("8");
		});

		it("resolves absence through the prop's own function", () => {
			const element = createElement();
			expect(props(element, { label: String }).label).toBe(undefined);
			expect(props(element, { label: [String, "anon"] }).label).toBe("anon");
			expect(props(element, { open: Boolean }).open).toBe(false);
		});

		it("treats an empty Number or BigInt attribute as absent", () => {
			const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
			const element = createElement({ count: "", total: "" });
			expect(props(element, { count: [Number, 7] }).count).toBe(7);
			expect(props(element, { total: [BigInt, 3n] }).total).toBe(3n);
			warn.mockRestore();
		});

		it('reads x="false" as false for every boolean shape', () => {
			const element = createElement({ open: "false" });
			expect(props(element, { open: Boolean }).open).toBe(false);
			expect(props(element, { open: [Boolean, true] }).open).toBe(false);
		});

		it("warns and keeps the absent value on a malformed number or bigint", () => {
			const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
			expect(
				props(createElement({ count: "hello" }), { count: [Number, 0] }).count,
			).toBe(0);
			expect(
				props(createElement({ total: "3.14" }), { total: BigInt }).total,
			).toBe(undefined);
			expect(warn).toHaveBeenCalledTimes(2);
			warn.mockRestore();
		});

		it("reads back the NaN the library itself writes", () => {
			expect(
				props(createElement({ count: "NaN" }), { count: Number }).count,
			).toBeNaN();
		});
	});

	describe("the property channel", () => {
		it("an own property wins over the attribute, case intact", () => {
			const payload = [1, 2];
			const element = createElement(
				{ usertags: "ignored" },
				{
					userTags: payload,
				},
			);
			expect(props(element, { userTags: asList }).userTags).toBe(payload);
		});

		it("runs the prop's function on what it finds", () => {
			const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
			const element = createElement({}, { tags: "not-a-list" });
			expect(props(element, { tags: [asList, []] }).tags).toEqual([]);
			expect(warn).toHaveBeenCalledWith(
				expect.stringContaining('prop "tags" refused a string'),
			);
			warn.mockRestore();
		});

		it("hands each call its own copy of a mutable fallback", () => {
			const element = createElement();
			const first = props(element, { tags: [asList, []] }).tags;
			const second = props(element, { tags: [asList, []] }).tags;
			expect(first).not.toBe(second);
		});

		it("reads a function-typed prop from the property channel", () => {
			const handler = () => {};
			const element = createElement({}, { onSelect: handler });
			expect(props(element, { onSelect: asCallback }).onSelect).toBe(handler);
		});

		it("takes own properties only, so a built-in accessor is not a value", () => {
			const element = createElement();
			element.append(document.createElement("span"));
			expect(
				props(element, { children: (incoming: unknown) => incoming }).children,
			).toBe(undefined);
		});
	});

	describe("define-time checks still apply", () => {
		it("rejects a prop name the platform cannot carry", () => {
			expect(() => props(createElement(), { UserId: String })).toThrow(
				/must start with a lowercase letter/,
			);
		});

		it("rejects two props colliding on one attribute", () => {
			expect(() =>
				props(createElement(), { userId: String, userid: String }),
			).toThrow(/both map to the attribute "userid"/);
		});
	});

	describe("mixed schema", () => {
		it("resolves each channel independently", () => {
			const tags = ["a"];
			const element = createElement(
				{ label: "hi", count: "3", open: "" },
				{ tags },
			);
			expect(
				props(element, {
					label: String,
					count: Number,
					open: Boolean,
					tags: asList,
					missing: [String, "none"],
				}),
			).toEqual({
				label: "hi",
				count: 3,
				open: true,
				tags,
				missing: "none",
			});
		});
	});
});
