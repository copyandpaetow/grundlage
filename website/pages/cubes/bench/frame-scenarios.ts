import { observeMutations } from "../../../src/measure";
import { chunkEdgeFromLocation, gridCubePositions } from "./bench-grid";
import { createVanillaScene, type VanillaScene } from "./vanilla-scene";

//Drives a generated scene with synthetic input, one event per animation frame, so frame
//timing measures the page and not the input. The page's own scene leaves the document
//for the run: hidden, its camera would still fly along with every key.

export type FrameStatistics = {
	frameCount: number;
	medianFrameMilliseconds: number;
	slowestTwentiethFrameMilliseconds: number;
	slowestFrameMilliseconds: number;
	lateFrameCount: number;
	domMutationCount: number;
};

export const BENCH_VARIANTS = ["grundlage", "vanilla"] as const;
export type BenchVariant = (typeof BENCH_VARIANTS)[number];

export const benchVariantFromLocation = (): BenchVariant =>
	BENCH_VARIANTS.find((variant) => new URLSearchParams(location.search).has(variant)) ??
	"grundlage";

//A frame is late when it takes longer than one and a half display refreshes, so a
//120 Hz display is held to 120 Hz, not 60.
const LATE_FRAME_FACTOR = 1.5;
const DISPLAY_SAMPLE_FRAME_COUNT = 60;

const nextFrame = (): Promise<number> => new Promise((resolve) => requestAnimationFrame(resolve));

const percentile = (sortedValues: number[], fraction: number): number =>
	sortedValues[Math.min(sortedValues.length - 1, Math.floor(sortedValues.length * fraction))] ?? 0;

const frameIntervals = (timestamps: number[]): number[] =>
	timestamps
		.slice(1)
		.map((timestamp, index) => timestamp - timestamps[index])
		.sort((first, second) => first - second);

export const measureDisplayFrameMilliseconds = async (): Promise<number> => {
	const timestamps: number[] = [await nextFrame()];
	for (let frameIndex = 0; frameIndex < DISPLAY_SAMPLE_FRAME_COUNT; frameIndex++) {
		timestamps.push(await nextFrame());
	}
	return percentile(frameIntervals(timestamps), 0.5);
};

type SceneDriver =
	| { kind: "grundlage"; sceneCamera: HTMLElement }
	| { kind: "vanilla"; vanillaScene: VanillaScene };

type BenchScene = {
	pageScene: HTMLElement;
	pageScenePlaceholder: Comment;
	sceneRoot: HTMLElement;
	world: HTMLElement;
	driver: SceneDriver;
	displayFrameMilliseconds: number;
};

let benchScene: BenchScene | null = null;

const requireBenchScene = (): BenchScene => {
	if (benchScene === null) throw new Error("Mount a bench scene before running a scenario.");
	return benchScene;
};

export const unmountBenchScene = (): void => {
	if (benchScene === null) return;
	if (benchScene.driver.kind === "vanilla") benchScene.driver.vanillaScene.stopCulling();
	benchScene.sceneRoot.remove();
	benchScene.pageScenePlaceholder.replaceWith(benchScene.pageScene);
	benchScene = null;
};

type MountedDriver = Pick<BenchScene, "sceneRoot" | "world" | "driver">;

const mountGrundlageDriver = (cubePositions: number[][]): MountedDriver => {
	if (chunkEdgeFromLocation() !== null) {
		throw new Error("Only the vanilla scenes split into chunks so far.");
	}
	if (customElements.get("scene-editor") === undefined) {
		throw new Error(
			"This page does not load the grundlage scene; bench grundlage on the cubes page.",
		);
	}
	const editor = document.createElement("scene-editor");
	const sceneCamera = document.createElement("scene-camera");
	const world = document.createElement("scene-world");
	for (const position of cubePositions) {
		const cube = document.createElement("scene-cube");
		cube.setAttribute("position", position.join(" "));
		world.appendChild(cube);
	}
	sceneCamera.appendChild(world);
	editor.appendChild(sceneCamera);
	return {
		sceneRoot: editor,
		world,
		driver: { kind: "grundlage", sceneCamera },
	};
};

const mountVanillaDriver = (cubePositions: number[][]): MountedDriver => {
	const vanillaScene = createVanillaScene(cubePositions, chunkEdgeFromLocation());
	return {
		sceneRoot: vanillaScene.root,
		world: vanillaScene.world,
		driver: { kind: "vanilla", vanillaScene },
	};
};

export const mountBenchScene = async (
	cubeCount: number,
	displayFrameMilliseconds: number,
	variant: BenchVariant = benchVariantFromLocation(),
): Promise<number> => {
	unmountBenchScene();
	const pageScene = document.querySelector<HTMLElement>("scene-editor");
	if (pageScene === null) throw new Error("The page has no <scene-editor> to bench in place of.");

	const cubePositions = gridCubePositions(cubeCount);
	const { sceneRoot, world, driver } =
		variant === "grundlage"
			? mountGrundlageDriver(cubePositions)
			: mountVanillaDriver(cubePositions);

	const pageScenePlaceholder = document.createComment("page scene during a bench run");
	const startTime = performance.now();
	pageScene.replaceWith(pageScenePlaceholder);
	pageScenePlaceholder.after(sceneRoot);
	benchScene = {
		pageScene,
		pageScenePlaceholder,
		sceneRoot,
		world,
		driver,
		displayFrameMilliseconds,
	};
	await nextFrame();
	await nextFrame();
	return performance.now() - startTime;
};

//Shadow roots created during the scenario (a fresh gizmo) are not observed.
const observeSceneMutations = (sceneRoot: HTMLElement): (() => number) => {
	const counters = [observeMutations(sceneRoot)];
	for (const element of sceneRoot.querySelectorAll("*")) {
		if (element.shadowRoot !== null) counters.push(observeMutations(element.shadowRoot));
	}
	return () => {
		let mutationCount = 0;
		for (const counter of counters) {
			mutationCount += counter.read();
			counter.stop();
		}
		return mutationCount;
	};
};

const measureFrames = async (
	frameCount: number,
	stepForFrame: (frameIndex: number) => void,
): Promise<FrameStatistics> => {
	const { sceneRoot, displayFrameMilliseconds } = requireBenchScene();
	const readMutationCount = observeSceneMutations(sceneRoot);
	const timestamps: number[] = [await nextFrame()];
	for (let frameIndex = 0; frameIndex < frameCount; frameIndex++) {
		stepForFrame(frameIndex);
		timestamps.push(await nextFrame());
	}
	const domMutationCount = readMutationCount();
	const intervals = frameIntervals(timestamps);
	return {
		frameCount: intervals.length,
		medianFrameMilliseconds: percentile(intervals, 0.5),
		slowestTwentiethFrameMilliseconds: percentile(intervals, 0.95),
		slowestFrameMilliseconds: intervals.at(-1) ?? 0,
		lateFrameCount: intervals.filter(
			(interval) => interval > displayFrameMilliseconds * LATE_FRAME_FACTOR,
		).length,
		domMutationCount,
	};
};

const pointer = (type: string, init: PointerEventInit): PointerEvent =>
	new PointerEvent(type, {
		bubbles: true,
		composed: true,
		button: 0,
		pointerId: 1,
		...init,
	});

const centerOf = (element: Element): { x: number; y: number } => {
	const rectangle = element.getBoundingClientRect();
	return {
		x: rectangle.x + rectangle.width / 2,
		y: rectangle.y + rectangle.height / 2,
	};
};

//The cubes nearest the middle of the view, because a user drags what they see: a drag
//off-screen redraws nothing and measures only the layer bookkeeping. Measured on the
//scene root, because the vanilla world is the camera-transformed sheet itself.
const cubesNearestViewCenter = (selectedCount: number): HTMLElement[] => {
	const { sceneRoot, world } = requireBenchScene();
	const viewCenter = centerOf(sceneRoot);
	const distanceFromViewCenter = (cube: Element): number => {
		const cubeCenter = centerOf(cube);
		return Math.hypot(cubeCenter.x - viewCenter.x, cubeCenter.y - viewCenter.y);
	};
	return [...world.querySelectorAll<HTMLElement>("scene-cube, .vanilla-cube")]
		.map((cube) => ({ cube, distance: distanceFromViewCenter(cube) }))
		.sort((first, second) => first.distance - second.distance)
		.slice(0, selectedCount)
		.map(({ cube }) => cube);
};

const dragGizmoAlongX = async (frameCount: number): Promise<FrameStatistics> => {
	const knob = requireBenchScene()
		.world.querySelector("scene-gizmo")
		?.shadowRoot?.querySelector("#knob-x");
	if (knob == null) throw new Error("The selection has no gizmo knob to drag.");
	const start = centerOf(knob);
	knob.dispatchEvent(pointer("pointerdown", { clientX: start.x, clientY: start.y }));
	const statistics = await measureFrames(frameCount, (frameIndex) => {
		window.dispatchEvent(
			pointer("pointermove", {
				clientX: start.x + (frameIndex + 1) * 2,
				clientY: start.y,
			}),
		);
	});
	window.dispatchEvent(pointer("pointerup", {}));
	window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
	return statistics;
};

const dragCubesAlongX = async (
	selectedCount: number,
	frameCount: number,
): Promise<FrameStatistics> => {
	const { driver } = requireBenchScene();
	const cubes = cubesNearestViewCenter(selectedCount);
	if (driver.kind === "vanilla") {
		driver.vanillaScene.selectCubes(cubes);
		await nextFrame();
		await nextFrame();
		return measureFrames(frameCount, (frameIndex) =>
			driver.vanillaScene.moveSelection((frameIndex + 1) * 2),
		);
	}
	for (let cubeIndex = 0; cubeIndex < cubes.length; cubeIndex++) {
		cubes[cubeIndex].dispatchEvent(pointer("pointerdown", { ctrlKey: cubeIndex > 0 }));
	}
	await nextFrame();
	await nextFrame();
	return dragGizmoAlongX(frameCount);
};

export const scenarios = {
	idle: (frameCount: number): Promise<FrameStatistics> => measureFrames(frameCount, () => {}),

	//Held W: the camera's own requestAnimationFrame loop moves it, no input per frame.
	fly: async (frameCount: number): Promise<FrameStatistics> => {
		const { driver } = requireBenchScene();
		if (driver.kind === "vanilla") {
			return measureFrames(frameCount, () => driver.vanillaScene.moveCamera(0, 0, 1));
		}
		window.dispatchEvent(new KeyboardEvent("keydown", { key: "w" }));
		const statistics = await measureFrames(frameCount, () => {});
		window.dispatchEvent(new KeyboardEvent("keyup", { key: "w" }));
		return statistics;
	},

	look: async (frameCount: number): Promise<FrameStatistics> => {
		const { driver } = requireBenchScene();
		if (driver.kind === "vanilla") {
			return measureFrames(frameCount, () => driver.vanillaScene.turnCamera(3, 1));
		}
		driver.sceneCamera.dispatchEvent(pointer("pointerdown", { altKey: true }));
		const statistics = await measureFrames(frameCount, () => {
			window.dispatchEvent(pointer("pointermove", { movementX: 3, movementY: 1 }));
		});
		window.dispatchEvent(pointer("pointerup", {}));
		return statistics;
	},

	dragOne: (frameCount: number): Promise<FrameStatistics> => dragCubesAlongX(1, frameCount),

	dragFifty: (frameCount: number): Promise<FrameStatistics> => dragCubesAlongX(50, frameCount),
};

export type ScenarioName = Exclude<keyof typeof scenarios, "idle">;
