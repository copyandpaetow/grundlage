import { describe, expect, test } from "vitest";
import { hashValue, stringHash } from "../hashing";

describe("stringHash", () => {
	test("empty string hashes to 0", () => {
		expect(stringHash("")).toBe(0);
	});

	test("is deterministic for the same input", () => {
		expect(stringHash("hello")).toBe(stringHash("hello"));
	});

	test("returns a 32-bit signed integer", () => {
		const result = stringHash("a".repeat(500));
		expect(Number.isInteger(result)).toBe(true);
		expect(result).toBe(result | 0);
	});

	test("different inputs usually produce different hashes", () => {
		expect(stringHash("foo")).not.toBe(stringHash("bar"));
		expect(stringHash("abc")).not.toBe(stringHash("abd"));
	});
});

describe("hashValue - primitives", () => {
	test("null and undefined share the nullish hash", () => {
		expect(hashValue(null)).toBe(hashValue(undefined));
	});

	test("true and false hash distinctly and stay out of the integers' value space", () => {
		expect(hashValue(true)).not.toBe(hashValue(false));
		//the type tag keeps booleans from colliding with 1 and 0
		expect(hashValue(true)).not.toBe(hashValue(1));
		expect(hashValue(false)).not.toBe(hashValue(0));
	});

	test("integers hash deterministically and distinctly", () => {
		expect(hashValue(42)).toBe(hashValue(42));
		expect(hashValue(42)).not.toBe(hashValue(43));
		expect(hashValue(0)).not.toBe(hashValue(-7));
	});

	test("float hashing is deterministic", () => {
		expect(hashValue(3.14)).toBe(hashValue(3.14));
		expect(hashValue(50.12345)).toBe(hashValue(50.12345));
	});

	test("tightly-clustered floats produce distinct hashes", () => {
		// Regression guard: the float hash must distinguish neighbouring values
		// the animation stress test actually produces (widths like 50.1, 50.100001, 50.2).
		const values = [50.1, 50.1000001, 50.10001, 50.2, 50.20000001];
		const hashes = new Set(values.map(hashValue));
		expect(hashes.size).toBe(values.length);
	});

	test("NaN hash is deterministic across calls", () => {
		expect(hashValue(NaN)).toBe(hashValue(NaN));
	});

	test("Infinity and -Infinity have distinct hashes", () => {
		expect(hashValue(Infinity)).not.toBe(hashValue(-Infinity));
	});

	test("strings hash deterministically and distinctly", () => {
		expect(hashValue("hello")).toBe(hashValue("hello"));
		expect(hashValue("hello")).not.toBe(hashValue("world"));
	});

	test("empty string is deterministic and distinct from nullish", () => {
		expect(hashValue("")).toBe(hashValue(""));
		expect(hashValue("")).not.toBe(hashValue(null));
	});
});

describe("hashValue - arrays", () => {
	test("same content produces same hash", () => {
		expect(hashValue([1, 2, 3])).toBe(hashValue([1, 2, 3]));
	});

	test("different content produces different hash", () => {
		expect(hashValue([1, 2, 3])).not.toBe(hashValue([1, 2, 4]));
	});

	test("order matters", () => {
		expect(hashValue([1, 2, 3])).not.toBe(hashValue([3, 2, 1]));
	});

	test("empty array", () => {
		expect(hashValue([])).toBe(hashValue([]));
	});

	test("nested arrays hash by content", () => {
		expect(hashValue([[1, 2], [3]])).toBe(hashValue([[1, 2], [3]]));
	});
});

describe("hashValue - plain objects", () => {
	test("same content produces same hash", () => {
		expect(hashValue({ a: 1, b: 2 })).toBe(hashValue({ a: 1, b: 2 }));
	});

	test("different values produce different hashes", () => {
		expect(hashValue({ a: 1 })).not.toBe(hashValue({ a: 2 }));
	});

	test("different keys produce different hashes", () => {
		expect(hashValue({ a: 1 })).not.toBe(hashValue({ b: 1 }));
	});
});

describe("hashValue - reference types", () => {
	test("same function reference returns same hash", () => {
		const fn = () => {};
		expect(hashValue(fn)).toBe(hashValue(fn));
	});

	test("different function references return different hashes", () => {
		expect(hashValue(() => {})).not.toBe(hashValue(() => {}));
	});

	test("class instance uses reference identity", () => {
		class Foo {}
		const instance = new Foo();
		expect(hashValue(instance)).toBe(hashValue(instance));
	});

	test("two fresh class instances get distinct counter ids", () => {
		//the WeakMap fallback path hands out monotonically increasing counter ids — two distinct objects must never collide
		//we keep this test separate from the function case so a regression that only hits one branch surfaces here, not in the function test where lambda identity already differs
		class Foo {}
		const firstInstance = new Foo();
		const secondInstance = new Foo();
		expect(hashValue(firstInstance)).not.toBe(hashValue(secondInstance));
	});

	test("same Map instance hashes equal across reads", () => {
		const map = new Map<string, number>([["a", 1]]);
		expect(hashValue(map)).toBe(hashValue(map));
	});

	test("two fresh Maps with identical contents hash equal", () => {
		//Maps are walked for content now, so equal entries hash equal across references
		const first = new Map<string, number>([["a", 1]]);
		const second = new Map<string, number>([["a", 1]]);
		expect(hashValue(first)).toBe(hashValue(second));
		expect(hashValue(first)).not.toBe(hashValue(new Map([["a", 2]])));
	});

	test("same Set instance hashes equal across reads", () => {
		const set = new Set(["a"]);
		expect(hashValue(set)).toBe(hashValue(set));
	});

	test("two fresh Sets with identical contents hash equal", () => {
		const first = new Set(["a"]);
		const second = new Set(["a"]);
		expect(hashValue(first)).toBe(hashValue(second));
		expect(hashValue(first)).not.toBe(hashValue(new Set(["b"])));
	});
});

describe("hashValue - prototype-less objects", () => {
	//`Object.create(null)` is a real object literal in disguise — it has no `.constructor`, so the `value.constructor === Object` guard in hashValue is `undefined === Object` which is false
	//=> these objects fall through to the WeakMap reference branch. We pin that contract here so a future change (e.g. switching to a tag check) makes an intentional decision about prototype-less objects.
	test("hashes the same reference equally across calls", () => {
		const plain = Object.create(null) as Record<string, unknown>;
		plain.value = 1;
		expect(hashValue(plain)).toBe(hashValue(plain));
	});

	test("two structurally identical prototype-less objects get distinct hashes", () => {
		const first = Object.create(null) as Record<string, unknown>;
		first.value = 1;
		const second = Object.create(null) as Record<string, unknown>;
		second.value = 1;
		expect(hashValue(first)).not.toBe(hashValue(second));
	});
});
