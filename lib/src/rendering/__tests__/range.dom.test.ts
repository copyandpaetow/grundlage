import { describe, expect, test } from "vitest";
import { ListItem } from "../bindings/types";
import { clearNodeRange, forEachRowNode } from "../range";

const comment = (data: string): Comment => document.createComment(data);

describe("clearNodeRange", () => {
	test("removes every node strictly between the markers, leaving the markers", () => {
		const parent = document.createElement("div");
		const start = comment("start");
		const end = comment("end");
		parent.append(start, document.createElement("p"), document.createTextNode("x"), end);

		clearNodeRange(start, end);

		expect(start.nextSibling).toBe(end);
		expect(parent.contains(start)).toBe(true);
		expect(parent.contains(end)).toBe(true);
	});

	test("leaves nodes outside the range untouched", () => {
		const parent = document.createElement("div");
		const before = document.createElement("header");
		const start = comment("start");
		const end = comment("end");
		const after = document.createElement("footer");
		parent.append(before, start, document.createElement("p"), end, after);

		clearNodeRange(start, end);

		expect(parent.firstChild).toBe(before);
		expect(parent.lastChild).toBe(after);
	});

	test("an empty range (adjacent markers) is a no-op", () => {
		const parent = document.createElement("div");
		const start = comment("start");
		const end = comment("end");
		parent.append(start, end);

		clearNodeRange(start, end);

		expect(start.nextSibling).toBe(end);
	});
});

describe("forEachRowNode", () => {
	test("visits nodes from spanStart up to but not including the tail marker", () => {
		const parent = document.createElement("div");
		const first = document.createElement("span");
		const second = document.createElement("b");
		const tailMarker = comment("tail");
		parent.append(first, second, tailMarker);

		const visited: Array<Node> = [];
		forEachRowNode(
			{ spanStart: first, tailMarker } as unknown as ListItem,
			(node) => visited.push(node),
		);

		expect(visited).toEqual([first, second]);
	});

	test("visits nothing when spanStart is the tail marker itself", () => {
		const parent = document.createElement("div");
		const tailMarker = comment("tail");
		parent.append(tailMarker);

		const visited: Array<Node> = [];
		forEachRowNode(
			{ spanStart: tailMarker, tailMarker } as unknown as ListItem,
			(node) => visited.push(node),
		);

		expect(visited).toEqual([]);
	});
});
