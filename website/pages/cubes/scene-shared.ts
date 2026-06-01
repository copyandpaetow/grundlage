// Shared geometry constants and the attribute → variable bridge helpers for the
// DOM-as-geometry scene. Both <scene-world> and <scene-cube> lean on this module
// so the two state channels stay consistent: attributes are the committed,
// authored, serializable state; CSS variables are the in-flight render state.

// Pixels of screen space one authored grid unit occupies. The unit-cube geometry
// is laid out once at this size; every dimension after that is scale3d over it.
export const UNIT_SIZE = 120;

// Half a unit cube in px. Every geometry lays its faces out around this, and the
// leaf cube/ramp publish it as their --block-extent-*; shared so the value can't drift.
export const HALF_UNIT = UNIT_SIZE / 2;

// Authoring grid resolution in grid units. Direct manipulation commits snap to
// this so dragged blocks land on a regular lattice instead of arbitrary floats.
export const GRID_SNAP = 0.5;

// Snap a continuous grid value onto the authoring lattice.
export const snapToGrid = (value: number): number =>
	Math.round(value / GRID_SNAP) * GRID_SNAP;

// Format a number for serialized attributes: drop trailing zeros so exported
// markup reads `2` and `1.5`, never `2.000000001` or `1.50`.
export const formatNumber = (value: number): string => {
	const rounded = Math.round(value * 1000) / 1000;
	return Object.is(rounded, -0) ? "0" : String(rounded);
};

export type Vector3 = [number, number, number];

// The three authored transform triples and their per-axis specific attributes.
// One copy lives here so every geometry element, the gizmo, and the editor read
// the same names — both for resolution precedence and for MutationObserver filters.
export const SIZE_SPECIFIC = ["width", "height", "depth"] as const;
export const POSITION_SPECIFIC = ["x", "y", "z"] as const;
export const ROTATION_SPECIFIC = ["rotate-x", "rotate-y", "rotate-z"] as const;

const parseNumberList = (raw: string | null): number[] => {
	if (raw === null) return [];
	return raw
		.trim()
		.split(/\s+/)
		.filter((token) => token !== "")
		.map(Number);
};

// Resolve one axis triple (e.g. `size` → width/height/depth) following the
// plan's precedence: the shorthand seeds all three axes, and a specific
// attribute overrides its own axis when present. A single shorthand value
// applies to every axis; three values map to x/y/z in order. We resolve this in
// JS so CSS only ever sees the concrete --block-* channel, never the shorthand.
const resolveAxisTriple = (
	element: Element,
	shorthand: string,
	specific: readonly [string, string, string],
	fallback: number,
): Vector3 => {
	const shorthandValues = parseNumberList(element.getAttribute(shorthand));

	const seedForAxis = (axis: number): number => {
		if (shorthandValues.length === 1) return shorthandValues[0];
		if (axis < shorthandValues.length) return shorthandValues[axis];
		return fallback;
	};

	const resolveAxis = (axis: number): number => {
		const specificRaw = element.getAttribute(specific[axis]);
		if (specificRaw !== null && specificRaw.trim() !== "") {
			const parsed = Number(specificRaw);
			if (!Number.isNaN(parsed)) return parsed;
		}
		return seedForAxis(axis);
	};

	return [resolveAxis(0), resolveAxis(1), resolveAxis(2)];
};

export type BlockTransform = {
	size: Vector3;
	position: Vector3;
	rotation: Vector3;
};

// Resolve a block's three authored triples in one pass. Every element that carries
// a transform — leaf geometry, the group carrier, the ghost — reads the same way, so
// the attribute → variable bridge lives in exactly one place. A group has no size of
// its own and simply ignores the resolved `size` (three cheap getAttribute reads on a
// cold path; not worth a second helper). Returns packed tuples so a caller can pull a
// single field with one contiguous destructure.
export const resolveBlockTransform = (element: Element): BlockTransform => ({
	size: resolveAxisTriple(element, "size", SIZE_SPECIFIC, 1),
	position: resolveAxisTriple(element, "position", POSITION_SPECIFIC, 0),
	rotation: resolveAxisTriple(element, "rotation", ROTATION_SPECIFIC, 0),
});

// Commit sequencing for a live manipulation (drag, grouping). The gesture holds its
// in-flight value as an inline --block-* override, which wins over the geometry's
// shadow :host rule. On commit we write the authored attribute — but that re-renders
// ASYNCHRONOUSLY (the lib re-renders off a MutationObserver, two microtask hops away),
// so clearing the override too early would flash the pre-commit value for a frame.
//
// The fix is to call update() ourselves (which skips the observer hop) and await it:
// the returned promise resolves AFTER the synchronous re-render, so by the time `clear`
// runs the resolved --block-* already reflect the commit and there is no flash. A bare
// `await Promise.resolve()` would NOT do — its continuation is enqueued ahead of the
// bridge's delivery, so the clear would still run first.
//
// update() early-returns (resolving immediately) if the block is disconnected or
// already mid-update; that is fine here because we run exactly one commit per gesture,
// on a connected, idle block — do NOT lean on this await to sequence overlapping updates
// on the same block. A block that is not a lib component (e.g. under test) has no
// update(); we skip straight to the clear.
// Await a block's next render, so a subsequent read of its resolved --block-* sees a
// just-committed attribute rather than the stale prior value. We call update() directly
// (skipping the attribute observer's extra hop) and the returned promise resolves AFTER
// the synchronous re-render. A block that is not a lib component (e.g. under test) has
// no update(), so we resolve immediately.
export const blockRendered = (block: HTMLElement): Promise<void> => {
	const update = (block as { update?: () => Promise<void> }).update;
	return typeof update === "function" ? update.call(block) : Promise.resolve();
};

export const commitBlockRender = async (
	block: HTMLElement,
	clear: (block: HTMLElement) => void,
): Promise<void> => {
	await blockRendered(block);
	clear(block);
};

// Scene elements that carry a --block-* transform: leaf geometry plus the group
// carrier. This is the one selectable/boundable set — the editor, the gizmo, and
// the cage all share it. blockCornersPx recurses through a group into these.
export const BLOCK_TAGS = new Set([
	"scene-cube",
	"scene-wall",
	"scene-ramp",
	"scene-group",
]);

export const isBlock = (node: Element): boolean =>
	BLOCK_TAGS.has(node.tagName.toLowerCase());

// The eight corners of a block in screen-px world space, read from the LIVE
// transform the BROWSER resolved for it. We do not re-derive rotation by hand:
// getComputedStyle().transform already composes the block's translate · rotate ·
// scale — with the bridge's Y-negation and scale3d baked in — into one matrix, so
// pushing the unit corners through it lands them exactly where the faces paint.
//
// getComputedStyle gives only this element's LOCAL matrix, so to bound a block
// inside a (possibly rotated) group we compose: each recursion multiplies the
// parent's accumulated matrix by the child's local one and passes it down.
//
// A LEAF geometry publishes its own pre-scale half-extents as --block-extent-* (px),
// so a thin wall bounds as a slab, not a cube. We push those PRE-scale extents
// through the matrix — the matrix ALREADY carries scale3d, so re-applying
// --block-scale-* would double the scale. A transform CARRIER (a group) has no
// faces and no extent: we recurse into its blocks through the composed matrix.
export const blockCornersPx = (
	block: Element,
	accumulated: DOMMatrix = new DOMMatrix(),
): Vector3[] => {
	const style = getComputedStyle(block as HTMLElement);
	const transform = style.transform;
	const local =
		transform === "" || transform === "none"
			? new DOMMatrix()
			: new DOMMatrix(transform);
	const worldMatrix = accumulated.multiply(local);

	const readExtent = (name: string): number => {
		const value = parseFloat(style.getPropertyValue(name));
		return Number.isNaN(value) ? 0 : value;
	};
	const hasExtent = style.getPropertyValue("--block-extent-x").trim() !== "";

	// Leaf geometry: the eight corners of its own pre-scale box, pushed through the
	// composed matrix (which already scales them).
	if (hasExtent) {
		const halfX = readExtent("--block-extent-x");
		const halfY = readExtent("--block-extent-y");
		const halfZ = readExtent("--block-extent-z");
		const corners: Vector3[] = [];
		for (const signX of [-1, 1]) {
			for (const signY of [-1, 1]) {
				for (const signZ of [-1, 1]) {
					const point = worldMatrix.transformPoint(
						new DOMPoint(signX * halfX, signY * halfY, signZ * halfZ),
					);
					corners.push([point.x, point.y, point.z]);
				}
			}
		}
		return corners;
	}

	// Transform carrier (group): bound by its blocks' corners, composed through our matrix.
	const corners: Vector3[] = [];
	for (const child of Array.from(block.children)) {
		if (!isBlock(child)) continue;
		for (const corner of blockCornersPx(child, worldMatrix)) corners.push(corner);
	}
	return corners;
};

export type Bounds = { center: Vector3; half: Vector3 };

// World-axis-aligned bounding box, in screen px, that contains every block's eight
// corners. Because we union the actual rotated corners, the box is tight when a
// block is axis-aligned and grows to wrap it as it turns — exactly the "biggest
// when you look straight down a corner" case the cage has to survive. Null for an
// empty set so callers can hide their chrome.
export const blocksBoundsPx = (blocks: Iterable<Element>): Bounds | null => {
	let min: Vector3 | null = null;
	let max: Vector3 | null = null;
	for (const block of blocks) {
		for (const corner of blockCornersPx(block)) {
			if (min === null || max === null) {
				min = [corner[0], corner[1], corner[2]];
				max = [corner[0], corner[1], corner[2]];
				continue;
			}
			for (let axis = 0; axis < 3; axis++) {
				min[axis] = Math.min(min[axis], corner[axis]);
				max[axis] = Math.max(max[axis], corner[axis]);
			}
		}
	}
	if (min === null || max === null) return null;
	return {
		center: [
			(min[0] + max[0]) / 2,
			(min[1] + max[1]) / 2,
			(min[2] + max[2]) / 2,
		],
		half: [(max[0] - min[0]) / 2, (max[1] - min[1]) / 2, (max[2] - min[2]) / 2],
	};
};
