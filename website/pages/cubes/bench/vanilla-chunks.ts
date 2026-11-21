import { CUBE_SPACING_UNITS } from "./bench-grid";
import { UNIT_SIZE } from "../unit-size";

//Spike, parked: the vanilla scene split into chunks, each its own 3D context. Every chunk
//repeats the camera transform, so all project alike, and paints in z-index order, back to
//front. Tiles assume the floor's spacing, so the solid lattice gets larger tiles.

type WorldChunk = {
	element: HTMLElement;
	centerX: number;
	centerY: number;
	centerZ: number;
	squaredDistanceToEye: number;
	paintOrder: number;
};

interface WorldChunks {
	chunkAt: (x: number, y: number, z: number) => WorldChunk;
	sortForEye: (eyeX: number, eyeY: number, eyeZ: number) => void;
}

export const createWorldChunks = (
	world: HTMLElement,
	cubePositions: readonly (readonly number[])[],
	chunkEdge: number,
): WorldChunks => {
	const spacingPixels = CUBE_SPACING_UNITS * UNIT_SIZE;
	const tilePixels = chunkEdge * spacingPixels;
	const lowestCornerOf = (axisPixels: number[]) => Math.min(...axisPixels) - spacingPixels / 2;
	const originX = lowestCornerOf(cubePositions.map(([x]) => x * UNIT_SIZE));
	const originY = lowestCornerOf(cubePositions.map(([, y]) => -y * UNIT_SIZE));
	const originZ = lowestCornerOf(cubePositions.map(([, , z]) => z * UNIT_SIZE));
	const chunkByTile = new Map<string, WorldChunk>();
	const chunksBackToFront: WorldChunk[] = [];

	const chunkAt = (x: number, y: number, z: number): WorldChunk => {
		const tileX = Math.floor((x - originX) / tilePixels);
		const tileY = Math.floor((y - originY) / tilePixels);
		const tileZ = Math.floor((z - originZ) / tilePixels);
		const tileKey = `${tileX} ${tileY} ${tileZ}`;
		const existing = chunkByTile.get(tileKey);
		if (existing !== undefined) return existing;
		const element = document.createElement("div");
		element.className = "vanilla-chunk";
		element.setAttribute("world-chunk", "");
		world.appendChild(element);
		const chunk: WorldChunk = {
			element,
			centerX: originX + (tileX + 0.5) * tilePixels,
			centerY: originY + (tileY + 0.5) * tilePixels,
			centerZ: originZ + (tileZ + 0.5) * tilePixels,
			squaredDistanceToEye: 0,
			paintOrder: -1,
		};
		chunkByTile.set(tileKey, chunk);
		chunksBackToFront.push(chunk);
		return chunk;
	};

	//Writes z-index only for chunks whose place changed, which a camera frame rarely causes
	const sortForEye = (eyeX: number, eyeY: number, eyeZ: number): void => {
		for (const chunk of chunksBackToFront) {
			chunk.squaredDistanceToEye =
				(chunk.centerX - eyeX) ** 2 + (chunk.centerY - eyeY) ** 2 + (chunk.centerZ - eyeZ) ** 2;
		}
		chunksBackToFront.sort(
			(first, second) => second.squaredDistanceToEye - first.squaredDistanceToEye,
		);
		for (let paintOrder = 0; paintOrder < chunksBackToFront.length; paintOrder++) {
			const chunk = chunksBackToFront[paintOrder];
			if (chunk.paintOrder === paintOrder) continue;
			chunk.paintOrder = paintOrder;
			chunk.element.style.zIndex = `${paintOrder}`;
		}
	};

	return { chunkAt, sortForEye };
};
