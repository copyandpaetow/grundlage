import { describe, expect, test } from "vitest";
import { html } from "../../template";
import { Schema } from "../../types";
import { ensurePropNamesAreAvailable, normalizeSchema } from "../schema";
import { prop } from "../../index";

class Quote {
	constructor(readonly text: string) {}
}

const asQuote = (incoming: unknown) =>
	incoming instanceof Quote ? incoming : undefined;

const takeAsIs = (incoming: unknown) => incoming;

const seed = (schema: Schema): Record<string, unknown> => {
	const props = normalizeSchema(schema);
	const values: Record<string, unknown> = {};
	for (const prop of props.values())
		values[prop.propName] = prop.resolve(undefined);
	return values;
};

describe("normalization", () => {
	test("the map is keyed by attribute name and keeps the prop name beside it", () => {
		const props = normalizeSchema({
			userId: prop.optional(prop.attribute(String)),
			label: prop.optional(prop.attribute(String)),
		});
		expect([...props.keys()]).toEqual(["userid", "label"]);
		expect(props.get("userid")!.propName).toBe("userId");
	});

	test("every prop observes an attribute, whatever its function", () => {
		const props = normalizeSchema({
			count: prop.optional(prop.attribute(Number)),
			quote: prop.optional(prop.attribute(asQuote)),
		});
		expect([...props.keys()]).toEqual(["count", "quote"]);
	});

	test("case is the one thing the platform destroys, so it is lowercased", () => {
		const props = normalizeSchema({
			userId: prop.optional(prop.attribute(String)),
			activeUserId: prop.optional(prop.attribute(String)),
			parseHTML: prop.optional(prop.attribute(String)),
			ariaLabel: prop.optional(prop.attribute(String)),
		});
		expect([...props.keys()]).toEqual([
			"userid",
			"activeuserid",
			"parsehtml",
			"arialabel",
		]);
	});

	test("names the platform can carry are kept verbatim", () => {
		const props = normalizeSchema({
			userid: prop.optional(prop.attribute(String)),
			"user-id": prop.optional(prop.attribute(String)),
			user_id: prop.optional(prop.attribute(String)),
			count2: prop.optional(prop.attribute(Number)),
			x: prop.optional(prop.attribute(Number)),
		});
		expect([...props.keys()]).toEqual([
			"userid",
			"user-id",
			"user_id",
			"count2",
			"x",
		]);
	});

	test.each(["UserId", "2fast", "-lead", "user id", "user.id", ""])(
		"rejects the prop name %j",
		(propName) => {
			expect(() =>
				normalizeSchema({ [propName]: prop.optional(prop.attribute(String)) }),
			).toThrow(/must start with a lowercase letter/);
		},
	);

	test('"on-" is a custom event binding, so no prop can claim it', () => {
		expect(() =>
			normalizeSchema({ "on-select": prop.optional(prop.attribute(takeAsIs)) }),
		).toThrow(/is reserved/);
	});

	test('a name merely starting with "on" is fine — the binding checks props first', () => {
		expect(() =>
			normalizeSchema({
				once: prop.optional(prop.attribute(String)),
				online: prop.optional(prop.attribute(takeAsIs)),
			}),
		).not.toThrow();
	});

	test("host is reserved for the props object itself", () => {
		expect(() =>
			normalizeSchema({ host: prop.optional(prop.attribute(String)) }),
		).toThrow(/"host" is reserved/);
	});

	test("a collision names both offending keys", () => {
		let message = "";
		try {
			normalizeSchema({
				userId: prop.optional(prop.attribute(String)),
				userid: prop.optional(prop.attribute(String)),
			});
		} catch (error) {
			message = `${error}`;
		}
		expect(message).toContain('"userId"');
		expect(message).toContain('"userid"');
		expect(message).toContain('the attribute "userid"');
	});

	test("a parser that is not a function is refused at definition time", () => {
		expect(() =>
			normalizeSchema({
				//a JavaScript caller can pass anything
				count: prop.attribute(5 as unknown as NumberConstructor),
			}),
		).toThrow(/takes String, Number, BigInt, Boolean, or a function/);
	});

	test.each([
		["a bare token", String],
		["a tuple with a fallback", [Number, 0]],
		["a bare function", takeAsIs],
	])("%s from before prop.attribute() names the new spelling", (_, entry) => {
		expect(() =>
			//the old spellings are what this test passes on purpose
			normalizeSchema({ count: entry } as unknown as Schema),
		).toThrow(
			/declared with prop.attribute\(parser\).*prop.attribute\(Number, 0\) instead of \[Number, 0\]/,
		);
	});
});

describe("reserved names", () => {
	class FakeElement {
		get title(): string {
			return "";
		}
	}
	class FakeBase extends FakeElement {
		update(): void {}
	}

	test.each(["title", "update"])(
		"%s is already on the prototype chain",
		(propName) => {
			expect(() =>
				ensurePropNamesAreAvailable(
					FakeBase.prototype,
					normalizeSchema({
						[propName]: prop.optional(prop.attribute(String)),
					}),
				),
			).toThrow(/already a property on the element/);
		},
	);

	test("a free name passes", () => {
		expect(() =>
			ensurePropNamesAreAvailable(
				FakeBase.prototype,
				normalizeSchema({
					userId: prop.optional(prop.attribute(String)),
					tags: prop.optional(prop.attribute(takeAsIs)),
				}),
			),
		).not.toThrow();
	});
});

describe("fallbacks", () => {
	test("the seed writes the fallback through the prop's own function", () => {
		expect(
			seed({
				count: prop.attribute(Number, 0),
				label: prop.attribute(String, "—"),
			}),
		).toEqual({
			count: 0,
			label: "—",
		});
	});

	test("a prop with no fallback reads undefined, and a bare Boolean reads false", () => {
		expect(
			seed({
				label: prop.optional(prop.attribute(String)),
				count: prop.optional(prop.attribute(Number)),
				total: prop.optional(prop.attribute(BigInt)),
				open: prop.attribute(Boolean),
			}),
		).toEqual({
			label: undefined,
			count: undefined,
			total: undefined,
			open: false,
		});
	});

	test("an object fallback is copied for each element, deeply", () => {
		const schema = {
			config: prop.attribute(takeAsIs, { retry: { limit: 3 } }),
		} as Schema;
		const first = seed(schema).config as { retry: { limit: number } };
		const second = seed(schema).config as { retry: { limit: number } };

		first.retry.limit = 99;
		expect(second.retry.limit).toBe(3);
	});

	test("Map and Set fallbacks survive the copy", () => {
		const values = seed({
			widths: prop.attribute(takeAsIs, new Map([["name", "1fr"]])),
			features: prop.attribute(takeAsIs, new Set(["preview"])),
		});
		expect((values.widths as Map<string, string>).get("name")).toBe("1fr");
		expect((values.features as Set<string>).has("preview")).toBe(true);
	});

	test("a function fallback is shared rather than copied", () => {
		const noop = () => {};
		expect(seed({ onSave: prop.attribute(takeAsIs, noop) }).onSave).toBe(noop);
	});

	test("a template fallback is shared rather than copied, handlers and all", () => {
		const template = html`<footer onClick=${() => {}}>made with &lt;3</footer>`;
		expect(seed({ footer: prop.attribute(takeAsIs, template) }).footer).toBe(
			template,
		);
	});

	test("a class instance is refused at definition time: the copy loses its prototype", () => {
		expect(() =>
			normalizeSchema({ quote: prop.attribute(asQuote, new Quote("hi")) }),
		).toThrow(/cannot be copied for each element.*loses its prototype/);
	});

	test("a fallback holding a function is refused at definition time: the copy throws", () => {
		expect(() =>
			normalizeSchema({
				handlers: prop.attribute(takeAsIs, { onDone: () => {} }),
			}),
		).toThrow(/cannot be copied for each element.*holding a function/);
	});

	test("a Date survives the copy, so it is a fallback like any other", () => {
		const when = seed({ when: prop.attribute(takeAsIs, new Date(0)) })
			.when as Date;
		expect(when).toBeInstanceOf(Date);
		expect(when.getTime()).toBe(0);
	});

	test("a fallback the prop's own function refuses is refused at definition time", () => {
		expect(() =>
			//a JavaScript caller gets past the fallback's type
			normalizeSchema({
				count: prop.attribute(Number, "nope" as unknown as number),
			}),
		).toThrow(/is not a value its parser accepts/);
	});

	test("a default living inside the function is built per element", () => {
		const schema = {
			expiresAt: prop.optional(
				prop.attribute((incoming: unknown) => (incoming as Date) ?? new Date()),
			),
		} satisfies Schema;
		expect(seed(schema).expiresAt).toBeInstanceOf(Date);
		expect(seed(schema).expiresAt).not.toBe(seed(schema).expiresAt);
	});
});
