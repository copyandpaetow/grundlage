import { afterEach, describe, expect, test } from "vitest";
import { blockCornersPx, blocksBoundsPx } from "./scene-geometry";

// happy-dom resolves an inline `transform` through getComputedStyle and DOMMatrix as a
// browser does, so the matrix math runs here unchanged.

// Hard-coded, so the test states the geometry rather than re-deriving it from the source
const HALF_UNIT = 60;

const created: HTMLElement[] = [];

// The extents already include the size, which scales only the faces, never the matrix
const makeLeaf = (
	transform: string,
	extent: readonly [number, number, number] = [HALF_UNIT, HALF_UNIT, HALF_UNIT],
): HTMLElement => {
	const element = document.createElement("scene-cube");
	if (transform !== "") element.style.transform = transform;
	element.style.setProperty("--block-extent-x", `${extent[0]}px`);
	element.style.setProperty("--block-extent-y", `${extent[1]}px`);
	element.style.setProperty("--block-extent-z", `${extent[2]}px`);
	document.body.appendChild(element);
	created.push(element);
	return element;
};

// No extent, so blockCornersPx recurses into its children
const makeGroup = (transform: string, children: HTMLElement[]): HTMLElement => {
	const group = document.createElement("scene-group");
	if (transform !== "") group.style.transform = transform;
	for (const child of children) group.appendChild(child);
	document.body.appendChild(group);
	created.push(group);
	return group;
};

const expectVectorClose = (actual: readonly number[], expected: readonly number[]): void => {
	for (let axis = 0; axis < 3; axis++) {
		expect(actual[axis]).toBeCloseTo(expected[axis], 5);
	}
};

afterEach(() => {
	for (const element of created) element.remove();
	created.length = 0;
});

describe("blockCornersPx — leaf geometry", () => {
	test("a unit cube at the origin yields eight ±half-unit corners", () => {
		const corners = blockCornersPx(makeLeaf(""));
		expect(corners).toHaveLength(8);
		for (const corner of corners) {
			for (const value of corner) {
				expect(Math.abs(value)).toBeCloseTo(HALF_UNIT, 5);
			}
		}
	});

	test("the scaled extents set the corners per axis", () => {
		// size="2 1 0.5" publishes half-extents 120 / 60 / 30 and leaves the matrix unscaled.
		const bounds = blocksBoundsPx([makeLeaf("", [120, 60, 30])]);
		expect(bounds).not.toBeNull();
		expectVectorClose(bounds!.center, [0, 0, 0]);
		expectVectorClose(bounds!.half, [120, 60, 30]);
	});
});

describe("blocksBoundsPx — the world-aligned cage volume", () => {
	test("returns null for an empty selection so the cage can hide", () => {
		expect(blocksBoundsPx([])).toBeNull();
	});

	test("centres on the block's translation, tight when axis-aligned", () => {
		const bounds = blocksBoundsPx([makeLeaf("translate3d(120px, -60px, 240px)")]);
		expect(bounds).not.toBeNull();
		expectVectorClose(bounds!.center, [120, -60, 240]);
		expectVectorClose(bounds!.half, [HALF_UNIT, HALF_UNIT, HALF_UNIT]);
	});

	test("a rotation swaps the extents it turns through", () => {
		// A slab (x=60, y=20, z=60) spun 90° about Z trades its x and y extents.
		const bounds = blocksBoundsPx([makeLeaf("rotateZ(90deg)", [60, 20, 60])]);
		expect(bounds).not.toBeNull();
		expectVectorClose(bounds!.half, [20, 60, 60]);
	});

	test("the box GROWS as a cube turns corner-on (45° about Y)", () => {
		const grown = HALF_UNIT * Math.SQRT2; // ≈ 84.85
		const bounds = blocksBoundsPx([makeLeaf("rotateY(45deg)")]);
		expect(bounds).not.toBeNull();
		expectVectorClose(bounds!.half, [grown, HALF_UNIT, grown]);
	});

	test("unions every block in the selection", () => {
		const bounds = blocksBoundsPx([
			makeLeaf("translate3d(0px, 0px, 0px)"),
			makeLeaf("translate3d(240px, 0px, 0px)"),
		]);
		expect(bounds).not.toBeNull();
		// x spans -60 … 300 → centre 120, half 180; y/z unchanged.
		expectVectorClose(bounds!.center, [120, 0, 0]);
		expectVectorClose(bounds!.half, [180, HALF_UNIT, HALF_UNIT]);
	});
});

describe("blockCornersPx — group recursion", () => {
	test("lifts child corners through the group's own matrix", () => {
		// Child cube centred at x=60 spans 0…120; the group's +100 translate shifts
		// the whole subtree to 100…220 → centre 160, half 60.
		const group = makeGroup("translate3d(100px, 0px, 0px)", [
			makeLeaf("translate3d(60px, 0px, 0px)"),
		]);
		const bounds = blocksBoundsPx([group]);
		expect(bounds).not.toBeNull();
		expectVectorClose(bounds!.center, [160, 0, 0]);
		expectVectorClose(bounds!.half, [HALF_UNIT, HALF_UNIT, HALF_UNIT]);
	});
});

describe("blockCornersPx — a block with its own geometry and child blocks", () => {
	test("unions its own corners with its children's", () => {
		// The cube spans -60…60; its child, 3 units up in its frame, spans y -420…-300.
		const child = makeLeaf("translate3d(0px, -360px, 0px)");
		const parent = makeLeaf("translate3d(120px, 0px, 0px)");
		parent.appendChild(child);
		const bounds = blocksBoundsPx([parent]);
		expect(bounds).not.toBeNull();
		expectVectorClose(bounds!.center, [120, -180, 0]);
		expectVectorClose(bounds!.half, [HALF_UNIT, 240, HALF_UNIT]);
	});
});
