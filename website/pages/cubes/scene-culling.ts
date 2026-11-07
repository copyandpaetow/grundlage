// Hides what the camera cannot see, so Chrome composites fewer layers. Each verdict is an
// attribute written only when it flips. Every cube occludes unless it matches the
// see-through selector, because face styles are the author's to choose.
// A cube's stylesheet hides only its body, so the cube stays measurable and its child blocks
// keep their own verdicts. Cubes under a drag carrier stay whole: the carrier's CSS
// transform never reaches JS.

import { createOcclusionGrid } from "./scene-occlusion";
import { createView, type View, type ViewPoint, writeViewPoint } from "./scene-view";

const FACE_NAMES = ["front", "back", "right", "left", "top", "bottom"] as const;

type CulledCube = {
	cube: HTMLElement;
	// The world-to-cube matrix, column-major like DOMMatrix's m11…m44
	worldToCube: Float64Array;
	extentX: number;
	extentY: number;
	extentZ: number;
	centerX: number;
	centerY: number;
	centerZ: number;
	boundingRadius: number;
	// Bit i hides FACE_NAMES[i]
	hiddenFaceMask: number;
	isOutsideView: boolean;
	// Eight corners in world space, x y z each; corner bit 0 picks +x, bit 1 +y, bit 2 +z
	worldCorners: Float64Array;
	isSeeThrough: boolean;
	isOccluded: boolean;
};

const NO_FACE_HIDDEN = 0;

const CAMERA_ATTRIBUTE_NAMES = [
	"camera-x",
	"camera-y",
	"camera-z",
	"camera-yaw",
	"camera-pitch",
	"camera-orbit-radius",
];

const cubeToWorldMatrix = (cube: HTMLElement, world: HTMLElement): DOMMatrix => {
	const matrix = new DOMMatrix();
	// A world chunk repeats the camera transform, so world space ends there too
	for (
		let element: HTMLElement | null = cube;
		element !== null && element !== world && !element.hasAttribute("world-chunk");
		element = element.parentElement
	) {
		const transform = getComputedStyle(element).transform;
		if (transform !== "none") matrix.preMultiplySelf(new DOMMatrix(transform));
	}
	return matrix;
};

// Null while the cube has not rendered yet: its extents still read the registered 0px.
const measureCulledCube = (
	cube: HTMLElement,
	world: HTMLElement,
	seeThroughSelector: string,
): CulledCube | null => {
	const style = getComputedStyle(cube);
	const extentX = parseFloat(style.getPropertyValue("--block-extent-x"));
	const extentY = parseFloat(style.getPropertyValue("--block-extent-y"));
	const extentZ = parseFloat(style.getPropertyValue("--block-extent-z"));
	if (!(extentX > 0 && extentY > 0 && extentZ > 0)) return null;
	const cubeToWorld = cubeToWorldMatrix(cube, world);
	// Extents are local, so the radius takes the matrix's largest axis scale
	const largestAxisScale = Math.max(
		Math.hypot(cubeToWorld.m11, cubeToWorld.m12, cubeToWorld.m13),
		Math.hypot(cubeToWorld.m21, cubeToWorld.m22, cubeToWorld.m23),
		Math.hypot(cubeToWorld.m31, cubeToWorld.m32, cubeToWorld.m33),
	);
	const worldCorners = new Float64Array(24);
	for (let cornerIndex = 0; cornerIndex < 8; cornerIndex++) {
		const corner = cubeToWorld.transformPoint({
			x: cornerIndex & 1 ? extentX : -extentX,
			y: cornerIndex & 2 ? extentY : -extentY,
			z: cornerIndex & 4 ? extentZ : -extentZ,
		});
		worldCorners[cornerIndex * 3] = corner.x;
		worldCorners[cornerIndex * 3 + 1] = corner.y;
		worldCorners[cornerIndex * 3 + 2] = corner.z;
	}
	return {
		cube,
		worldToCube: cubeToWorld.inverse().toFloat64Array(),
		worldCorners,
		isSeeThrough: cube.matches(seeThroughSelector),
		isOccluded: false,
		extentX,
		extentY,
		extentZ,
		centerX: cubeToWorld.m41,
		centerY: cubeToWorld.m42,
		centerZ: cubeToWorld.m43,
		boundingRadius: Math.hypot(extentX, extentY, extentZ) * largestAxisScale,
		hiddenFaceMask: NO_FACE_HIDDEN,
		isOutsideView: false,
	};
};

type Eye = { x: number; y: number; z: number };

// The eye in cube space, local = worldToCube · eye, against each face plane
const hiddenFaceMaskOf = (culledCube: CulledCube, eye: Eye): number => {
	const matrix = culledCube.worldToCube;
	const localX = matrix[0] * eye.x + matrix[4] * eye.y + matrix[8] * eye.z + matrix[12];
	const localY = matrix[1] * eye.x + matrix[5] * eye.y + matrix[9] * eye.z + matrix[13];
	const localZ = matrix[2] * eye.x + matrix[6] * eye.y + matrix[10] * eye.z + matrix[14];
	// A face shows only while the eye is outside its plane. Screen +Y is down, so the
	// top face sits at -extentY.
	let mask = NO_FACE_HIDDEN;
	if (localZ <= culledCube.extentZ) mask |= 1 << 0;
	if (localZ >= -culledCube.extentZ) mask |= 1 << 1;
	if (localX <= culledCube.extentX) mask |= 1 << 2;
	if (localX >= -culledCube.extentX) mask |= 1 << 3;
	if (localY >= -culledCube.extentY) mask |= 1 << 4;
	if (localY <= culledCube.extentY) mask |= 1 << 5;
	return mask;
};

const hiddenFacesAttributeOf = (mask: number): string =>
	FACE_NAMES.filter((_, faceIndex) => (mask & (1 << faceIndex)) !== 0).join(" ");

// Each side plane passes through the eye. The right one has the normal
// (perspective, -halfWidth) / √(perspective² + halfWidth²) in (x, depth), so a sphere lies
// outside when (perspective·x - halfWidth·depth) / √(…) > radius.
const isSphereOutsideView = (view: View, center: ViewPoint, radius: number): boolean => {
	if (center.depth <= -radius) return true;
	const horizontalPlaneLength = Math.hypot(view.perspective, view.halfWidth);
	const verticalPlaneLength = Math.hypot(view.perspective, view.halfHeight);
	const horizontalReach = view.halfWidth * center.depth;
	const verticalReach = view.halfHeight * center.depth;
	return (
		view.perspective * center.x - horizontalReach > radius * horizontalPlaneLength ||
		-view.perspective * center.x - horizontalReach > radius * horizontalPlaneLength ||
		view.perspective * center.y - verticalReach > radius * verticalPlaneLength ||
		-view.perspective * center.y - verticalReach > radius * verticalPlaneLength
	);
};

const readCameraNumber = (world: HTMLElement, name: string): number =>
	parseFloat(world.getAttribute(`camera-${name}`) ?? "") || 0;

export const startSceneCulling = (
	world: HTMLElement,
	cubeSelector: string,
	dragCarrierSelector: string,
	seeThroughSelector: string,
): (() => void) => {
	let culledCubes: CulledCube[] = [];
	let isGeometryStale = true;
	// The viewport is written by the ResizeObserver and the perspective at remeasure, so a
	// camera frame forces no layout
	const view = createView();
	const viewPoint: ViewPoint = { x: 0, y: 0, depth: 0 };
	const occlusionGrid = createOcclusionGrid(view);

	const remeasure = (): void => {
		const cubes = world.querySelectorAll<HTMLElement>(cubeSelector);
		const previousByCube = new Map(culledCubes.map((culledCube) => [culledCube.cube, culledCube]));
		const measured: CulledCube[] = [];
		for (const cube of cubes) {
			if (cube.closest(dragCarrierSelector) !== null) {
				cube.removeAttribute("hidden-faces");
				cube.removeAttribute("outside-view");
				cube.removeAttribute("occluded");
				continue;
			}
			const culledCube = measureCulledCube(cube, world, seeThroughSelector);
			if (culledCube === null) return;
			const previous = previousByCube.get(cube);
			culledCube.hiddenFaceMask = previous?.hiddenFaceMask ?? NO_FACE_HIDDEN;
			culledCube.isOutsideView = previous?.isOutsideView ?? false;
			culledCube.isOccluded = previous?.isOccluded ?? false;
			measured.push(culledCube);
		}
		view.perspective = parseFloat(getComputedStyle(world).getPropertyValue("--camera-perspective"));
		culledCubes = measured;
		occlusionGrid.resizeCubeBuffers(measured.length);
		isGeometryStale = false;
	};

	const cull = (): void => {
		if (isGeometryStale) remeasure();
		const yawRadians = (readCameraNumber(world, "yaw") * Math.PI) / 180;
		const pitchRadians = (readCameraNumber(world, "pitch") * Math.PI) / 180;
		view.cameraX = readCameraNumber(world, "x");
		view.cameraY = readCameraNumber(world, "y");
		view.cameraZ = readCameraNumber(world, "z");
		view.yawSine = Math.sin(yawRadians);
		view.yawCosine = Math.cos(yawRadians);
		view.pitchSine = Math.sin(pitchRadians);
		view.pitchCosine = Math.cos(pitchRadians);
		view.orbitRadius = readCameraNumber(world, "orbit-radius");
		// The eye orbits the camera point: camera + r·(cos pitch·sin yaw, -sin pitch, cos pitch·cos yaw)
		const eye: Eye = {
			x: view.cameraX + view.orbitRadius * view.pitchCosine * view.yawSine,
			y: view.cameraY - view.orbitRadius * view.pitchSine,
			z: view.cameraZ + view.orbitRadius * view.pitchCosine * view.yawCosine,
		};
		const hasMeasuredViewport = view.halfWidth > 0;
		for (let cubeIndex = 0; cubeIndex < culledCubes.length; cubeIndex++) {
			const culledCube = culledCubes[cubeIndex];
			if (hasMeasuredViewport) {
				writeViewPoint(view, culledCube.centerX, culledCube.centerY, culledCube.centerZ, viewPoint);
				const isOutsideView = isSphereOutsideView(view, viewPoint, culledCube.boundingRadius);
				if (isOutsideView !== culledCube.isOutsideView) {
					culledCube.isOutsideView = isOutsideView;
					culledCube.cube.toggleAttribute("outside-view", isOutsideView);
				}
			}
			const mask = hiddenFaceMaskOf(culledCube, eye);
			if (mask === culledCube.hiddenFaceMask) continue;
			culledCube.hiddenFaceMask = mask;
			culledCube.cube.setAttribute("hidden-faces", hiddenFacesAttributeOf(mask));
		}
		if (hasMeasuredViewport) occlusionGrid.occlude(culledCubes);
	};

	const cameraObserver = new MutationObserver(cull);
	cameraObserver.observe(world, {
		attributes: true,
		attributeFilter: CAMERA_ATTRIBUTE_NAMES,
	});
	const geometryObserver = new MutationObserver(() => {
		isGeometryStale = true;
		cull();
	});
	geometryObserver.observe(world, {
		subtree: true,
		childList: true,
		attributes: true,
		attributeFilter: ["position", "rotation", "size", "x", "y", "z", "see-through"],
	});
	const resizeObserver = new ResizeObserver(([entry]) => {
		view.halfWidth = entry.contentRect.width / 2;
		view.halfHeight = entry.contentRect.height / 2;
		occlusionGrid.resizeGrid(entry.contentRect.width, entry.contentRect.height);
		cull();
	});
	resizeObserver.observe(world);
	// Cubes render a frame after they connect, so the first cull waits for them.
	let animationFrame = requestAnimationFrame(function cullOnceRendered() {
		cull();
		animationFrame = isGeometryStale ? requestAnimationFrame(cullOnceRendered) : 0;
	});

	return () => {
		cameraObserver.disconnect();
		geometryObserver.disconnect();
		resizeObserver.disconnect();
		cancelAnimationFrame(animationFrame);
		for (const culledCube of culledCubes) {
			culledCube.cube.removeAttribute("hidden-faces");
			culledCube.cube.removeAttribute("outside-view");
			culledCube.cube.removeAttribute("occluded");
		}
	};
};
