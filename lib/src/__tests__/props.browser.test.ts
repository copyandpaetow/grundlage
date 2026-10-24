import { describe, expect, it, vi } from "vitest";
import { prop } from "../index";

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
	describe("the attribute mode", () => {
		it("reads and parses each shipped token", () => {
			const element = createElement({
				label: "hello",
				count: "42",
				total: "9",
				open: "",
			});
			expect(
				prop.read(element, {
					label: prop.optional(prop.attribute(String)),
					count: prop.optional(prop.attribute(Number)),
					total: prop.optional(prop.attribute(BigInt)),
					open: prop.attribute(Boolean),
				}),
			).toEqual({ label: "hello", count: 42, total: 9n, open: true });
		});

		it("reads the attribute under the lowercased prop name", () => {
			const element = createElement({ userid: "8" });
			expect(
				prop.read(element, { userId: prop.optional(prop.attribute(String)) })
					.userId,
			).toBe("8");
		});

		it("resolves absence through the prop's own function", () => {
			const element = createElement();
			expect(
				prop.read(element, { label: prop.optional(prop.attribute(String)) })
					.label,
			).toBe(undefined);
			expect(
				prop.read(element, { label: prop.attribute(String, "anon") }).label,
			).toBe("anon");
			expect(prop.read(element, { open: prop.attribute(Boolean) }).open).toBe(
				false,
			);
		});

		it("treats an empty Number or BigInt attribute as absent", () => {
			const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
			const element = createElement({ count: "", total: "" });
			expect(
				prop.read(element, { count: prop.attribute(Number, 7) }).count,
			).toBe(7);
			expect(
				prop.read(element, { total: prop.attribute(BigInt, 3n) }).total,
			).toBe(3n);
			warn.mockRestore();
		});

		it('reads x="false" as false for every boolean shape', () => {
			const element = createElement({ open: "false" });
			expect(prop.read(element, { open: prop.attribute(Boolean) }).open).toBe(
				false,
			);
			expect(
				prop.read(element, { open: prop.attribute(Boolean, true) }).open,
			).toBe(false);
		});

		it("warns and keeps the absent value on a malformed number or bigint", () => {
			const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
			expect(
				prop.read(createElement({ count: "hello" }), {
					count: prop.attribute(Number, 0),
				}).count,
			).toBe(0);
			expect(
				prop.read(createElement({ total: "3.14" }), {
					total: prop.optional(prop.attribute(BigInt)),
				}).total,
			).toBe(undefined);
			expect(warn).toHaveBeenCalledTimes(2);
			warn.mockRestore();
		});

		it("reads back the NaN the library itself writes", () => {
			expect(
				prop.read(createElement({ count: "NaN" }), {
					count: prop.optional(prop.attribute(Number)),
				}).count,
			).toBeNaN();
		});
	});

	describe("the property mode", () => {
		it("an own property wins over the attribute, case intact", () => {
			const payload = [1, 2];
			const element = createElement(
				{ usertags: "ignored" },
				{
					userTags: payload,
				},
			);
			expect(
				prop.read(element, { userTags: prop.optional(prop.attribute(asList)) })
					.userTags,
			).toBe(payload);
		});

		it("runs the prop's function on what it finds", () => {
			const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
			const element = createElement({}, { tags: "not-a-list" });
			expect(
				prop.read(element, { tags: prop.attribute(asList, []) }).tags,
			).toEqual([]);
			expect(warn).toHaveBeenCalledWith(
				expect.stringContaining('prop "tags" refused a string'),
			);
			warn.mockRestore();
		});

		it("hands each call its own copy of a mutable fallback", () => {
			const element = createElement();
			const first = prop.read(element, {
				tags: prop.attribute(asList, []),
			}).tags;
			const second = prop.read(element, {
				tags: prop.attribute(asList, []),
			}).tags;
			expect(first).not.toBe(second);
		});

		it("reads a function-typed prop from the property mode", () => {
			const handler = () => {};
			const element = createElement({}, { onSelect: handler });
			expect(
				prop.read(element, {
					onSelect: prop.optional(prop.attribute(asCallback)),
				}).onSelect,
			).toBe(handler);
		});

		it("takes own properties only, so a built-in accessor is not a value", () => {
			const element = createElement();
			element.append(document.createElement("span"));
			expect(
				prop.read(element, {
					children: prop.optional(
						prop.attribute((incoming: unknown) => incoming),
					),
				}).children,
			).toBe(undefined);
		});
	});

	describe("define-time checks still apply", () => {
		it("rejects a prop name the platform cannot carry", () => {
			expect(() =>
				prop.read(createElement(), {
					UserId: prop.optional(prop.attribute(String)),
				}),
			).toThrow(/must start with a lowercase letter/);
		});

		it("rejects two props colliding on one attribute", () => {
			expect(() =>
				prop.read(createElement(), {
					userId: prop.optional(prop.attribute(String)),
					userid: prop.optional(prop.attribute(String)),
				}),
			).toThrow(/both map to the attribute "userid"/);
		});
	});

	describe("mixed schema", () => {
		it("resolves each mode independently", () => {
			const tags = ["a"];
			const element = createElement(
				{ label: "hi", count: "3", open: "" },
				{ tags },
			);
			expect(
				prop.read(element, {
					label: prop.optional(prop.attribute(String)),
					count: prop.optional(prop.attribute(Number)),
					open: prop.attribute(Boolean),
					tags: prop.optional(prop.attribute(asList)),
					missing: prop.attribute(String, "none"),
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
