import { describe, expect, test } from "vitest";
import { clearRange } from "../markers";

const comment = (data: string): Comment => document.createComment(data);

describe("clearRange", () => {
	test("removes every node from first up to but not including end", () => {
		const parent = document.createElement("div");
		const before = document.createElement("header");
		const start = comment("start");
		const end = comment("end");
		const after = document.createElement("footer");
		parent.append(
			before,
			start,
			document.createElement("p"),
			document.createTextNode("x"),
			end,
			after,
		);

		clearRange(start.nextSibling, end);

		expect(Array.from(parent.childNodes)).toEqual([before, start, end, after]);
	});

	test("an empty range (first === end) is a no-op", () => {
		const parent = document.createElement("div");
		const start = comment("start");
		const end = comment("end");
		parent.append(start, end);

		clearRange(start.nextSibling, end);

		expect(Array.from(parent.childNodes)).toEqual([start, end]);
	});

	test("a null first is a no-op", () => {
		expect(() => clearRange(null, comment("end"))).not.toThrow();
	});

	test("stops at the end of the sibling chain when end is never reached", () => {
		const parent = document.createElement("div");
		parent.append(document.createElement("span"), document.createElement("b"));

		clearRange(parent.firstChild, comment("detached-end"));

		expect(parent.childNodes.length).toBe(0);
	});
});
