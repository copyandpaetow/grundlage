import { type View, type ViewPoint, writeViewPoint } from "./scene-view";

//Occlusion culling: a cube is hidden when nearer cubes cover its whole screen rectangle.
//The grid holds, per 8px screen cell, the depth beyond which everything is hidden. Faces
//that each cover part of a cell add up through its 4×4 sample mask, so touching cubes
//cover the seam between them together.

//Corners of each face in scene-culling's FACE_NAMES order, walked around its edge
const FACE_CORNER_INDICES = [
	[4, 5, 7, 6],
	[0, 1, 3, 2],
	[1, 3, 7, 5],
	[0, 2, 6, 4],
	[0, 1, 5, 4],
	[2, 3, 7, 6],
] as const;

const OCCLUSION_CELL_PIXELS = 8;
//4×4 samples per cell, at pixel centres two pixels apart
const SAMPLES_PER_CELL_EDGE = 4;
const SAMPLE_COUNT_PER_CELL = SAMPLES_PER_CELL_EDGE ** 2;
const SAMPLE_OFFSETS_PIXELS = [1, 3, 5, 7];
const ALL_SAMPLES_MASK = (1 << SAMPLE_COUNT_PER_CELL) - 1;
//A corner this close to the eye or behind it does not project; its cube neither occludes
//nor is occluded
const NEAREST_PROJECTABLE_DEPTH = 1;
//Crossing-edge masks run 0 to 15, so this one cannot be mistaken for a mask
const CELL_OUTSIDE_FACE = -1;

export type OccludableCube = {
	cube: HTMLElement;
	//Eight corners in world space, x y z each; corner bit 0 picks +x, bit 1 +y, bit 2 +z
	worldCorners: Float64Array;
	//Bit i hides face i of FACE_CORNER_INDICES
	hiddenFaceMask: number;
	isOutsideView: boolean;
	isSeeThrough: boolean;
	isOccluded: boolean;
};

export type OcclusionGrid = {
	resizeGrid: (widthPixels: number, heightPixels: number) => void;
	resizeCubeBuffers: (cubeCount: number) => void;
	occlude: (cubes: readonly OccludableCube[]) => void;
};

export const createOcclusionGrid = (view: View): OcclusionGrid => {
	let coveredDepths = new Float32Array(0);
	let partialSampleMasks = new Uint16Array(0);
	let partialFarthestDepths = new Float32Array(0);
	let coverageColumns = 0;
	let coverageRows = 0;
	let projectedCorners = new Float64Array(0);
	let nearestDepths = new Float64Array(0);
	let isOccludedNow = new Uint8Array(0);
	const frontToBackOrder: number[] = [];
	const byNearestDepth = (first: number, second: number): number =>
		nearestDepths[first] - nearestDepths[second];
	const viewPoint: ViewPoint = { x: 0, y: 0, depth: 0 };
	const faceXs = new Float64Array(4);
	const faceYs = new Float64Array(4);
	//Each face edge from corner a to b as E(p) = A·x + B·y + C = cross(b - a, p - a),
	//flipped by the winding so E ≥ 0 inside
	const edgeXFactors = new Float64Array(4);
	const edgeYFactors = new Float64Array(4);
	const edgeConstants = new Float64Array(4);
	const cellRange = { firstColumn: 0, lastColumn: 0, firstRow: 0, lastRow: 0 };

	const writeCellRange = (
		minimumX: number,
		maximumX: number,
		minimumY: number,
		maximumY: number,
	): void => {
		cellRange.firstColumn = Math.max(0, Math.floor(minimumX / OCCLUSION_CELL_PIXELS));
		cellRange.lastColumn = Math.min(
			coverageColumns - 1,
			Math.floor(maximumX / OCCLUSION_CELL_PIXELS),
		);
		cellRange.firstRow = Math.max(0, Math.floor(minimumY / OCCLUSION_CELL_PIXELS));
		cellRange.lastRow = Math.min(coverageRows - 1, Math.floor(maximumY / OCCLUSION_CELL_PIXELS));
	};

	//Perspective divide: screen = viewport centre + view · perspective / depth.
	//False when a corner lies at or behind the eye: that cube neither occludes nor is occluded.
	const projectCorners = (occludableCube: OccludableCube, cubeIndex: number): boolean => {
		const corners = occludableCube.worldCorners;
		const offset = cubeIndex * 24;
		let nearestDepth = Infinity;
		for (let cornerIndex = 0; cornerIndex < 8; cornerIndex++) {
			writeViewPoint(
				view,
				corners[cornerIndex * 3],
				corners[cornerIndex * 3 + 1],
				corners[cornerIndex * 3 + 2],
				viewPoint,
			);
			if (viewPoint.depth < NEAREST_PROJECTABLE_DEPTH) return false;
			const scale = view.perspective / viewPoint.depth;
			projectedCorners[offset + cornerIndex * 3] = view.halfWidth + viewPoint.x * scale;
			projectedCorners[offset + cornerIndex * 3 + 1] = view.halfHeight + viewPoint.y * scale;
			projectedCorners[offset + cornerIndex * 3 + 2] = viewPoint.depth;
			nearestDepth = Math.min(nearestDepth, viewPoint.depth);
		}
		nearestDepths[cubeIndex] = nearestDepth;
		return true;
	};

	//E is linear, so its extremes over the cell sit at corners, per axis: all below 0 is
	//outside, all at least 0 is inside, else the edge crosses the cell and sets its bit
	const crossingEdgeMaskOf = (left: number, top: number): number => {
		let crossingEdgeMask = 0;
		for (let edgeIndex = 0; edgeIndex < 4; edgeIndex++) {
			const atLeft = edgeXFactors[edgeIndex] * left;
			const atRight = edgeXFactors[edgeIndex] * (left + OCCLUSION_CELL_PIXELS);
			const atTop = edgeYFactors[edgeIndex] * top;
			const atBottom = edgeYFactors[edgeIndex] * (top + OCCLUSION_CELL_PIXELS);
			const largest =
				edgeConstants[edgeIndex] + Math.max(atLeft, atRight) + Math.max(atTop, atBottom);
			if (largest < 0) return CELL_OUTSIDE_FACE;
			const smallest =
				edgeConstants[edgeIndex] + Math.min(atLeft, atRight) + Math.min(atTop, atBottom);
			if (smallest < 0) crossingEdgeMask |= 1 << edgeIndex;
		}
		return crossingEdgeMask;
	};

	//Bit i is the sample at column i % 4, row ⌊i / 4⌋. Only the crossing edges can fail it.
	const sampleMaskInsideFace = (left: number, top: number, crossingEdgeMask: number): number => {
		let sampleMask = 0;
		for (let sampleIndex = 0; sampleIndex < SAMPLE_COUNT_PER_CELL; sampleIndex++) {
			const sampleX = left + SAMPLE_OFFSETS_PIXELS[sampleIndex % SAMPLES_PER_CELL_EDGE];
			const sampleY = top + SAMPLE_OFFSETS_PIXELS[Math.floor(sampleIndex / SAMPLES_PER_CELL_EDGE)];
			let isSampleInsideFace = true;
			for (let edgeIndex = 0; edgeIndex < 4; edgeIndex++) {
				if (
					(crossingEdgeMask & (1 << edgeIndex)) !== 0 &&
					edgeXFactors[edgeIndex] * sampleX +
						edgeYFactors[edgeIndex] * sampleY +
						edgeConstants[edgeIndex] <
						0
				) {
					isSampleInsideFace = false;
					break;
				}
			}
			if (isSampleInsideFace) sampleMask |= 1 << sampleIndex;
		}
		return sampleMask;
	};

	const coverFace = (cubeIndex: number, faceCorners: readonly number[]): void => {
		const offset = cubeIndex * 24;
		let farthestDepth = 0;
		let minimumX = Infinity;
		let maximumX = -Infinity;
		let minimumY = Infinity;
		let maximumY = -Infinity;
		for (let quadIndex = 0; quadIndex < 4; quadIndex++) {
			const cornerOffset = offset + faceCorners[quadIndex] * 3;
			const x = projectedCorners[cornerOffset];
			const y = projectedCorners[cornerOffset + 1];
			faceXs[quadIndex] = x;
			faceYs[quadIndex] = y;
			minimumX = Math.min(minimumX, x);
			maximumX = Math.max(maximumX, x);
			minimumY = Math.min(minimumY, y);
			maximumY = Math.max(maximumY, y);
			farthestDepth = Math.max(farthestDepth, projectedCorners[cornerOffset + 2]);
		}
		writeCellRange(minimumX, maximumX, minimumY, maximumY);
		const { firstColumn, lastColumn, firstRow, lastRow } = cellRange;
		//Sign of cross(c1 - c0, c2 - c0): which way round the projected corners run
		const windingSign =
			(faceXs[1] - faceXs[0]) * (faceYs[2] - faceYs[0]) -
				(faceYs[1] - faceYs[0]) * (faceXs[2] - faceXs[0]) >
			0
				? 1
				: -1;
		for (let edgeIndex = 0; edgeIndex < 4; edgeIndex++) {
			const nextIndex = (edgeIndex + 1) % 4;
			const alongX = faceXs[nextIndex] - faceXs[edgeIndex];
			const alongY = faceYs[nextIndex] - faceYs[edgeIndex];
			edgeXFactors[edgeIndex] = -alongY * windingSign;
			edgeYFactors[edgeIndex] = alongX * windingSign;
			edgeConstants[edgeIndex] =
				(alongY * faceXs[edgeIndex] - alongX * faceYs[edgeIndex]) * windingSign;
		}
		for (let row = firstRow; row <= lastRow; row++) {
			for (let column = firstColumn; column <= lastColumn; column++) {
				const left = column * OCCLUSION_CELL_PIXELS;
				const top = row * OCCLUSION_CELL_PIXELS;
				const cellIndex = row * coverageColumns + column;
				//A cell already hidden at this face's depth or nearer gains nothing from it
				if (coveredDepths[cellIndex] <= farthestDepth) continue;
				const crossingEdgeMask = crossingEdgeMaskOf(left, top);
				if (crossingEdgeMask === CELL_OUTSIDE_FACE) continue;
				if (crossingEdgeMask === 0) {
					coveredDepths[cellIndex] = farthestDepth;
					continue;
				}
				const sampleMask = sampleMaskInsideFace(left, top, crossingEdgeMask);
				if (sampleMask === 0) continue;
				//Partial covers hide only what lies behind the farthest of them
				partialSampleMasks[cellIndex] |= sampleMask;
				partialFarthestDepths[cellIndex] = Math.max(
					partialFarthestDepths[cellIndex],
					farthestDepth,
				);
				if (partialSampleMasks[cellIndex] !== ALL_SAMPLES_MASK) continue;
				if (partialFarthestDepths[cellIndex] < coveredDepths[cellIndex]) {
					coveredDepths[cellIndex] = partialFarthestDepths[cellIndex];
				}
				partialSampleMasks[cellIndex] = 0;
				partialFarthestDepths[cellIndex] = 0;
			}
		}
	};

	//Every cell under the cube's screen rectangle hides what lies beyond its nearest corner.
	//`!(covered < nearest)` keeps an uncovered Infinity cell, and any NaN, visible.
	const isCovered = (cubeIndex: number): boolean => {
		const offset = cubeIndex * 24;
		let minimumX = Infinity;
		let maximumX = -Infinity;
		let minimumY = Infinity;
		let maximumY = -Infinity;
		for (let cornerIndex = 0; cornerIndex < 8; cornerIndex++) {
			const x = projectedCorners[offset + cornerIndex * 3];
			const y = projectedCorners[offset + cornerIndex * 3 + 1];
			minimumX = Math.min(minimumX, x);
			maximumX = Math.max(maximumX, x);
			minimumY = Math.min(minimumY, y);
			maximumY = Math.max(maximumY, y);
		}
		writeCellRange(minimumX, maximumX, minimumY, maximumY);
		const { firstColumn, lastColumn, firstRow, lastRow } = cellRange;
		if (firstColumn > lastColumn || firstRow > lastRow) return false;
		const nearestDepth = nearestDepths[cubeIndex];
		for (let row = firstRow; row <= lastRow; row++) {
			for (let column = firstColumn; column <= lastColumn; column++) {
				if (!(coveredDepths[row * coverageColumns + column] < nearestDepth)) return false;
			}
		}
		return true;
	};

	//Front to back by nearest corner, so each cube is tested against all that could cover
	//it. A cube never hides itself: no face of it lies nearer than its nearest corner.
	const occlude = (cubes: readonly OccludableCube[]): void => {
		coveredDepths.fill(Infinity);
		partialSampleMasks.fill(0);
		partialFarthestDepths.fill(0);
		isOccludedNow.fill(0);
		frontToBackOrder.length = 0;
		for (let cubeIndex = 0; cubeIndex < cubes.length; cubeIndex++) {
			if (!cubes[cubeIndex].isOutsideView && projectCorners(cubes[cubeIndex], cubeIndex)) {
				frontToBackOrder.push(cubeIndex);
			}
		}
		frontToBackOrder.sort(byNearestDepth);
		for (const cubeIndex of frontToBackOrder) {
			if (isCovered(cubeIndex)) {
				isOccludedNow[cubeIndex] = 1;
				continue;
			}
			const occludableCube = cubes[cubeIndex];
			if (occludableCube.isSeeThrough) continue;
			for (let faceIndex = 0; faceIndex < 6; faceIndex++) {
				if ((occludableCube.hiddenFaceMask & (1 << faceIndex)) === 0) {
					coverFace(cubeIndex, FACE_CORNER_INDICES[faceIndex]);
				}
			}
		}
		for (let cubeIndex = 0; cubeIndex < cubes.length; cubeIndex++) {
			const occludableCube = cubes[cubeIndex];
			const isOccluded = isOccludedNow[cubeIndex] === 1;
			if (isOccluded === occludableCube.isOccluded) continue;
			occludableCube.isOccluded = isOccluded;
			occludableCube.cube.toggleAttribute("occluded", isOccluded);
		}
	};

	const resizeGrid = (widthPixels: number, heightPixels: number): void => {
		coverageColumns = Math.ceil(widthPixels / OCCLUSION_CELL_PIXELS);
		coverageRows = Math.ceil(heightPixels / OCCLUSION_CELL_PIXELS);
		coveredDepths = new Float32Array(coverageColumns * coverageRows);
		partialSampleMasks = new Uint16Array(coverageColumns * coverageRows);
		partialFarthestDepths = new Float32Array(coverageColumns * coverageRows);
	};

	const resizeCubeBuffers = (cubeCount: number): void => {
		projectedCorners = new Float64Array(cubeCount * 24);
		nearestDepths = new Float64Array(cubeCount);
		isOccludedNow = new Uint8Array(cubeCount);
	};

	return { resizeGrid, resizeCubeBuffers, occlude };
};
