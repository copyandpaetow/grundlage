import { describe, test, expect } from "vitest";
import { isWhitespaceCode, isQuoteCode } from "../chars";
import { COMMENT_IDENTIFIER } from "../constants";

//the parser hot loop reads char codes, so we test against `.charCodeAt(0)` of the
//literal character to keep the intent readable while exercising the numeric predicate
const code = (char: string) => char.charCodeAt(0);

describe("COMMENT_IDENTIFIER", () => {
	test("is a stable string", () => {
		expect(COMMENT_IDENTIFIER).toBe("^.^");
	});
});

describe("isWhitespaceCode", () => {
	test("detects space", () => {
		expect(isWhitespaceCode(code(" "))).toBe(true);
	});

	test("detects tab", () => {
		expect(isWhitespaceCode(code("\t"))).toBe(true);
	});

	test("detects newline", () => {
		expect(isWhitespaceCode(code("\n"))).toBe(true);
	});

	test("detects carriage return", () => {
		expect(isWhitespaceCode(code("\r"))).toBe(true);
	});

	test("rejects letters", () => {
		expect(isWhitespaceCode(code("a"))).toBe(false);
	});

	test("rejects digits", () => {
		expect(isWhitespaceCode(code("0"))).toBe(false);
	});

	test("rejects symbols", () => {
		expect(isWhitespaceCode(code("<"))).toBe(false);
		expect(isWhitespaceCode(code("="))).toBe(false);
	});
});

describe("isQuoteCode", () => {
	test("detects single quote", () => {
		expect(isQuoteCode(code("'"))).toBe(true);
	});

	test("detects double quote", () => {
		expect(isQuoteCode(code('"'))).toBe(true);
	});

	test("rejects backtick", () => {
		expect(isQuoteCode(code("`"))).toBe(false);
	});

	test("rejects non-quote characters", () => {
		expect(isQuoteCode(code("a"))).toBe(false);
		expect(isQuoteCode(code(" "))).toBe(false);
	});
});
