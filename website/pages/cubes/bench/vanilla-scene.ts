import { startSceneCulling } from "../scene-culling";
import { createWorldChunks } from "./vanilla-chunks";
import { UNIT_SIZE } from "../unit-size";

//The grundlage scene as light-DOM divs, so the gap between the two is what the library and
//the editor cost. It never imports grundlage, so neither does its page.

//Mirrors scene-camera, so a step or a turn moves the view as far as there
const MOVE_PIXELS_PER_FRAME = 12;
const LOOK_DEGREES_PER_PIXEL = 0.18;
const MAX_PITCH = 89;

//Mirrors scene-world: non-inheriting, so a camera frame restyles the world alone. The
//first registration on a page stands; scene-world may have made it already.
for (const name of ["x", "y", "z", "perspective", "orbit-radius"]) {
	try {
		CSS.registerProperty({
			name: `--camera-${name}`,
			syntax: "<length>",
			inherits: false,
			initialValue: "0px",
		});
	} catch {}
}
for (const name of ["yaw", "pitch"]) {
	try {
		CSS.registerProperty({
			name: `--camera-${name}`,
			syntax: "<angle>",
			inherits: false,
			initialValue: "0deg",
		});
	} catch {}
}

const FACE_NAMES = ["front", "back", "right", "left", "top", "bottom"] as const;

const CAMERA_VARIABLE_NAMES = ["x", "y", "z", "yaw", "pitch", "perspective", "orbit-radius"];

const cameraTransform = `translateZ(var(--camera-perspective))
	translateZ(calc(var(--camera-orbit-radius) * -1))
	rotateX(calc(var(--camera-pitch) * -1))
	rotateY(calc(var(--camera-yaw) * -1))
	translate3d(
		calc(var(--camera-x) * -1),
		calc(var(--camera-y) * -1),
		calc(var(--camera-z) * -1)
	)`;

const sceneStyles = `
	.vanilla-world-host {
		display: block;
		position: relative;
		width: 100%;
		height: 70vh;
		overflow: hidden;
		border: 1px solid rgba(255, 255, 255, 0.12);
		background: radial-gradient(circle at 50% 30%, #2a2f3a, #14161c);
		perspective: var(--camera-perspective);
		perspective-origin: 50% 50%;
	}
	.vanilla-world {
		--camera-perspective: inherit;
		position: absolute;
		inset: 0;
		transform-style: preserve-3d;
		transform-origin: 50% 50%;
		/* Like scene-world: the flat sheet would shadow every cube, so only faces take clicks */
		pointer-events: none;
		transform: ${cameraTransform};
	}
	/* Chunked, the world is flat and holds the one perspective; every chunk fills the same
	   box and repeats the camera, so all chunks project alike, each in its own 3D context.
	   Chunks paint in z-index order, back to front. */
	.vanilla-world.chunked {
		transform: none;
		transform-style: flat;
		perspective: var(--camera-perspective);
		perspective-origin: 50% 50%;
	}
	.vanilla-chunk {
		${CAMERA_VARIABLE_NAMES.map((name) => `--camera-${name}: inherit;`).join("\n\t\t")}
		position: absolute;
		inset: 0;
		transform-style: preserve-3d;
		transform-origin: 50% 50%;
		pointer-events: none;
		transform: ${cameraTransform};
	}
	.vanilla-cube,
	.vanilla-cage,
	.vanilla-cage-box {
		position: absolute;
		top: 50%;
		left: 50%;
		transform-style: preserve-3d;
	}
	/* What scene-culling reads to bound a cube */
	.vanilla-cube {
		--block-extent-x: ${UNIT_SIZE / 2}px;
		--block-extent-y: ${UNIT_SIZE / 2}px;
		--block-extent-z: ${UNIT_SIZE / 2}px;
	}
	.vanilla-edge {
		position: absolute;
		top: 50%;
		left: 50%;
		box-sizing: border-box;
		border: 2px dashed rgba(120, 220, 255, 0.95);
		background: rgba(120, 220, 255, 0.08);
	}
`;

const cubeContentStyles = `
	.vanilla-body {
		position: absolute;
		transform-style: preserve-3d;
		transform: scale3d(1, 1, 1);
	}
	.vanilla-face {
		position: absolute;
		top: 50%;
		left: 50%;
		width: ${UNIT_SIZE}px;
		height: ${UNIT_SIZE}px;
		margin: ${-UNIT_SIZE / 2}px 0 0 ${-UNIT_SIZE / 2}px;
		box-sizing: border-box;
		border: 1px solid rgba(0, 0, 0, 0.35);
		display: grid;
		place-items: center;
		font: 600 14px/1 system-ui, sans-serif;
		color: rgba(0, 0, 0, 0.7);
		backface-visibility: hidden;
		pointer-events: auto;
	}
	.vanilla-face.front { transform: translateZ(${UNIT_SIZE / 2}px); background: #f6c945; }
	.vanilla-face.back { transform: rotateY(180deg) translateZ(${UNIT_SIZE / 2}px); background: #e8923b; }
	.vanilla-face.right { transform: rotateY(90deg) translateZ(${UNIT_SIZE / 2}px); background: #4fa6e0; }
	.vanilla-face.left { transform: rotateY(-90deg) translateZ(${UNIT_SIZE / 2}px); background: #5fc2a8; }
	.vanilla-face.top { transform: rotateX(90deg) translateZ(${UNIT_SIZE / 2}px); background: #b98cd6; }
	.vanilla-face.bottom { transform: rotateX(-90deg) translateZ(${UNIT_SIZE / 2}px); background: #d96c8a; }
`;

const cullingStyles = `
	.vanilla-cube:is([outside-view], [occluded]) > .vanilla-body { display: none; }
	${FACE_NAMES.map((faceName) => `.vanilla-cube[hidden-faces~="${faceName}"] > .vanilla-body > .${faceName}`).join(",\n")} { display: none; }
`;

const createCubeBody = (): HTMLElement => {
	const body = document.createElement("div");
	body.className = "vanilla-body";
	for (const faceName of FACE_NAMES) {
		const face = document.createElement("div");
		face.className = `vanilla-face ${faceName}`;
		face.textContent = faceName;
		body.appendChild(face);
	}
	return body;
};

export type VanillaScene = {
	root: HTMLElement;
	world: HTMLElement;
	//One frame's step in camera space, each axis -1, 0 or 1: [right, up, forward]
	moveCamera: (alongRight: number, alongUp: number, alongForward: number) => void;
	turnCamera: (movementX: number, movementY: number) => void;
	selectCubes: (cubes: readonly HTMLElement[]) => void;
	selectedCubes: () => readonly HTMLElement[];
	moveSelection: (offsetPixels: number) => void;
	releaseSelection: () => void;
	stopCulling: () => void;
};

const createCube = ([x, y, z]: readonly number[]): HTMLElement => {
	const cube = document.createElement("div");
	cube.className = "vanilla-cube";
	cube.style.transform = `translate3d(${x * UNIT_SIZE}px, ${-y * UNIT_SIZE}px, ${z * UNIT_SIZE}px)`;
	cube.appendChild(createCubeBody());
	return cube;
};

const createCageBox = (cubes: readonly HTMLElement[]): HTMLElement => {
	const placements = cubes.map((cube) => new DOMMatrix(cube.style.transform));
	const halfUnit = UNIT_SIZE / 2;
	const minimumOf = (axis: "m41" | "m42" | "m43") =>
		Math.min(...placements.map((matrix) => matrix[axis])) - halfUnit;
	const maximumOf = (axis: "m41" | "m42" | "m43") =>
		Math.max(...placements.map((matrix) => matrix[axis])) + halfUnit;
	const [minimumX, minimumY, minimumZ] = [minimumOf("m41"), minimumOf("m42"), minimumOf("m43")];
	const halfX = (maximumOf("m41") - minimumX) / 2;
	const halfY = (maximumOf("m42") - minimumY) / 2;
	const halfZ = (maximumOf("m43") - minimumZ) / 2;
	const box = document.createElement("div");
	box.className = "vanilla-cage-box";
	box.style.transform = `translate3d(${minimumX + halfX}px, ${minimumY + halfY}px, ${minimumZ + halfZ}px)`;
	const edges: [number, number, string][] = [
		[halfX, halfY, `translateZ(${halfZ}px)`],
		[halfX, halfY, `translateZ(${-halfZ}px)`],
		[halfZ, halfY, `rotateY(90deg) translateZ(${halfX}px)`],
		[halfZ, halfY, `rotateY(-90deg) translateZ(${halfX}px)`],
		[halfX, halfZ, `rotateX(90deg) translateZ(${halfY}px)`],
		[halfX, halfZ, `rotateX(-90deg) translateZ(${halfY}px)`],
	];
	for (const [halfWidth, halfHeight, transform] of edges) {
		const edge = document.createElement("div");
		edge.className = "vanilla-edge";
		edge.style.width = `${halfWidth * 2}px`;
		edge.style.height = `${halfHeight * 2}px`;
		edge.style.margin = `${-halfHeight}px 0 0 ${-halfWidth}px`;
		edge.style.transform = transform;
		box.appendChild(edge);
	}
	return box;
};

//Spike: the drag carrier sorts as one more chunk, painted above all others, so it shows
//through nearer cubes while it is held.
const DRAG_CARRIER_PAINT_ORDER = 1_000_000;

//oxlint-disable-next-line max-lines-per-function -- long, not complex: builds the scene, then one small function per command
export const createVanillaScene = (
	cubePositions: readonly (readonly number[])[],
	chunkEdge: number | null = null,
): VanillaScene => {
	const root = document.createElement("div");
	root.className = "vanilla-scene";
	const style = document.createElement("style");
	style.textContent = sceneStyles + cubeContentStyles + cullingStyles;
	const worldHost = document.createElement("div");
	worldHost.className = "vanilla-world-host";
	const world = document.createElement("div");
	world.className = "vanilla-world";
	const worldChunks =
		chunkEdge === null ? null : createWorldChunks(world, cubePositions, chunkEdge);
	if (worldChunks !== null) world.classList.add("chunked");
	for (const position of cubePositions) {
		const cube = createCube(position);
		const [x, y, z] = position;
		if (worldChunks === null) world.appendChild(cube);
		else {
			worldChunks.chunkAt(x * UNIT_SIZE, -y * UNIT_SIZE, z * UNIT_SIZE).element.appendChild(cube);
		}
	}
	worldHost.appendChild(world);
	root.append(style, worldHost);

	//scene-camera's starting view and scene-world's default perspective. The camera writes
	//on the world itself, where scene-culling reads it.
	const camera = { x: 0, y: -160, z: 600, yaw: 0, pitch: 0 };
	const writeCameraVariables = (): void => {
		const worldStyle = world.style;
		worldStyle.setProperty("--camera-x", `${camera.x}px`);
		worldStyle.setProperty("--camera-y", `${camera.y}px`);
		worldStyle.setProperty("--camera-z", `${camera.z}px`);
		worldStyle.setProperty("--camera-yaw", `${camera.yaw}deg`);
		worldStyle.setProperty("--camera-pitch", `${camera.pitch}deg`);
		worldStyle.setProperty("--camera-orbit-radius", "0px");
		worldChunks?.sortForEye(camera.x, camera.y, camera.z);
	};
	worldHost.style.setProperty("--camera-perspective", "800px");
	writeCameraVariables();
	const stopCulling = startSceneCulling(world, ".vanilla-cube", ".vanilla-cage", "[see-through]");

	let dragCarrierChunk: HTMLElement | null = null;
	if (worldChunks !== null) {
		dragCarrierChunk = document.createElement("div");
		dragCarrierChunk.className = "vanilla-chunk";
		dragCarrierChunk.setAttribute("world-chunk", "");
		dragCarrierChunk.style.zIndex = `${DRAG_CARRIER_PAINT_ORDER}`;
		world.appendChild(dragCarrierChunk);
	}
	let cage: HTMLElement | null = null;
	let selection: readonly HTMLElement[] = [];
	let selectionOffsetPixels = 0;

	const releaseSelection = (): void => {
		if (cage === null) return;
		for (const cube of selection) {
			const placement = new DOMMatrix(cube.style.transform);
			const releasedX = placement.m41 + selectionOffsetPixels;
			cube.style.transform = `translate3d(${releasedX}px, ${placement.m42}px, ${placement.m43}px)`;
			if (worldChunks !== null) {
				worldChunks.chunkAt(releasedX, placement.m42, placement.m43).element.appendChild(cube);
			}
		}
		if (worldChunks === null) world.append(...selection);
		cage.remove();
		cage = null;
		selection = [];
		selectionOffsetPixels = 0;
	};

	return {
		root,
		world,
		//scene-camera's heading: forward is rotateY(yaw)·(0,0,-1), right is rotateY(yaw)·(1,0,0)
		moveCamera: (alongRight, alongUp, alongForward) => {
			const yawRadians = (camera.yaw * Math.PI) / 180;
			camera.x +=
				MOVE_PIXELS_PER_FRAME *
				(alongRight * Math.cos(yawRadians) - alongForward * Math.sin(yawRadians));
			camera.z +=
				MOVE_PIXELS_PER_FRAME *
				(-alongRight * Math.sin(yawRadians) - alongForward * Math.cos(yawRadians));
			camera.y -= MOVE_PIXELS_PER_FRAME * alongUp;
			writeCameraVariables();
		},
		turnCamera: (movementX, movementY) => {
			camera.yaw -= movementX * LOOK_DEGREES_PER_PIXEL;
			camera.pitch = Math.max(
				-MAX_PITCH,
				Math.min(MAX_PITCH, camera.pitch + movementY * LOOK_DEGREES_PER_PIXEL),
			);
			writeCameraVariables();
		},
		selectCubes: (cubes) => {
			releaseSelection();
			if (cubes.length === 0) return;
			selection = cubes;
			cage = document.createElement("div");
			cage.className = "vanilla-cage";
			cage.appendChild(createCageBox(cubes));
			cage.append(...cubes);
			(dragCarrierChunk ?? world).appendChild(cage);
		},
		selectedCubes: () => selection,
		moveSelection: (offsetPixels) => {
			if (cage === null) throw new Error("Select cubes before moving the selection.");
			selectionOffsetPixels = offsetPixels;
			cage.style.transform = `translateX(${offsetPixels}px)`;
		},
		releaseSelection,
		stopCulling,
	};
};
