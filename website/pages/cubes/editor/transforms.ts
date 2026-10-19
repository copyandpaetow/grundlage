import {
	blockTransformFromAttributes,
	eulerFromMatrix,
	fromScreenPoint,
	rotationMatrix,
	toScreenPoint,
	type Vector3,
} from "../scene-shared";

// Vector and transform helpers the editor's subsystems share. The matrix maths itself
// lives in scene-shared, because the gizmo composes transforms the same way when it
// drives its direct child.

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
	blockTransformFromAttributes(block).position;

export const readRotation = (block: Element): Vector3 =>
	blockTransformFromAttributes(block).rotation;

// Lift a child's authored position and rotation out of a parent's local space into world
// space: push the position through the parent FRAME and compose the rotation with the
// parent's BY MATRIX, so it is correct for any parent rotation, not only yaw. Shared by
// ungroup (parent = group) and flatten (parent = cage); each caller applies its own
// snapping policy to the raw result.
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
