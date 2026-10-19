import { afterEach, beforeEach, describe, expect, test } from "vitest";
import "./scene-camera";

// Behaviour tests for the navigation wrapper. The camera is a pure input device: it never
// renders anything of its own beyond a transparent shell, and its whole observable output
// is the five --camera-* custom properties it writes onto the element assigned to its
// slot. So every assertion here reads that element's inline style.
//
// `mode` picks which body runs. Free-fly owns the movement keys and the step loop; orbit
// owns the wheel and derives the position from yaw/pitch/radius. The switch is what these
// tests are mostly about: entering must freeze the distance, leaving must keep the pose,
// and neither branch may keep the other's listeners alive.
//
// We slot a plain <div> rather than a <scene-world>: the camera drives whatever it
// projects and reads nothing off it, so a div is a faithful stand-in and keeps the world's
// own rendering out of the picture.

// The pose the camera starts at, and the distance from the origin it implies.
const START = { x: 0, y: -160, z: 600 };
const START_DISTANCE = Math.hypot(START.x, START.y, START.z);

let camera: HTMLElement & { update: () => Promise<void> };
let world: HTMLElement;

beforeEach(() => {
	camera = document.createElement("scene-camera") as typeof camera;
	world = document.createElement("div");
	camera.appendChild(world);
	document.body.appendChild(camera);
});

afterEach(async () => {
	// disconnectedCallback fires teardown a microtask later (it waits to rule out a move),
	// and the free-fly branch's key listeners live on window, so let that settle before the
	// next test presses a key.
	camera.remove();
	await flush();
});

// --- helpers ----------------------------------------------------------------

const flush = (): Promise<void> =>
	new Promise((resolve) => queueMicrotask(resolve));

const readCamera = (name: string): number =>
	parseFloat(world.style.getPropertyValue(`--camera-${name}`));

// The step loop runs on rAF, so a movement key needs real frames to show up.
const holdKeyForTwoFrames = async (key: string): Promise<void> => {
	window.dispatchEvent(new KeyboardEvent("keydown", { key }));
	await nextFrame();
	await nextFrame();
	window.dispatchEvent(new KeyboardEvent("keyup", { key }));
};

const nextFrame = (): Promise<void> =>
	new Promise((resolve) => requestAnimationFrame(() => resolve()));

const setMode = async (mode: string): Promise<void> => {
	camera.setAttribute("mode", mode);
	await camera.update();
};

// Alt + left-drag is the look gesture; the move listeners sit on window.
const lookDrag = (movementX: number, movementY: number): void => {
	camera.dispatchEvent(
		new MouseEvent("pointerdown", {
			bubbles: true,
			button: 0,
			altKey: true,
			cancelable: true,
		}),
	);
	const move = new MouseEvent("pointermove", { bubbles: true });
	Object.defineProperty(move, "movementX", { value: movementX });
	Object.defineProperty(move, "movementY", { value: movementY });
	window.dispatchEvent(move);
	window.dispatchEvent(new MouseEvent("pointerup", { bubbles: true }));
};

describe("mounting", () => {
	test("writes the starting pose onto the slotted element", () => {
		expect(readCamera("x")).toBe(START.x);
		expect(readCamera("y")).toBe(START.y);
		expect(readCamera("z")).toBe(START.z);
		expect(readCamera("yaw")).toBe(0);
		expect(readCamera("pitch")).toBe(0);
	});

	test("drives the element assigned to the slot, not merely the first child", () => {
		const stray = document.createElement("div");
		stray.slot = "nowhere";
		const wrapper = document.createElement("scene-camera");
		const projected = document.createElement("div");
		wrapper.append(stray, projected);
		document.body.appendChild(wrapper);

		expect(stray.style.getPropertyValue("--camera-z")).toBe("");
		expect(projected.style.getPropertyValue("--camera-z")).toBe("600px");
		wrapper.remove();
	});

	test("renders transparently, so the wrapped scene keeps its own box", () => {
		const styleText = camera.shadowRoot?.textContent ?? "";
		expect(styleText).toContain("display: contents");
	});
});

describe("free-fly", () => {
	test("w moves along the heading, s moves back along it", async () => {
		await holdKeyForTwoFrames("w");
		const forwardZ = readCamera("z");
		expect(forwardZ).toBeLessThan(START.z);
		expect(readCamera("x")).toBeCloseTo(0, 5);

		await holdKeyForTwoFrames("s");
		expect(readCamera("z")).toBeGreaterThan(forwardZ);
	});

	test("d strafes right without changing the heading", async () => {
		await holdKeyForTwoFrames("d");
		expect(readCamera("x")).toBeGreaterThan(START.x);
		expect(readCamera("yaw")).toBe(0);
	});

	test("space rises and shift sinks (screen +Y is down)", async () => {
		await holdKeyForTwoFrames(" ");
		const raised = readCamera("y");
		expect(raised).toBeLessThan(START.y);

		await holdKeyForTwoFrames("Shift");
		expect(readCamera("y")).toBeGreaterThan(raised);
	});

	test("a key that drives nothing never starts the loop", async () => {
		await holdKeyForTwoFrames("q");
		expect(readCamera("z")).toBe(START.z);
	});

	test("typing in an input is not hijacked as movement", async () => {
		const input = document.createElement("input");
		document.body.appendChild(input);
		const typed = new KeyboardEvent("keydown", { key: "w", bubbles: true });
		input.dispatchEvent(typed);
		await nextFrame();
		await nextFrame();
		expect(readCamera("z")).toBe(START.z);
		input.remove();
	});

	test("the wheel is left to the page", () => {
		camera.dispatchEvent(
			new WheelEvent("wheel", { deltaY: 100, cancelable: true }),
		);
		expect(readCamera("z")).toBe(START.z);
	});

	test("dragging right looks right: yaw decreases, pitch follows the drag down", () => {
		lookDrag(20, 10);
		expect(readCamera("yaw")).toBeLessThan(0);
		expect(readCamera("pitch")).toBeGreaterThan(0);
	});
});

describe("orbit", () => {
	test("entering freezes the current distance and snaps onto the orbit", async () => {
		await setMode("orbit");
		expect(readCamera("x")).toBeCloseTo(0, 5);
		expect(readCamera("y")).toBeCloseTo(0, 5);
		expect(readCamera("z")).toBeCloseTo(START_DISTANCE, 5);
	});

	test("the wheel zooms, and the pose stays on the orbit", async () => {
		await setMode("orbit");
		const radius = readCamera("z");
		camera.dispatchEvent(
			new WheelEvent("wheel", { deltaY: 100, cancelable: true }),
		);
		expect(readCamera("z")).toBeCloseTo(radius + 100, 5);
	});

	test("zoom is clamped so the camera can neither reach the target nor leave", async () => {
		await setMode("orbit");
		camera.dispatchEvent(
			new WheelEvent("wheel", { deltaY: -99999, cancelable: true }),
		);
		expect(readCamera("z")).toBeCloseTo(120, 5);

		camera.dispatchEvent(
			new WheelEvent("wheel", { deltaY: 99999, cancelable: true }),
		);
		expect(readCamera("z")).toBeCloseTo(4000, 5);
	});

	test("movement keys are inert: the position is derived, not flown", async () => {
		await setMode("orbit");
		const radius = readCamera("z");
		await holdKeyForTwoFrames("w");
		expect(readCamera("z")).toBeCloseTo(radius, 5);
	});

	test("a look drag swings around the target at a constant radius", async () => {
		await setMode("orbit");
		const radius = readCamera("z");
		lookDrag(100, 0);

		expect(readCamera("yaw")).toBeLessThan(0);
		const swung = Math.hypot(readCamera("x"), readCamera("y"), readCamera("z"));
		expect(swung).toBeCloseTo(radius, 5);
		expect(readCamera("z")).toBeLessThan(radius);
	});
});

describe("switching modes", () => {
	test("leaving orbit keeps the pose and hands the keys back", async () => {
		await setMode("orbit");
		const orbitZ = readCamera("z");

		await setMode("free");
		expect(readCamera("z")).toBeCloseTo(orbitZ, 5);

		await holdKeyForTwoFrames("w");
		expect(readCamera("z")).toBeLessThan(orbitZ);
	});

	test("the wheel stops zooming once orbit is left", async () => {
		await setMode("orbit");
		await setMode("free");
		const settled = readCamera("z");
		camera.dispatchEvent(
			new WheelEvent("wheel", { deltaY: 100, cancelable: true }),
		);
		expect(readCamera("z")).toBeCloseTo(settled, 5);
	});

	test("re-entering orbit freezes the distance the free flight left behind", async () => {
		await holdKeyForTwoFrames("w");
		const flownDistance = Math.hypot(
			readCamera("x"),
			readCamera("y"),
			readCamera("z"),
		);

		await setMode("orbit");
		const onOrbit = Math.hypot(
			readCamera("x"),
			readCamera("y"),
			readCamera("z"),
		);
		expect(onOrbit).toBeCloseTo(flownDistance, 5);
	});
});

describe("teardown", () => {
	test("disconnecting stops the step loop and drops the key listeners", async () => {
		window.dispatchEvent(new KeyboardEvent("keydown", { key: "w" }));
		await nextFrame();

		camera.remove();
		await flush();
		const settled = readCamera("z");

		await nextFrame();
		await nextFrame();
		window.dispatchEvent(new KeyboardEvent("keyup", { key: "w" }));
		expect(readCamera("z")).toBe(settled);
	});

	test("disconnecting drops the look gesture", async () => {
		camera.remove();
		await flush();
		const settled = readCamera("yaw");
		lookDrag(50, 0);
		expect(readCamera("yaw")).toBe(settled);
	});
});
