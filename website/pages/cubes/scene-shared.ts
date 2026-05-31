// Shared geometry constants and the attribute → variable bridge helpers for the
// DOM-as-geometry scene. Both <scene-world> and <scene-cube> lean on this module
// so the two state channels stay consistent: attributes are the committed,
// authored, serializable state; CSS variables are the in-flight render state.

// Pixels of screen space one authored grid unit occupies. The unit-cube geometry
// is laid out once at this size; every dimension after that is scale3d over it.
export const UNIT_SIZE = 120;

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
export const resolveTriple = (
	element: Element,
	shorthand: string,
	specific: readonly [string, string, string],
	fallback: number,
): [number, number, number] => {
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

export type Vector3 = [number, number, number];

const SIZE_SPECIFIC = ["width", "height", "depth"] as const;
const HALF_UNIT = UNIT_SIZE / 2;

// CSS single-axis rotations in screen-px space (the same space the block lays its
// faces out in). Applied right-to-left they reproduce the block's own
// `rotateX(...) rotateY(...) rotateZ(...)`, so the corners we derive land exactly
// where the browser paints them.
const rotateAxisX = ([x, y, z]: Vector3, sin: number, cos: number): Vector3 => [
	x,
	cos * y - sin * z,
	sin * y + cos * z,
];
const rotateAxisY = ([x, y, z]: Vector3, sin: number, cos: number): Vector3 => [
	cos * x + sin * z,
	y,
	-sin * x + cos * z,
];
const rotateAxisZ = ([x, y, z]: Vector3, sin: number, cos: number): Vector3 => [
	cos * x - sin * y,
	sin * x + cos * y,
	z,
];

// The eight corners of a block in screen-px world space, read from its LIVE
// transform: position/rotation come from the resolved --block-* custom properties
// (so an in-flight inline drag override is honoured, not only the committed
// attribute), size from the authored attribute (it never changes during a drag).
// Mirrors the bridge in scene-cube, where +Y is already negated into --block-y, so
// no sign juggling is needed here — we read the values the faces themselves use.
export const blockCornersPx = (block: Element): Vector3[] => {
	const style = getComputedStyle(block as HTMLElement);
	const readVar = (name: string): number => {
		const value = parseFloat(style.getPropertyValue(name));
		return Number.isNaN(value) ? 0 : value;
	};
	const translate: Vector3 = [
		readVar("--block-x"),
		readVar("--block-y"),
		readVar("--block-z"),
	];
	const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;
	const angleX = toRadians(readVar("--block-rotate-x"));
	const angleY = toRadians(readVar("--block-rotate-y"));
	const angleZ = toRadians(readVar("--block-rotate-z"));
	const [width, height, depth] = resolveTriple(block, "size", SIZE_SPECIFIC, 1);
	const half: Vector3 = [width * HALF_UNIT, height * HALF_UNIT, depth * HALF_UNIT];

	const [sinX, cosX] = [Math.sin(angleX), Math.cos(angleX)];
	const [sinY, cosY] = [Math.sin(angleY), Math.cos(angleY)];
	const [sinZ, cosZ] = [Math.sin(angleZ), Math.cos(angleZ)];

	const corners: Vector3[] = [];
	for (const signX of [-1, 1]) {
		for (const signY of [-1, 1]) {
			for (const signZ of [-1, 1]) {
				let corner: Vector3 = [
					signX * half[0],
					signY * half[1],
					signZ * half[2],
				];
				corner = rotateAxisZ(corner, sinZ, cosZ);
				corner = rotateAxisY(corner, sinY, cosY);
				corner = rotateAxisX(corner, sinX, cosX);
				corners.push([
					corner[0] + translate[0],
					corner[1] + translate[1],
					corner[2] + translate[2],
				]);
			}
		}
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
