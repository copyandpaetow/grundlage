//The CSS perspective is the focal length
export type View = {
	cameraX: number;
	cameraY: number;
	cameraZ: number;
	yawSine: number;
	yawCosine: number;
	pitchSine: number;
	pitchCosine: number;
	orbitRadius: number;
	perspective: number;
	halfWidth: number;
	halfHeight: number;
};

//A world point in camera space: x right, y down, depth away from the eye.
export type ViewPoint = { x: number; y: number; depth: number };

//view = Rx(-pitch) · Ry(-yaw) · (point - camera), as scene-world's transform applies it.
//The world backs off by the orbit radius before it rotates, so depth = orbitRadius - view.z.
//Writes into `viewPoint`, so a frame's thousands of corners allocate nothing.
export const writeViewPoint = (
	view: View,
	worldX: number,
	worldY: number,
	worldZ: number,
	viewPoint: ViewPoint,
): void => {
	const offsetX = worldX - view.cameraX;
	const offsetY = worldY - view.cameraY;
	const offsetZ = worldZ - view.cameraZ;
	const yawedZ = offsetX * view.yawSine + offsetZ * view.yawCosine;
	viewPoint.x = offsetX * view.yawCosine - offsetZ * view.yawSine;
	viewPoint.y = offsetY * view.pitchCosine + yawedZ * view.pitchSine;
	viewPoint.depth = view.orbitRadius - (-offsetY * view.pitchSine + yawedZ * view.pitchCosine);
};

export const createView = (): View => ({
	cameraX: 0,
	cameraY: 0,
	cameraZ: 0,
	yawSine: 0,
	yawCosine: 1,
	pitchSine: 0,
	pitchCosine: 1,
	orbitRadius: 0,
	perspective: 0,
	halfWidth: 0,
	halfHeight: 0,
});
