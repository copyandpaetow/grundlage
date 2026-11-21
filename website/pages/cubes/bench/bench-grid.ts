import { UNIT_SIZE } from "../unit-size";

export const CUBE_SPACING_UNITS = 1.5;

export const BENCH_LAYOUTS = ["floor", "lattice", "solid-lattice"] as const;
const SOLID_SPACING_UNITS = 1;
export type BenchLayout = (typeof BENCH_LAYOUTS)[number];

export const benchLayoutFromLocation = (): BenchLayout =>
	BENCH_LAYOUTS.find((layout) => new URLSearchParams(location.search).get("layout") === layout) ??
	"floor";

//The camera starts 160px above the floor; the lattice's middle sits at that height, and
//its front face this far ahead, so the whole face fits the view.
const LATTICE_CENTER_HEIGHT_UNITS = 160 / UNIT_SIZE;
const LATTICE_FRONT_DISTANCE_UNITS = 13;

const floorCubePositions = (cubeCount: number): number[][] => {
	const cubesPerRow = Math.ceil(Math.sqrt(cubeCount));
	const rowOffset = ((cubesPerRow - 1) * CUBE_SPACING_UNITS) / 2;
	return Array.from({ length: cubeCount }, (_, cubeIndex) => [
		(cubeIndex % cubesPerRow) * CUBE_SPACING_UNITS - rowOffset,
		0,
		-Math.floor(cubeIndex / cubesPerRow) * CUBE_SPACING_UNITS,
	]);
};

const latticeCubePositions = (cubeCount: number, spacingUnits: number): number[][] => {
	const cubesPerSide = Math.ceil(Math.cbrt(cubeCount));
	const sideOffset = ((cubesPerSide - 1) * spacingUnits) / 2;
	return Array.from({ length: cubeCount }, (_, cubeIndex) => [
		(cubeIndex % cubesPerSide) * spacingUnits - sideOffset,
		(Math.floor(cubeIndex / cubesPerSide) % cubesPerSide) * spacingUnits -
			sideOffset +
			LATTICE_CENTER_HEIGHT_UNITS,
		-LATTICE_FRONT_DISTANCE_UNITS - Math.floor(cubeIndex / cubesPerSide ** 2) * spacingUnits,
	]);
};

export const gridCubePositions = (
	cubeCount: number,
	layout: BenchLayout = benchLayoutFromLocation(),
): number[][] => {
	switch (layout) {
		case "floor":
			return floorCubePositions(cubeCount);
		case "lattice":
			return latticeCubePositions(cubeCount, CUBE_SPACING_UNITS);
		case "solid-lattice":
			return latticeCubePositions(cubeCount, SOLID_SPACING_UNITS);
		default:
			return layout satisfies never;
	}
};

//`?cubes=1000` on a comparison page; null keeps the page's own scene
export const gridCubeCountFromLocation = (): number | null => {
	const cubeCount = Number(new URLSearchParams(location.search).get("cubes"));
	return cubeCount > 0 ? cubeCount : null;
};

export const chunkEdgeFromLocation = (): number | null => {
	const chunkEdge = Number(new URLSearchParams(location.search).get("chunk-edge"));
	return chunkEdge > 0 ? chunkEdge : null;
};
