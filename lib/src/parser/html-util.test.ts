import { describe, test, expect } from "vitest";
import {
	COMMENT_IDENTIFIER,
	isWhitespace,
	isQuote,
	moveArrayContents,
} from "./html-util";

describe("COMMENT_IDENTIFIER", () => {
	test("is a stable string", () => {
		expect(COMMENT_IDENTIFIER).toBe("^.^");
	});
});

describe("isWhitespace", () => {
	test("detects space", () => {
		expect(isWhitespace(" ")).toBe(true);
	});

	test("detects tab", () => {
		expect(isWhitespace("\t")).toBe(true);
	});

	test("detects newline", () => {
		expect(isWhitespace("\n")).toBe(true);
	});

	test("detects carriage return", () => {
		expect(isWhitespace("\r")).toBe(true);
	});

	test("rejects letters", () => {
		expect(isWhitespace("a")).toBe(false);
	});

	test("rejects digits", () => {
		expect(isWhitespace("0")).toBe(false);
	});

	test("rejects symbols", () => {
		expect(isWhitespace("<")).toBe(false);
		expect(isWhitespace("=")).toBe(false);
	});
});

describe("isQuote", () => {
	test("detects single quote", () => {
		expect(isQuote("'")).toBe(true);
	});

	test("detects double quote", () => {
		expect(isQuote('"')).toBe(true);
	});

	test("rejects backtick", () => {
		expect(isQuote("`")).toBe(false);
	});

	test("rejects non-quote characters", () => {
		expect(isQuote("a")).toBe(false);
		expect(isQuote(" ")).toBe(false);
	});
});

describe("moveArrayContents", () => {
	test("moves all items from source to target", () => {
		const from = [1, 2, 3];
		const to = [0];
		moveArrayContents(from, to);

		expect(to).toEqual([0, 1, 2, 3]);
	});

	test("empties the source array", () => {
		const from = ["a", "b"];
		const to: string[] = [];
		moveArrayContents(from, to);

		expect(from).toHaveLength(0);
	});

	test("handles empty source", () => {
		const from: number[] = [];
		const to = [1];
		moveArrayContents(from, to);

		expect(to).toEqual([1]);
		expect(from).toHaveLength(0);
	});

	test("handles mixed types", () => {
		const from: unknown[] = [1, "two", null];
		const to: unknown[] = [];
		moveArrayContents(from, to);

		expect(to).toEqual([1, "two", null]);
	});
});
