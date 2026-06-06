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

// The placement floor's half-extent in grid units: the grid spans this many cells
// either side of the origin. <scene-ground> draws the sheet and maps a screen hit
// back to a world cell from it, so the drawn grid and the snapped point share one
// definition.
export const GROUND_HALF_UNITS = 20;

// The placement floor's full side length in px — the square sheet <scene-ground>
// renders, centred on the origin.
export const GROUND_SIZE = GROUND_HALF_UNITS * 2 * UNIT_SIZE;

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

// --- World ↔ screen and rotation matrices ------------------------------------
// Composing transforms by matrix lives here because both the editor (flattening a
// carrier into its leaves) and the gizmo (driving its direct child as one rigid
// body) need the same maths. Euler angles do NOT compose by addition, so anything
// combining two rotations must go through these.

// Author-space position (grid units, +Y up) ↔ the screen-px point a carrier
// translates to (+Y down). The attribute → variable bridge negates Y; we mirror it.
export const toScreenPoint = ([x, y, z]: Vector3): DOMPoint =>
	new DOMPoint(x * UNIT_SIZE, -y * UNIT_SIZE, z * UNIT_SIZE);
export const fromScreenPoint = (point: DOMPoint): Vector3 => [
	point.x / UNIT_SIZE,
	-point.y / UNIT_SIZE,
	point.z / UNIT_SIZE,
];

// A pure rotation matrix in the carrier's own order (rotateX · rotateY · rotateZ),
// built from a resolved Euler triple. Multiply two of these to combine rotations.
export const rotationMatrix = ([rotateX, rotateY, rotateZ]: Vector3): DOMMatrix =>
	new DOMMatrix(
		`rotateX(${rotateX}deg) rotateY(${rotateY}deg) rotateZ(${rotateZ}deg)`,
	);

// The full transform a carrier contributes to its content: translate then rotate, in
// the same order every :host writes it (carriers never scale). A child lifts into the
// carrier's frame by pushing its own translation through this.
export const frameMatrix = (position: Vector3, rotation: Vector3): DOMMatrix =>
	new DOMMatrix(
		`translate3d(${position[0] * UNIT_SIZE}px, ${-position[1] * UNIT_SIZE}px, ${
			position[2] * UNIT_SIZE
		}px) rotateX(${rotation[0]}deg) rotateY(${rotation[1]}deg) rotateZ(${
			rotation[2]
		}deg)`,
	);

// Decompose a rotation matrix back into the rotateX·rotateY·rotateZ Euler triple
// (degrees), mirroring frameMatrix's order so a round-trip is stable. Reads the
// rotated basis vectors out of the matrix; falls back to a yaw-only read at the ±90°
// pitch gimbal, where the X and Z rotations couple and one must be chosen as 0.
export const eulerFromMatrix = (matrix: DOMMatrix): Vector3 => {
	// Read the rotated basis as the LINEAR part only. transformPoint applies the FULL
	// affine transform — translation included — so we map the origin too and subtract it.
	// Without this, a matrix that also translates (a rotation about an off-origin pivot, or
	// even a pure translation) contaminates the basis: e.g. a translation of dx px makes
	// zAxis.x = dx, which asin clamps to ±90deg and decodes as a garbage rotation.
	const origin = matrix.transformPoint(new DOMPoint(0, 0, 0));
	const mapAxis = (x: number, y: number, z: number) => {
		const mapped = matrix.transformPoint(new DOMPoint(x, y, z));
		return { x: mapped.x - origin.x, y: mapped.y - origin.y, z: mapped.z - origin.z };
	};
	const xAxis = mapAxis(1, 0, 0);
	const yAxis = mapAxis(0, 1, 0);
	const zAxis = mapAxis(0, 0, 1);
	const sinPitch = Math.max(-1, Math.min(1, zAxis.x));
	const pitch = Math.asin(sinPitch);
	const toDegrees = (radians: number): number => (radians * 180) / Math.PI;
	if (Math.abs(Math.cos(pitch)) > 1e-6) {
		return [
			toDegrees(Math.atan2(-zAxis.y, zAxis.z)),
			toDegrees(pitch),
			toDegrees(Math.atan2(-yAxis.x, xAxis.x)),
		];
	}
	// Gimbal lock: fold the coupled rotation into X and leave Z at zero.
	return [toDegrees(Math.atan2(sinPitch * xAxis.y, yAxis.y)), toDegrees(pitch), 0];
};
