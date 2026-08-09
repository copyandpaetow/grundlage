import { describe, expect, test, vi } from "vitest";
import { Schema } from "../../types";
import { normalizeSchema, Prop } from "../schema";
import {
	attributeSpellingOf,
	PropValues,
	recoverPreUpgradeAssignments,
	writeProp,
} from "../values";

const setUp = (schema: Schema) => {
	const props = normalizeSchema(schema);
	const values: PropValues = {};
	for (const prop of props.values())
		values[prop.propName] = prop.resolve(undefined);
	return {
		values,
		propOf: (attributeName: string) => props.get(attributeName)!,
	};
};

const parseTags = (incoming: unknown) =>
	typeof incoming === "string"
		? incoming.split(" ").filter(Boolean)
		: (incoming as Array<string>);

class Quote {
	constructor(readonly text: string) {}
}

const asQuote = (incoming: unknown) =>
	incoming instanceof Quote ? incoming : undefined;

describe("the write flow", () => {
	test("a string is parsed and anything else is taken as it is", () => {
		const { values, propOf } = setUp({ tags: [parseTags, []] });
		writeProp(values, propOf("tags"), "a b");
		expect(values.tags).toEqual(["a", "b"]);
		writeProp(values, propOf("tags"), ["x"]);
		expect(values.tags).toEqual(["x"]);
	});

	test("a refusal is ignored, warns once, and leaves the previous value alone", () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const { values, propOf } = setUp({ quote: asQuote });
		const quote = new Quote("hi");
		writeProp(values, propOf("quote"), quote);

		expect(writeProp(values, propOf("quote"), "garbage")).toBe(false);
		expect(values.quote).toBe(quote);
		expect(warn).toHaveBeenCalledTimes(1);
		warn.mockRestore();
	});

	test("absence rewrites the fallback, as a fresh copy", () => {
		const { values, propOf } = setUp({ tags: [parseTags, ["seed"]] });
		const atConstruction = values.tags;

		writeProp(values, propOf("tags"), ["x"]);
		expect(writeProp(values, propOf("tags"), undefined)).toBe(true);
		expect(values.tags).toEqual(["seed"]);
		expect(values.tags).not.toBe(atConstruction);
	});

	test("null is absence, the same as undefined", () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const { values, propOf } = setUp({ count: [Number, 0] });
		writeProp(values, propOf("count"), 7);
		expect(writeProp(values, propOf("count"), null)).toBe(true);
		expect(values.count).toBe(0);
		expect(warn).not.toHaveBeenCalled();
		warn.mockRestore();
	});

	test("an unchanged primitive reports no change; a changed one does", () => {
		const { values, propOf } = setUp({ count: [Number, 0] });
		expect(writeProp(values, propOf("count"), "6")).toBe(true);
		expect(writeProp(values, propOf("count"), 6)).toBe(false);
		expect(writeProp(values, propOf("count"), "6")).toBe(false);
		expect(writeProp(values, propOf("count"), 7)).toBe(true);
	});

	test("re-assigning the same object always reports a change, because it may have been mutated", () => {
		const { values, propOf } = setUp({ tags: [parseTags, []] });
		const items = ["a"];
		expect(writeProp(values, propOf("tags"), items)).toBe(true);
		items.push("b");
		expect(writeProp(values, propOf("tags"), items)).toBe(true);
	});

	test("an empty attribute is refused by Number and BigInt, and is a value for String and Boolean", () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const { values, propOf } = setUp({
			count: [Number, 0],
			total: BigInt,
			label: String,
			open: Boolean,
		});
		writeProp(values, propOf("count"), "");
		writeProp(values, propOf("total"), "");
		writeProp(values, propOf("label"), "");
		writeProp(values, propOf("open"), "");

		expect(values.count).toBe(0);
		expect(values.total).toBe(undefined);
		expect(values.label).toBe("");
		expect(values.open).toBe(true);
		warn.mockRestore();
	});

	test("an assignment is parsed rather than type-checked", () => {
		const { values, propOf } = setUp({ label: String });
		writeProp(values, propOf("label"), 5);
		expect(values.label).toBe("5");
	});

	test("the NaN the library itself writes reads back", () => {
		const { values, propOf } = setUp({ count: Number });
		writeProp(values, propOf("count"), "NaN");
		expect(values.count).toBeNaN();
	});
});

describe("the attribute spelling", () => {
	const spellingOf = (schema: Schema, value: unknown) => {
		const props = normalizeSchema(schema);
		return attributeSpellingOf([...props.values()][0] as Prop, value);
	};

	test("a string, number and bigint spell themselves", () => {
		expect(spellingOf({ label: String }, "ada")).toBe("ada");
		expect(spellingOf({ count: Number }, 7)).toBe("7");
		expect(spellingOf({ total: BigInt }, 10n)).toBe("10");
	});

	test("true is presence and false takes the attribute off", () => {
		expect(spellingOf({ open: Boolean }, true)).toBe("");
		expect(spellingOf({ open: Boolean }, false)).toBe(null);
		expect(spellingOf({ open: [Boolean, false] }, false)).toBe(null);
	});

	test("false spells itself out where absence would read true", () => {
		expect(spellingOf({ open: [Boolean, true] }, false)).toBe("false");
	});

	test("a value with no string spelling has no attribute half", () => {
		expect(spellingOf({ tags: parseTags }, ["a"])).toBe(null);
		expect(spellingOf({ tags: parseTags }, undefined)).toBe(null);
	});
});

describe("pre-upgrade recovery", () => {
	test("an own property is deleted and written back through the accessor", () => {
		const props = normalizeSchema({ label: String });
		const written: Array<unknown> = [];
		const prototype = {};
		Object.defineProperty(prototype, "label", {
			configurable: true,
			set(value: unknown) {
				written.push(value);
			},
			get() {
				return written.at(-1);
			},
		});
		const element = Object.create(prototype) as HTMLElement;
		(element as unknown as Record<string, unknown>).label = "ada";

		recoverPreUpgradeAssignments(element, props);

		expect(Object.hasOwn(element, "label")).toBe(false);
		expect(written).toEqual(["ada"]);
	});
});
