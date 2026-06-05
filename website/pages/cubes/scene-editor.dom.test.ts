import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { type CameraControls, type SceneEditorElement } from "./scene-editor";
import "./scene-editor";

// Behaviour tests for the editing spine. The editor is now its own <scene-editor>
// element: we mount it on a host the way <scene-world> does — set sceneHost + camera as
// properties, append it into the host's shadow — then dispatch real pointer/keyboard
// events, click palette buttons, and assert on the observable result: the wrapper
// structure selection produces, the attributes grouping/ungrouping write, DOM order
// after deselect, etc. We never reach into the editor's private closures.
//
// The blocks the editor reads — scene-cube / scene-wall / scene-ramp / scene-group —
// are never imported here, so plain createElement("scene-cube") elements stay inert
// and carry only their tagName, which is all selection/grouping/serialization read.
// The chrome the editor mounts IS the framework, though: scene-editor pulls in
// scene-palette and scene-ground, so those upgrade and render into their own shadow
// roots — hence the palette helpers below reach a shadow deeper, and the inspector,
// which the editor now feeds through a prop, settles a microtask after selection.

let host: HTMLElement;
let dispose: () => void;
// toggleMode flips this so the camera stub mirrors the real Free/Orbit toggle.
let cameraMode: "Free" | "Orbit";

const camera: CameraControls = {
	applyLook() {},
	zoom() {
		return false;
	},
	toggleMode() {
		cameraMode = cameraMode === "Free" ? "Orbit" : "Free";
		return cameraMode;
	},
};

beforeEach(() => {
	cameraMode = "Free";
	host = document.createElement("div");
	host.attachShadow({ mode: "open" });
	document.body.appendChild(host);
	// Mount the editor element exactly as <scene-world> does: hand it the host and
	// camera as properties, then connect it into the host's shadow. Its generator runs
	// synchronously on connect, so the palette and listeners are live straight away.
	const editor = document.createElement("scene-editor") as SceneEditorElement;
	editor.sceneHost = host;
	editor.camera = camera;
	host.shadowRoot!.appendChild(editor);
	dispose = () => editor.remove();
});

afterEach(async () => {
	// disconnectedCallback fires teardown a microtask later (it waits to rule out a
	// move), so let that settle before tearing down the host.
	dispose();
	await flush();
	host.remove();
});

// --- helpers ----------------------------------------------------------------

const addBlock = (
	tag: string,
	attributes: Record<string, string> = {},
): HTMLElement => {
	const block = document.createElement(tag);
	for (const [name, value] of Object.entries(attributes)) {
		block.setAttribute(name, value);
	}
	host.appendChild(block);
	return block;
};

// A pointerdown is what the editor listens for; the handler only reads MouseEvent
// fields + composedPath, so a MouseEvent of that type is a faithful stand-in.
const pointerDown = (target: EventTarget, meta = false): void => {
	target.dispatchEvent(
		new MouseEvent("pointerdown", { bubbles: true, button: 0, metaKey: meta }),
	);
};

const pressKey = (key: string): void => {
	window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
};

// The palette is now a <scene-palette> custom element that renders into its own
// shadow root, so its toolbar and inspector live one shadow deeper than before.
const paletteShadow = (): ShadowRoot | null =>
	(host.shadowRoot?.querySelector("scene-palette") as HTMLElement | null)
		?.shadowRoot ?? null;

// The editor hands the palette its inspector state through a prop; the lib re-renders
// on the next microtask, so let that settle before asserting on the panel.
const flush = (): Promise<void> =>
	new Promise((resolve) => queueMicrotask(resolve));

const clickPaletteButton = (selector: string): void => {
	const button = paletteShadow()?.querySelector(selector);
	button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
};

const gizmo = (): HTMLElement | null => host.querySelector("scene-gizmo");
const sceneSelect = (): HTMLElement | null =>
	host.querySelector("scene-select");
const selectedBlocks = (): HTMLElement[] => {
	const select = sceneSelect();
	if (select === null) return [];
	return [...select.children].filter((child) =>
		["scene-cube", "scene-wall", "scene-ramp", "scene-group"].includes(
			child.tagName.toLowerCase(),
		),
	) as HTMLElement[];
};
const inspector = (): HTMLElement | null =>
	paletteShadow()?.querySelector(".inspector") as HTMLElement | null;
const fieldInput = (field: string, axis: number): HTMLInputElement | null =>
	paletteShadow()?.querySelector(
		`input[data-field="${field}"][data-axis="${axis}"]`,
	) as HTMLInputElement | null;

// --- selection --------------------------------------------------------------

describe("selection wrapping", () => {
	test("clicking a block wraps it in scene-gizmo > scene-select", () => {
		const block = addBlock("scene-cube");
		pointerDown(block);

		expect(gizmo()).not.toBeNull();
		expect(sceneSelect()?.parentElement).toBe(gizmo());
		expect(block.parentElement).toBe(sceneSelect());
		expect([...host.children]).not.toContain(block);
	});

	test("clicking empty space deselects and returns the block to the host", () => {
		const block = addBlock("scene-cube");
		pointerDown(block);
		pointerDown(host);

		expect(gizmo()).toBeNull();
		expect(block.parentElement).toBe(host);
	});

	test("selecting another block clears the first selection", () => {
		const first = addBlock("scene-cube");
		const second = addBlock("scene-cube");
		pointerDown(first);
		pointerDown(second);

		expect(host.querySelectorAll("scene-gizmo")).toHaveLength(1);
		expect(first.parentElement).toBe(host);
		expect(selectedBlocks()).toEqual([second]);
	});

	test("re-clicking the already-selected block leaves the gizmo intact", () => {
		const block = addBlock("scene-cube");
		pointerDown(block);
		const firstGizmo = gizmo();
		pointerDown(block);

		expect(gizmo()).toBe(firstGizmo);
	});
});

describe("multi-selection", () => {
	test("meta-click folds blocks into one shared cage", async () => {
		const first = addBlock("scene-cube");
		const second = addBlock("scene-cube");
		pointerDown(first);
		pointerDown(second, true);
		await flush();

		expect(host.querySelectorAll("scene-select")).toHaveLength(1);
		expect(new Set(selectedBlocks())).toEqual(new Set([first, second]));
		// The inspector only makes sense for one block, so it hides for many.
		expect(inspector()?.style.display).toBe("none");
	});

	test("deselecting restores the original DOM order (anchors)", () => {
		const a = addBlock("scene-cube");
		const b = addBlock("scene-cube");
		const c = addBlock("scene-cube");

		pointerDown(b);
		pointerDown(a, true);
		pointerDown(c, true);
		pointerDown(host); // deselect everything

		const order = [...host.children].filter(
			(child) => child.tagName.toLowerCase() === "scene-cube",
		);
		expect(order).toEqual([a, b, c]);
	});

	test("meta-clicking the last selected block clears the selection", () => {
		const block = addBlock("scene-cube");
		pointerDown(block);
		pointerDown(block, true); // fold the only block back out

		expect(gizmo()).toBeNull();
		expect(block.parentElement).toBe(host);
	});
});

describe("delete", () => {
	test("Delete removes the whole selection from the scene", () => {
		const a = addBlock("scene-cube");
		const b = addBlock("scene-cube");
		pointerDown(a);
		pointerDown(b, true);
		pressKey("Delete");

		expect(gizmo()).toBeNull();
		expect(host.contains(a)).toBe(false);
		expect(host.contains(b)).toBe(false);
	});
});

// --- grouping ---------------------------------------------------------------

describe("grouping", () => {
	test("'g' wraps ≥2 blocks in a group at their centroid with rebased children", () => {
		const a = addBlock("scene-cube", { position: "2 0 0" });
		const b = addBlock("scene-cube", { position: "4 0 0" });
		pointerDown(a);
		pointerDown(b, true);
		pressKey("g");

		const group = host.querySelector("scene-group");
		expect(group).not.toBeNull();
		expect(group?.getAttribute("position")).toBe("3 0 0");

		// Children are reparented under the group, rebased into group-local space,
		// and their per-axis overrides cleared.
		expect(a.parentElement).toBe(group);
		expect(b.parentElement).toBe(group);
		expect(a.getAttribute("position")).toBe("-1 0 0");
		expect(b.getAttribute("position")).toBe("1 0 0");
		expect(a.hasAttribute("x")).toBe(false);

		// The new group is what's now selected.
		expect(selectedBlocks()).toEqual([group]);
	});

	test("'g' with fewer than two blocks selected does nothing", () => {
		const a = addBlock("scene-cube", { position: "2 0 0" });
		pointerDown(a);
		pressKey("g");

		expect(host.querySelector("scene-group")).toBeNull();
		expect(selectedBlocks()).toEqual([a]);
	});
});

describe("ungrouping", () => {
	test("'u' lifts children back into world space (no group rotation)", () => {
		const group = addBlock("scene-group", { position: "5 0 0" });
		const child = document.createElement("scene-cube");
		child.setAttribute("position", "1 0 0");
		group.appendChild(child);

		pointerDown(group);
		pressKey("u");

		expect(host.querySelector("scene-group")).toBeNull();
		expect(child.parentElement).toBe(host);
		expect(child.getAttribute("position")).toBe("6 0 0");
		expect(child.getAttribute("rotation")).toBe("0 0 0");
	});

	test("'u' composes the group's yaw into child position and rotation", () => {
		const group = addBlock("scene-group", {
			position: "0 0 0",
			rotation: "0 90 0",
		});
		const child = document.createElement("scene-cube");
		child.setAttribute("position", "2 0 0");
		group.appendChild(child);

		pointerDown(group);
		pressKey("u");

		// The group's frame turns [2,0,0] through rotateY(90°) → [0, 0, -2]; the child's
		// rotation composes with the group's by matrix, here just the group's yaw.
		expect(child.getAttribute("position")).toBe("0 0 -2");
		expect(child.getAttribute("rotation")).toBe("0 90 0");
	});

	test("'u' honours a group rotated about X, not only yaw", () => {
		// The old rebase used rotateAroundY only, so an X/Z-rotated group placed its
		// children wrong. A group tilted 90° about X turns "2 units toward the viewer"
		// (+z) into "2 units up" (+y): child at [0,0,2] lands at world [0,2,0].
		const group = addBlock("scene-group", {
			position: "0 0 0",
			rotation: "90 0 0",
		});
		const child = document.createElement("scene-cube");
		child.setAttribute("position", "0 0 2");
		group.appendChild(child);

		pointerDown(group);
		pressKey("u");

		expect(child.getAttribute("position")).toBe("0 2 0");
		expect(child.getAttribute("rotation")).toBe("90 0 0");
	});
});

// --- placement --------------------------------------------------------------

describe("placement", () => {
	test("adding then dropping creates a selected block and discards the ghost", () => {
		clickPaletteButton('[data-add="scene-cube"]');
		expect(host.querySelector("scene-ghost")).not.toBeNull();

		pointerDown(host); // drop at the current ghost position

		expect(host.querySelector("scene-ghost")).toBeNull();
		const placed = host.querySelector("scene-cube");
		expect(placed).not.toBeNull();
		expect(placed?.hasAttribute("position")).toBe(true);
		expect(selectedBlocks()).toEqual([placed]);
	});

	test("Escape cancels an in-progress placement", () => {
		clickPaletteButton('[data-add="scene-cube"]');
		pressKey("Escape");

		expect(host.querySelector("scene-ghost")).toBeNull();
	});
});

// --- inspector --------------------------------------------------------------

describe("inspector", () => {
	test("reflects the selected block and writes edits back to its attribute", async () => {
		const block = addBlock("scene-cube", { position: "1 2 3" });
		pointerDown(block);
		await flush();

		expect(inspector()?.style.display).not.toBe("none");
		expect(fieldInput("position", 0)?.value).toBe("1");
		expect(fieldInput("position", 1)?.value).toBe("2");

		const input = fieldInput("position", 0)!;
		input.value = "5";
		input.dispatchEvent(new Event("input", { bubbles: true }));

		expect(block.getAttribute("position")).toBe("5 2 3");
		expect(block.hasAttribute("x")).toBe(false);
	});

	test("the size row is disabled for a group, which has no size of its own", async () => {
		const group = addBlock("scene-group");
		pointerDown(group);
		await flush();

		expect(fieldInput("size", 0)?.disabled).toBe(true);

		// Editing it is also a no-op: no size attribute is written.
		const input = fieldInput("size", 0)!;
		input.value = "3";
		input.dispatchEvent(new Event("input", { bubbles: true }));
		expect(group.hasAttribute("size")).toBe(false);
	});
});
