import { prop, type Resolve } from "../../../lib/src";

// Geometry constants and the authoring contract shared by every scene element:
// attributes are the committed, serializable state; --block-* variables are the
// render state.

// Screen px one authored grid unit occupies. Geometry is laid out once at this size
// and every dimension after that is scale3d over it.
export const UNIT_SIZE = 120;
export const HALF_UNIT = UNIT_SIZE / 2;
export const GRID_SNAP = 0.5;

// The placement floor spans this many cells either side of the origin.
export const GROUND_HALF_UNITS = 20;
export const GROUND_SIZE = GROUND_HALF_UNITS * 2 * UNIT_SIZE;

export type Vector3 = [number, number, number];

export const snapToGrid = (value: number): number =>
	Math.round(value / GRID_SNAP) * GRID_SNAP;

// Exported markup reads `2` and `1.5`, never `2.000000001`, `1.50` or `-0`.
export const formatNumber = (value: number): string => {
	const rounded = Math.round(value * 1000) / 1000;
	return Object.is(rounded, -0) ? "0" : String(rounded);
};

// --- the authoring contract --------------------------------------------------

// A shorthand triple: one value seeds every axis, three map to x/y/z, missing axes
// take the fallback. Never refuses, so malformed markup keeps the element rendering.
const asTriple =
	(fallback: number): Resolve<Vector3> =>
	(incoming) => {
		if (Array.isArray(incoming))
			return [
				incoming[0] ?? fallback,
				incoming[1] ?? fallback,
				incoming[2] ?? fallback,
			];
		const values = String(incoming)
			.trim()
			.split(/\s+/)
			.filter((token) => token !== "")
			.map(Number);
		if (values.length === 1) return [values[0], values[0], values[0]];
		return [
			values[0] ?? fallback,
			values[1] ?? fallback,
			values[2] ?? fallback,
		];
	};

const asSizeTriple = asTriple(1);
const asOriginTriple = asTriple(0);

const sizeProps = {
	size: prop.attribute(asSizeTriple, [1, 1, 1]),
	width: prop.optional(prop.attribute(Number)),
	height: prop.optional(prop.attribute(Number)),
	depth: prop.optional(prop.attribute(Number)),
};

const positionProps = {
	position: prop.attribute(asOriginTriple, [0, 0, 0]),
	x: prop.optional(prop.attribute(Number)),
	y: prop.optional(prop.attribute(Number)),
	z: prop.optional(prop.attribute(Number)),
};

const rotationProps = {
	rotation: prop.attribute(asOriginTriple, [0, 0, 0]),
	"rotate-x": prop.optional(prop.attribute(Number)),
	"rotate-y": prop.optional(prop.attribute(Number)),
	"rotate-z": prop.optional(prop.attribute(Number)),
};

// Declaring these is what makes a scene element react to its own markup: a plain
// setAttribute re-renders it, so the editor writes attributes and awaits the paint
// rather than driving every render by hand.
export const geometryProps = {
	...sizeProps,
	...positionProps,
	...rotationProps,
};

export const carrierProps = {
	...positionProps,
	...rotationProps,
};

export const ghostProps = { ...positionProps };

export type BlockTransform = {
	size: Vector3;
	position: Vector3;
	rotation: Vector3;
};

type TransformProps = {
	readonly size?: Vector3;
	readonly width?: number;
	readonly height?: number;
	readonly depth?: number;
	readonly position?: Vector3;
	readonly x?: number;
	readonly y?: number;
	readonly z?: number;
	readonly rotation?: Vector3;
	readonly "rotate-x"?: number;
	readonly "rotate-y"?: number;
	readonly "rotate-z"?: number;
};

// A specific attribute overrides its own axis of the shorthand.
const resolveTriple = (
	shorthand: Vector3 | undefined,
	alongX: number | undefined,
	alongY: number | undefined,
	alongZ: number | undefined,
	fallback: number,
): Vector3 => {
	const seed = shorthand ?? [fallback, fallback, fallback];
	return [alongX ?? seed[0], alongY ?? seed[1], alongZ ?? seed[2]];
};

export const blockTransformFromProps = (
	props: TransformProps,
): BlockTransform => ({
	size: resolveTriple(props.size, props.width, props.height, props.depth, 1),
	position: resolveTriple(props.position, props.x, props.y, props.z, 0),
	rotation: resolveTriple(
		props.rotation,
		props["rotate-x"],
		props["rotate-y"],
		props["rotate-z"],
		0,
	),
});

const readTriple = (
	parse: Resolve<Vector3>,
	element: Element,
	name: string,
): Vector3 => parse(element.getAttribute(name) ?? "") as Vector3;

const readNumber = (element: Element, name: string): number | undefined => {
	const raw = element.getAttribute(name);
	if (raw === null || raw.trim() === "") return undefined;
	const parsed = Number(raw);
	return Number.isNaN(parsed) ? undefined : parsed;
};

// The editor authors markup, so it resolves transforms straight off attributes and
// works on elements whose definition never loaded.
export const blockTransformFromAttributes = (
	element: Element,
): BlockTransform =>
	blockTransformFromProps({
		size: readTriple(asSizeTriple, element, "size"),
		width: readNumber(element, "width"),
		height: readNumber(element, "height"),
		depth: readNumber(element, "depth"),
		position: readTriple(asOriginTriple, element, "position"),
		x: readNumber(element, "x"),
		y: readNumber(element, "y"),
		z: readNumber(element, "z"),
		rotation: readTriple(asOriginTriple, element, "rotation"),
		"rotate-x": readNumber(element, "rotate-x"),
		"rotate-y": readNumber(element, "rotate-y"),
		"rotate-z": readNumber(element, "rotate-z"),
	});

// The per-axis attributes an edit to a shorthand has to clear.
export const SIZE_SPECIFIC = ["width", "height", "depth"] as const;
export const POSITION_SPECIFIC = ["x", "y", "z"] as const;
export const ROTATION_SPECIFIC = ["rotate-x", "rotate-y", "rotate-z"] as const;

// --- render sequencing -------------------------------------------------------

// Make sure a scene element has rendered, and resolve once it has, so a following
// measure sees the committed attribute rather than the value it replaced. An attribute write has already scheduled the pass and this coalesces onto
// it; a content change has not, and this is what triggers it. Resolves straight away
// for an element whose definition never loaded.
export const sceneElementRendered = (element: HTMLElement): Promise<void> => {
	const update = (element as Partial<{ update: () => Promise<void> }>).update;
	return typeof update === "function"
		? update.call(element)
		: Promise.resolve();
};

// --- selection and bounds ----------------------------------------------------

// Scene elements that carry a --block-* transform: the one selectable, boundable set.
export const BLOCK_TAGS = new Set([
	"scene-cube",
	"scene-wall",
	"scene-ramp",
	"scene-group",
]);

export const isBlock = (node: Element): boolean =>
	BLOCK_TAGS.has(node.tagName.toLowerCase());

// The eight corners of a block in screen-px world space, read from the matrix the
// BROWSER resolved. getComputedStyle already composed translate · rotate · scale with
// the bridge's Y-negation baked in, so pushing the unit corners through it lands them
// exactly where the faces paint — no rotation re-derived by hand.
//
// That matrix is LOCAL, so bounding a block inside a rotated group composes: each
// recursion multiplies the parent's accumulated matrix by the child's local one.
// A leaf publishes its own PRE-scale half-extents as --block-extent-* (a thin wall
// bounds as a slab); the matrix already carries scale3d, so re-applying --block-scale-*
// would double it. A carrier has no extent and recurses into its blocks.
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

	const corners: Vector3[] = [];
	if (hasExtent) {
		const halfX = readExtent("--block-extent-x");
		const halfY = readExtent("--block-extent-y");
		const halfZ = readExtent("--block-extent-z");
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

	for (const child of Array.from(block.children)) {
		if (!isBlock(child)) continue;
		for (const corner of blockCornersPx(child, worldMatrix))
			corners.push(corner);
	}
	return corners;
};

export type Bounds = { center: Vector3; half: Vector3 };

// World-axis-aligned box around every block's eight corners. Unioning the actual
// rotated corners is what keeps it tight when a block is axis-aligned and grows it to
// wrap one turned corner-on. Null for an empty set so callers can hide their chrome.
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

// --- world / screen matrices -------------------------------------------------
// Euler angles do NOT compose by addition, so anything combining two rotations goes
// through these. Shared by the gizmo (driving its child) and the editor (flattening).

// Author space is +Y up, screen space +Y down; the bridge negates Y and so do we.
export const toScreenPoint = ([x, y, z]: Vector3): DOMPoint =>
	new DOMPoint(x * UNIT_SIZE, -y * UNIT_SIZE, z * UNIT_SIZE);

export const fromScreenPoint = (point: DOMPoint): Vector3 => [
	point.x / UNIT_SIZE,
	-point.y / UNIT_SIZE,
	point.z / UNIT_SIZE,
];

export const rotationMatrix = ([
	rotateX,
	rotateY,
	rotateZ,
]: Vector3): DOMMatrix =>
	new DOMMatrix(
		`rotateX(${rotateX}deg) rotateY(${rotateY}deg) rotateZ(${rotateZ}deg)`,
	);

// What a carrier contributes to its content, in the same order every :host writes it
// (carriers never scale). A child lifts into the carrier's frame through this.
export const frameMatrix = (position: Vector3, rotation: Vector3): DOMMatrix =>
	new DOMMatrix(
		`translate3d(${position[0] * UNIT_SIZE}px, ${-position[1] * UNIT_SIZE}px, ${
			position[2] * UNIT_SIZE
		}px) rotateX(${rotation[0]}deg) rotateY(${rotation[1]}deg) rotateZ(${
			rotation[2]
		}deg)`,
	);

// Decompose back into frameMatrix's rotateX·rotateY·rotateZ order so a round-trip is
// stable.
export const eulerFromMatrix = (matrix: DOMMatrix): Vector3 => {
	// transformPoint applies the FULL affine transform, so a matrix that also
	// translates would contaminate the basis: a translation of dx px makes zAxis.x = dx,
	// which asin clamps to ±90deg and decodes as a garbage rotation. Map the origin too
	// and subtract it to read the LINEAR part alone.
	const origin = matrix.transformPoint(new DOMPoint(0, 0, 0));
	const mapAxis = (x: number, y: number, z: number) => {
		const mapped = matrix.transformPoint(new DOMPoint(x, y, z));
		return {
			x: mapped.x - origin.x,
			y: mapped.y - origin.y,
			z: mapped.z - origin.z,
		};
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
	// Gimbal lock at ±90° pitch: X and Z couple, so fold the rotation into X.
	return [
		toDegrees(Math.atan2(sinPitch * xAxis.y, yAxis.y)),
		toDegrees(pitch),
		0,
	];
};
