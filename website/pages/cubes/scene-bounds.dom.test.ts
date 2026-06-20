import { afterEach, describe, expect, test } from "vitest";
import { blockCornersPx, blocksBoundsPx } from "./scene-shared";

// These exercise the SELECTION-CAGE behaviour: what volume the cage has to enclose
// for a given block. blockCornersPx reads the block's resolved `transform` matrix
// (the single source of truth — what the browser composed from the geometry's
// translate · rotate · scale) and pushes the block's pre-scale half-extents through
// it. We drive it the way the browser does: set an inline `transform` (the exact
// string the geometry's :host rule produces) plus the `--block-extent-*` the leaf
// publishes, attach the element, and read the result. We never touch component
// internals, only the observable result: a world-axis-aligned box that is tight
// when a block is axis-aligned and grows as it turns.
//
// happy-dom resolves an inline `transform` through getComputedStyle and parses it
// with DOMMatrix exactly as a browser does, so the matrix math runs here unchanged.

// Half-extent of a default unit cube in px (UNIT_SIZE / 2). We hard-code it here so
// the test states the expected geometry rather than re-deriving it from the source.
const HALF_UNIT = 60;

const created: HTMLElement[] = [];

// A leaf block: an inline `transform` (the resolved matrix the matrix math reads)
// plus `--block-extent-*` (so blockCornersPx takes the leaf branch). The extents
// default to a unit cube unless a test overrides them; they are PRE-scale, because
// the transform's own scale3d already scales them.
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

// A transform carrier: an inline `transform` but NO extent, so blockCornersPx
// recurses into its leaf children and composes their corners through the group's
// own matrix.
const makeGroup = (transform: string, children: HTMLElement[]): HTMLElement => {
	const group = document.createElement("scene-group");
	if (transform !== "") group.style.transform = transform;
	for (const child of children) group.appendChild(child);
	document.body.appendChild(group);
	created.push(group);
	return group;
};

const expectVectorClose = (
	actual: readonly number[],
	expected: readonly number[],
): void => {
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

	test("scale stretches the corners per axis", () => {
		// scale3d(2, 1, 0.5) over the unit cube → half-extents 120 / 60 / 30.
		const bounds = blocksBoundsPx([makeLeaf("scale3d(2, 1, 0.5)")]);
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
		const bounds = blocksBoundsPx([
			makeLeaf("translate3d(120px, -60px, 240px)"),
		]);
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
