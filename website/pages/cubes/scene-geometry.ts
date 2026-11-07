import { UNIT_SIZE } from "./unit-size";
import type { Vector3 } from "./scene-shared";

// Measuring and composing block transforms in JS, where CSS cannot: bounds need the union
// of children's boxes, and combining two rotations needs matrices.

export const BLOCK_TAGS = new Set(["scene-cube", "scene-wall", "scene-ramp", "scene-group"]);

export const isBlock = (node: Element): boolean => BLOCK_TAGS.has(node.tagName.toLowerCase());

// The eight corners of a block and of every block inside it, in screen-px world space:
//   world = accumulated · local, corner = world · (±extentX, ±extentY, ±extentZ)
// `local` is the browser's computed transform, Y negation included, so corners land where
// the faces paint. Extents come from --block-extent-*, because size scales only the .body,
// never the matrix children inherit.
export const blockCornersPx = (
	block: Element,
	accumulated: DOMMatrix = new DOMMatrix(),
): Vector3[] => {
	const style = getComputedStyle(block as HTMLElement);
	const transform = style.transform;
	const local =
		transform === "" || transform === "none" ? new DOMMatrix() : new DOMMatrix(transform);
	const worldMatrix = accumulated.multiply(local);

	const readExtent = (name: string): number => {
		const value = parseFloat(style.getPropertyValue(name));
		return Number.isNaN(value) ? 0 : value;
	};
	// Registered, so a group reads the 0px initial value rather than nothing.
	const halfX = readExtent("--block-extent-x");

	const corners: Vector3[] = [];
	if (halfX > 0) {
		const halfY = readExtent("--block-extent-y");
		const halfZ = readExtent("--block-extent-z");
		// Corner bit 0 picks +x, bit 1 +y, bit 2 +z, as in scene-culling
		for (let cornerIndex = 0; cornerIndex < 8; cornerIndex++) {
			const point = worldMatrix.transformPoint(
				new DOMPoint(
					cornerIndex & 1 ? halfX : -halfX,
					cornerIndex & 2 ? halfY : -halfY,
					cornerIndex & 4 ? halfZ : -halfZ,
				),
			);
			corners.push([point.x, point.y, point.z]);
		}
	}

	for (const child of Array.from(block.children)) {
		if (!isBlock(child)) continue;
		for (const corner of blockCornersPx(child, worldMatrix)) corners.push(corner);
	}
	return corners;
};

export type Bounds = { center: Vector3; half: Vector3 };

// Null for an empty set, so callers can hide their chrome
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
		center: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2],
		half: [(max[0] - min[0]) / 2, (max[1] - min[1]) / 2, (max[2] - min[2]) / 2],
	};
};

// Euler angles do not compose by addition, so combining two rotations goes through these

// Author space is +Y up, screen space +Y down; the bridge negates Y and so do we.
export const toScreenPoint = ([x, y, z]: Vector3): DOMPoint =>
	new DOMPoint(x * UNIT_SIZE, -y * UNIT_SIZE, z * UNIT_SIZE);

export const fromScreenPoint = (point: DOMPoint): Vector3 => [
	point.x / UNIT_SIZE,
	-point.y / UNIT_SIZE,
	point.z / UNIT_SIZE,
];

export const rotationMatrix = ([rotateX, rotateY, rotateZ]: Vector3): DOMMatrix =>
	new DOMMatrix(`rotateX(${rotateX}deg) rotateY(${rotateY}deg) rotateZ(${rotateZ}deg)`);

// What a block contributes to its children, in the same order every :host writes it
// (size scales only the .body). A child lifts into the parent's frame through this.
export const frameMatrix = (position: Vector3, rotation: Vector3): DOMMatrix =>
	new DOMMatrix(
		`translate3d(${position[0] * UNIT_SIZE}px, ${-position[1] * UNIT_SIZE}px, ${
			position[2] * UNIT_SIZE
		}px) rotateX(${rotation[0]}deg) rotateY(${rotation[1]}deg) rotateZ(${rotation[2]}deg)`,
	);

// Decomposes R = Rx(a)·Ry(b)·Rz(c), frameMatrix's order, so a round trip is stable. With
// the mapped axes x = R·(1,0,0), y = R·(0,1,0), z = R·(0,0,1):
//   b = asin(z.x), a = atan2(-z.y, z.z), c = atan2(-y.x, x.x)
export const eulerFromMatrix = (matrix: DOMMatrix): Vector3 => {
	// transformPoint applies the translation too, which would leak into the axes;
	// subtracting the mapped origin leaves the rotation alone.
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
	return [toDegrees(Math.atan2(sinPitch * xAxis.y, yAxis.y)), toDegrees(pitch), 0];
};
