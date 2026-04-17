import {describe, expect, test} from "vitest";
import {hashValue, stringHash} from "./hashing";

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
    test("null and undefined both hash to 0", () => {
        expect(hashValue(null)).toBe(0);
        expect(hashValue(undefined)).toBe(0);
    });

    test("booleans are 1 / 0", () => {
        expect(hashValue(true)).toBe(1);
        expect(hashValue(false)).toBe(0);
    });

    test("integer returns itself", () => {
        expect(hashValue(42)).toBe(42);
        expect(hashValue(0)).toBe(0);
        expect(hashValue(-7)).toBe(-7);
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

    test("string hash matches stringHash", () => {
        expect(hashValue("hello")).toBe(stringHash("hello"));
    });

    test("empty string hashes to 0", () => {
        expect(hashValue("")).toBe(0);
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
        expect(hashValue({a: 1, b: 2})).toBe(hashValue({a: 1, b: 2}));
    });

    test("different values produce different hashes", () => {
        expect(hashValue({a: 1})).not.toBe(hashValue({a: 2}));
    });

    test("different keys produce different hashes", () => {
        expect(hashValue({a: 1})).not.toBe(hashValue({b: 1}));
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
});
