import { describe, expect, test } from "vitest";
import { forEachInRange } from "../range";

const comment = (data: string): Comment => document.createComment(data);

describe("forEachInRange", () => {
	test("visits every node from first up to but not including end", () => {
		const parent = document.createElement("div");
		const start = comment("start");
		const p = document.createElement("p");
		const text = document.createTextNode("x");
		const end = comment("end");
		parent.append(start, p, text, end);

		const visited: Array<Node> = [];
		forEachInRange(start.nextSibling, end, (node) => visited.push(node));

		expect(visited).toEqual([p, text]);
	});

	test("removal visitor clears the range, leaving the boundaries", () => {
		const parent = document.createElement("div");
		const before = document.createElement("header");
		const start = comment("start");
		const end = comment("end");
		const after = document.createElement("footer");
		parent.append(before, start, document.createElement("p"), end, after);

		forEachInRange(start.nextSibling, end, (node) => node.remove());

		expect(start.nextSibling).toBe(end);
		expect(parent.firstChild).toBe(before);
		expect(parent.lastChild).toBe(after);
	});

	test("an empty range (first === end) is a no-op", () => {
		const parent = document.createElement("div");
		const start = comment("start");
		const end = comment("end");
		parent.append(start, end);

		const visited: Array<Node> = [];
		forEachInRange(start.nextSibling, end, (node) => visited.push(node));

		expect(visited).toEqual([]);
		expect(start.nextSibling).toBe(end);
	});

	test("a null first is a no-op", () => {
		const visited: Array<Node> = [];
		forEachInRange(null, comment("end"), (node) => visited.push(node));

		expect(visited).toEqual([]);
	});

	test("stops at the end of the sibling chain when end is never reached", () => {
		const parent = document.createElement("div");
		const first = document.createElement("span");
		const second = document.createElement("b");
		parent.append(first, second);

		const visited: Array<Node> = [];
		forEachInRange(first, comment("detached-end"), (node) =>
			visited.push(node),
		);

		expect(visited).toEqual([first, second]);
	});
});
