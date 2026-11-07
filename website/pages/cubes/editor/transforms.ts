import { blockTransformFromAttributes, type Vector3 } from "../scene-shared";
import { eulerFromMatrix, fromScreenPoint, rotationMatrix, toScreenPoint } from "../scene-geometry";

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

// Rotations compose by matrix, so any parent rotation lifts correctly, not only a yaw.
// Unsnapped: each caller applies its own snapping.
export const liftThroughFrame = (
	child: Element,
	frame: DOMMatrix,
	parentRotation: DOMMatrix,
): { position: Vector3; rotation: Vector3 } => ({
	position: fromScreenPoint(frame.transformPoint(toScreenPoint(readPosition(child)))),
	rotation: eulerFromMatrix(parentRotation.multiply(rotationMatrix(readRotation(child)))),
});
