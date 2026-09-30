import { describe, expect, test } from "vitest";
import { combinedPartsHash, composeParts } from "../compose";

describe("composeParts", () => {
	test("interleaves static string parts with interpolated values", () => {
		expect(composeParts(["data-", 0, "-x"], ["id"])).toBe("data-id-x");
	});

	test("stringifies non-string values", () => {
		expect(composeParts([0, "/", 1], [42, 7n])).toBe("42/7");
	});

	test("booleans, null and undefined compose as empty, like a content hole", () => {
		expect(
			composeParts(["card ", 0, 1, 2, 3], [false, true, null, undefined]),
		).toBe("card ");
	});

	test("a parts array of only strings ignores values", () => {
		expect(composeParts(["static"], ["unused"])).toBe("static");
	});
});

describe("combinedPartsHash", () => {
	test("only numeric parts contribute — static-only parts hash constant", () => {
		const a = combinedPartsHash(["x", "y"], ["ignored"]);
		const b = combinedPartsHash(["x", "y"], ["different"]);
		expect(a).toBe(b);
	});

	test("different interpolated values produce different hashes", () => {
		const a = combinedPartsHash([0], ["a"]);
		const b = combinedPartsHash([0], ["b"]);
		expect(a).not.toBe(b);
	});

	test("notices an object mutated in place (same reference, new contents)", () => {
		const value = { n: 1 };
		const before = combinedPartsHash([0], [value]);
		value.n = 2;
		const after = combinedPartsHash([0], [value]);
		expect(after).not.toBe(before);
	});
});
