import { describe, expect, test } from "vitest";
import { html } from "../../template";
import { Schema } from "../../types";
import { assertPropNamesAreAvailable, normalizeSchema } from "../schema";

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
		const props = normalizeSchema({ userId: String, label: String });
		expect([...props.keys()]).toEqual(["userid", "label"]);
		expect(props.get("userid")!.propName).toBe("userId");
	});

	test("every prop observes an attribute, whatever its function", () => {
		const props = normalizeSchema({ count: Number, quote: asQuote });
		expect([...props.keys()]).toEqual(["count", "quote"]);
	});

	test("case is the one thing the platform destroys, so it is lowercased", () => {
		const props = normalizeSchema({
			userId: String,
			activeUserId: String,
			parseHTML: String,
			ariaLabel: String,
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
			userid: String,
			"user-id": String,
			user_id: String,
			count2: Number,
			x: Number,
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
			expect(() => normalizeSchema({ [propName]: String })).toThrow(
				/must start with a lowercase letter/,
			);
		},
	);

	test('"on-" is a custom event binding, so no prop can claim it', () => {
		expect(() => normalizeSchema({ "on-select": takeAsIs })).toThrow(
			/is reserved/,
		);
	});

	test('a name merely starting with "on" is fine — the binding checks props first', () => {
		expect(() =>
			normalizeSchema({ once: String, online: takeAsIs }),
		).not.toThrow();
	});

	test("host is reserved for the props object itself", () => {
		expect(() => normalizeSchema({ host: String })).toThrow(
			/"host" is reserved/,
		);
	});

	test("a collision names both offending keys", () => {
		let message = "";
		try {
			normalizeSchema({ userId: String, userid: String });
		} catch (error) {
			message = `${error}`;
		}
		expect(message).toContain('"userId"');
		expect(message).toContain('"userid"');
		expect(message).toContain('the attribute "userid"');
	});

	test("an entry that is not a function is refused at definition time", () => {
		expect(() =>
			normalizeSchema({ count: 5 as unknown as Schema[string] }),
		).toThrow(/must be String, Number, BigInt, Boolean, or a function/);
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
				assertPropNamesAreAvailable(
					FakeBase.prototype,
					normalizeSchema({ [propName]: String }),
				),
			).toThrow(/already a property on the element/);
		},
	);

	test("a free name passes", () => {
		expect(() =>
			assertPropNamesAreAvailable(
				FakeBase.prototype,
				normalizeSchema({ userId: String, tags: takeAsIs }),
			),
		).not.toThrow();
	});
});

describe("fallbacks", () => {
	test("the seed writes the fallback through the prop's own function", () => {
		expect(seed({ count: [Number, 0], label: [String, "—"] })).toEqual({
			count: 0,
			label: "—",
		});
	});

	test("a prop with no fallback reads undefined, and a bare Boolean reads false", () => {
		expect(
			seed({ label: String, count: Number, total: BigInt, open: Boolean }),
		).toEqual({
			label: undefined,
			count: undefined,
			total: undefined,
			open: false,
		});
	});

	test("an object fallback is copied for each element, deeply", () => {
		const schema = { config: [takeAsIs, { retry: { limit: 3 } }] } as Schema;
		const first = seed(schema).config as { retry: { limit: number } };
		const second = seed(schema).config as { retry: { limit: number } };

		first.retry.limit = 99;
		expect(second.retry.limit).toBe(3);
	});

	test("Map and Set fallbacks survive the copy", () => {
		const values = seed({
			widths: [takeAsIs, new Map([["name", "1fr"]])],
			features: [takeAsIs, new Set(["preview"])],
		});
		expect((values.widths as Map<string, string>).get("name")).toBe("1fr");
		expect((values.features as Set<string>).has("preview")).toBe(true);
	});

	test("a function fallback is shared rather than copied", () => {
		const noop = () => {};
		expect(seed({ onSave: [takeAsIs, noop] }).onSave).toBe(noop);
	});

	test("a template fallback is shared rather than copied, handlers and all", () => {
		const template = html`<footer onClick=${() => {}}>made with &lt;3</footer>`;
		expect(seed({ footer: [takeAsIs, template] }).footer).toBe(template);
	});

	test("a fallback that cannot be copied is refused at definition time", () => {
		expect(() =>
			normalizeSchema({ quote: [asQuote, new Quote("hi")] }),
		).toThrow(/cannot be copied for each element/);
	});

	test("a Date survives the copy, so it is a fallback like any other", () => {
		const when = seed({ when: [takeAsIs, new Date(0)] }).when as Date;
		expect(when).toBeInstanceOf(Date);
		expect(when.getTime()).toBe(0);
	});

	test("a fallback the prop's own function refuses is refused at definition time", () => {
		expect(() => normalizeSchema({ count: [Number, "nope"] })).toThrow(
			/is not a value the prop accepts/,
		);
	});

	test("a default living inside the function is built per element", () => {
		const schema = {
			expiresAt: (incoming: unknown) => (incoming as Date) ?? new Date(),
		} satisfies Schema;
		expect(seed(schema).expiresAt).toBeInstanceOf(Date);
		expect(seed(schema).expiresAt).not.toBe(seed(schema).expiresAt);
	});
});
