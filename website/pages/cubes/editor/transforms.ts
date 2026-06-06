import {
	eulerFromMatrix,
	fromScreenPoint,
	resolveBlockTransform,
	rotationMatrix,
	toScreenPoint,
	type Vector3,
} from "../scene-shared";

// Small vector + transform helpers the editor's subsystems share. The matrix maths
// itself (toScreenPoint / fromScreenPoint / frameMatrix / rotationMatrix /
// eulerFromMatrix) lives in scene-shared — the gizmo composes transforms with the same
// maths when it drives its direct child; here we only build on it.

export const addVectors = (a: Vector3, b: Vector3): Vector3 => [
	a[0] + b[0],
	a[1] + b[1],
	a[2] + b[2],
];

export const subtractVectors = (a: Vector3, b: Vector3): Vector3 => [
	a[0] - b[0],
	a[1] - b[1],
	a[2] - b[2],
];

export const readPosition = (block: Element): Vector3 =>
	resolveBlockTransform(block).position;

export const readRotation = (block: Element): Vector3 =>
	resolveBlockTransform(block).rotation;

// Drop a block's in-flight inline transform override so it falls back to its authored
// --block-* (set once the committed attribute has re-rendered — see commitBlockRender).
export const clearLiveTransform = (block: HTMLElement): void => {
	block.style.removeProperty("--block-x");
	block.style.removeProperty("--block-y");
	block.style.removeProperty("--block-z");
};

// Lift a child's authored position+rotation out of a parent's local space into world
// space: push its position through the parent FRAME and compose its rotation with the
// parent's rotation BY MATRIX. Shared by ungroup (parent = group) and flatten (parent =
// cage) — correct for any parent rotation, not only yaw. The raw result is returned;
// each caller applies its own snapping/rounding policy.
export const liftThroughFrame = (
	child: Element,
	frame: DOMMatrix,
	parentRotation: DOMMatrix,
): { position: Vector3; rotation: Vector3 } => ({
	position: fromScreenPoint(
		frame.transformPoint(toScreenPoint(readPosition(child))),
	),
	rotation: eulerFromMatrix(
		parentRotation.multiply(rotationMatrix(readRotation(child))),
	),
});
