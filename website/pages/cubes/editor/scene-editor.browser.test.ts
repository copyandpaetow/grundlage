import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import "./scene-editor";
import "../shapes/scene-cube";
import "../wrappers/scene-group";

//scene-cube and scene-group are defined, because wrapping measures rendered bounds. The
//other shapes and wrappers stay inert: selection, serialization and the mode toggle read
//only tag names and attributes.

let editor: HTMLElement;
let sceneCamera: HTMLElement;
let world: HTMLElement;

//The palette re-renders a microtask after the editor sets its inspector prop
const flush = (): Promise<void> => new Promise((resolve) => queueMicrotask(resolve));

let dispose: () => void;

beforeEach(() => {
	//Connected in one shot, so the editor sees its world and camera at connect
	editor = document.createElement("scene-editor");
	sceneCamera = document.createElement("scene-camera");
	world = document.createElement("scene-world");
	sceneCamera.appendChild(world);
	editor.appendChild(sceneCamera);
	document.body.appendChild(editor);
	dispose = () => editor.remove();
});

afterEach(async () => {
	//disconnectedCallback fires teardown a microtask later (it waits to rule out a
	//move), so let that settle before tearing down the world.
	dispose();
	await flush();
	world.remove();
});

const addBlock = (tag: string, attributes: Record<string, string> = {}): HTMLElement => {
	const block = document.createElement(tag);
	for (const [name, value] of Object.entries(attributes)) {
		block.setAttribute(name, value);
	}
	world.appendChild(block);
	return block;
};

//The handler reads only MouseEvent fields and composedPath
const pointerDown = (target: EventTarget, meta = false): void => {
	target.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0, metaKey: meta }));
};

const pressKey = (key: string): void => {
	window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
};

const moveOverFloor = (x: number, z: number): void => {
	world
		.querySelector("scene-ground")
		?.dispatchEvent(new CustomEvent("scene-floor-point", { bubbles: true, detail: { x, z } }));
};

const paletteShadow = (): ShadowRoot | null =>
	(editor.shadowRoot?.querySelector("scene-palette") as HTMLElement | null)?.shadowRoot ?? null;

const clickPaletteButton = (selector: string): void => {
	const button = paletteShadow()?.querySelector(selector);
	button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
};

const gizmo = (): HTMLElement | null => world.querySelector("scene-gizmo");
const sceneSelect = (): HTMLElement | null => world.querySelector("scene-select");
const selectedBlocks = (): HTMLElement[] => {
	const select = sceneSelect();
	if (select === null) return [];
	return [...select.children].filter((child) =>
		["scene-cube", "scene-wall", "scene-ramp", "scene-group"].includes(child.tagName.toLowerCase()),
	) as HTMLElement[];
};
const inspector = (): HTMLElement | null =>
	paletteShadow()?.querySelector(".inspector") as HTMLElement | null;
const fieldInput = (field: string, axis: number): HTMLInputElement | null =>
	paletteShadow()?.querySelector(
		`input[data-field="${field}"][data-axis="${axis}"]`,
	) as HTMLInputElement | null;

describe("selection wrapping", () => {
	test("clicking a block wraps it in scene-gizmo > scene-select", () => {
		const block = addBlock("scene-cube");
		pointerDown(block);

		expect(gizmo()).not.toBeNull();
		expect(sceneSelect()?.parentElement).toBe(gizmo());
		expect(block.parentElement).toBe(sceneSelect());
		expect([...world.children]).not.toContain(block);
	});

	test("clicking empty space deselects and returns the block to the world", () => {
		const block = addBlock("scene-cube");
		pointerDown(block);
		pointerDown(world);

		expect(gizmo()).toBeNull();
		expect(block.parentElement).toBe(world);
	});

	test("selecting another block clears the first selection", () => {
		const first = addBlock("scene-cube");
		const second = addBlock("scene-cube");
		pointerDown(first);
		pointerDown(second);

		expect(world.querySelectorAll("scene-gizmo")).toHaveLength(1);
		expect(first.parentElement).toBe(world);
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

		expect(world.querySelectorAll("scene-select")).toHaveLength(1);
		expect(new Set(selectedBlocks())).toEqual(new Set([first, second]));
		//The inspector only makes sense for one block, so it hides for many.
		expect(inspector()?.style.display).toBe("none");
	});

	test("deselecting restores the original DOM order (anchors)", () => {
		const a = addBlock("scene-cube");
		const b = addBlock("scene-cube");
		const c = addBlock("scene-cube");

		pointerDown(b);
		pointerDown(a, true);
		pointerDown(c, true);
		pointerDown(world); //deselect everything

		const order = [...world.children].filter(
			(child) => child.tagName.toLowerCase() === "scene-cube",
		);
		expect(order).toEqual([a, b, c]);
	});

	test("meta-clicking the last selected block clears the selection", () => {
		const block = addBlock("scene-cube");
		pointerDown(block);
		pointerDown(block, true); //fold the only block back out

		expect(gizmo()).toBeNull();
		expect(block.parentElement).toBe(world);
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
		expect(world.contains(a)).toBe(false);
		expect(world.contains(b)).toBe(false);
	});
});

describe("grouping", () => {
	test("'g' wraps ≥2 blocks in a group at their centroid with rebased children", () => {
		const a = addBlock("scene-cube", { position: "2 0 0" });
		const b = addBlock("scene-cube", { position: "4 0 0" });
		pointerDown(a);
		pointerDown(b, true);
		pressKey("g");

		const group = world.querySelector("scene-group");
		expect(group).not.toBeNull();
		expect(group?.getAttribute("position")).toBe("3 0 0");

		//Children are reparented under the group, rebased into group-local space,
		//and their per-axis overrides cleared.
		expect(a.parentElement).toBe(group);
		expect(b.parentElement).toBe(group);
		expect(a.getAttribute("position")).toBe("-1 0 0");
		expect(b.getAttribute("position")).toBe("1 0 0");
		expect(a.hasAttribute("x")).toBe(false);

		expect(selectedBlocks()).toEqual([group]);
	});

	test("'Wrap in cube' sizes the cube to the selection's bounds", () => {
		const a = addBlock("scene-cube", { position: "2 0 0" });
		const b = addBlock("scene-cube", { position: "4 0 0" });
		pointerDown(a);
		pointerDown(b, true);
		clickPaletteButton('[data-action="wrap-in-cube"]');

		const wrapper = selectedBlocks()[0];
		expect(wrapper.tagName.toLowerCase()).toBe("scene-cube");
		expect(wrapper.getAttribute("position")).toBe("3 0 0");
		expect(wrapper.getAttribute("size")).toBe("3 1 1");
		expect(a.parentElement).toBe(wrapper);
		expect(a.getAttribute("position")).toBe("-1 0 0");
	});

	test("'Wrap in cube' wraps a single block, which a group would not", () => {
		const a = addBlock("scene-cube", { position: "2 0 0" });
		pointerDown(a);
		clickPaletteButton('[data-action="wrap-in-cube"]');

		const wrapper = selectedBlocks()[0];
		expect(wrapper.tagName.toLowerCase()).toBe("scene-cube");
		expect(wrapper.getAttribute("size")).toBe("1 1 1");
		expect(a.parentElement).toBe(wrapper);
	});

	test("'g' with fewer than two blocks selected does nothing", () => {
		const a = addBlock("scene-cube", { position: "2 0 0" });
		pointerDown(a);
		pressKey("g");

		expect(world.querySelector("scene-group")).toBeNull();
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

		expect(world.querySelector("scene-group")).toBeNull();
		expect(child.parentElement).toBe(world);
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

		//The group's frame turns [2,0,0] through rotateY(90°) → [0, 0, -2]; the child's
		//rotation composes with the group's by matrix, here just the group's yaw.
		expect(child.getAttribute("position")).toBe("0 0 -2");
		expect(child.getAttribute("rotation")).toBe("0 90 0");
	});

	test("'u' honours a group rotated about X, not only yaw", () => {
		//A group tilted 90° about X turns +z into +y: [0,0,2] lands at world [0,2,0]
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

describe("nesting", () => {
	//A group turned 90° about Y, holding two cubes in its own frame.
	const addTurnedGroup = (): {
		group: HTMLElement;
		first: HTMLElement;
		second: HTMLElement;
	} => {
		const group = addBlock("scene-group", {
			position: "10 0 0",
			rotation: "0 90 0",
		});
		const first = document.createElement("scene-cube");
		first.setAttribute("position", "2 0 0");
		const second = document.createElement("scene-cube");
		second.setAttribute("position", "4 0 0");
		group.append(first, second);
		return { group, first, second };
	};

	test("clicking a selected block again selects the block inside it", () => {
		const { group, first } = addTurnedGroup();
		pointerDown(first);
		expect(selectedBlocks()).toEqual([group]);
		pointerDown(first);
		expect(selectedBlocks()).toEqual([first]);
	});

	test("export keeps a block selected inside another block", () => {
		const outer = addBlock("scene-cube", { position: "1 0 0" });
		const inner = document.createElement("scene-cube");
		inner.setAttribute("position", "0 2 0");
		outer.appendChild(inner);
		pointerDown(inner);
		pointerDown(inner);
		expect(selectedBlocks()).toEqual([inner]);

		const log = vi.spyOn(console, "log").mockImplementation(() => {});
		clickPaletteButton('[data-action="export"]');
		const markup = log.mock.calls[0]?.[0];
		log.mockRestore();
		expect(markup).toBe(
			[
				"<scene-world>",
				'\t<scene-cube position="1 0 0">',
				'\t\t<scene-cube position="0 2 0"></scene-cube>',
				"\t</scene-cube>",
				"</scene-world>",
			].join("\n"),
		);
	});

	test("wrapping blocks inside a turned group keeps them in that group's frame", () => {
		const { group, first, second } = addTurnedGroup();
		pointerDown(first);
		pointerDown(first);
		pointerDown(second, true);
		pressKey("g");

		const inner = selectedBlocks()[0];
		pressKey("Escape");
		expect(inner.parentElement).toBe(group);
		expect(inner.getAttribute("position")).toBe("3 0 0");
		expect(first.getAttribute("position")).toBe("-1 0 0");
	});

	test("unwrapping a nested group lifts its children into the outer group only", () => {
		const { group } = addTurnedGroup();
		const inner = document.createElement("scene-group");
		inner.setAttribute("position", "0 0 0");
		inner.setAttribute("rotation", "0 90 0");
		const child = document.createElement("scene-cube");
		child.setAttribute("position", "2 0 0");
		inner.appendChild(child);
		group.appendChild(inner);

		pointerDown(child);
		pointerDown(child);
		expect(selectedBlocks()).toEqual([inner]);
		pressKey("u");

		//Lifted through the inner group's 90° alone: [2,0,0] → [0,0,-2], still inside
		//the outer group, which keeps adding its own frame on screen.
		expect(child.parentElement).toBe(group);
		expect(child.getAttribute("position")).toBe("0 0 -2");
		expect(child.getAttribute("rotation")).toBe("0 90 0");
	});
});

describe("placement", () => {
	test("adding then dropping creates a selected block and discards the ghost", () => {
		clickPaletteButton('[data-add="scene-cube"]');
		expect(world.querySelector("scene-ghost")).not.toBeNull();

		moveOverFloor(2, 3); //cross the grid so the drop has a point to land on
		pointerDown(world); //drop at the current ghost position

		expect(world.querySelector("scene-ghost")).toBeNull();
		const placed = world.querySelector("scene-cube");
		expect(placed).not.toBeNull();
		expect(placed?.getAttribute("position")).toBe("2 0 3");
		expect(selectedBlocks()).toEqual([placed]);
	});

	test("dropping before the pointer crosses the grid strands no block", () => {
		clickPaletteButton('[data-add="scene-cube"]');
		pointerDown(world); //click without ever moving over the floor

		//The only cube left is the ghost's preview child, so nothing landed at the origin
		expect(world.querySelector("scene-ghost")).not.toBeNull();
		expect(world.querySelector(":scope > scene-cube")).toBeNull();
		expect(selectedBlocks()).toEqual([]);
	});

	test("Escape cancels an in-progress placement", () => {
		clickPaletteButton('[data-add="scene-cube"]');
		pressKey("Escape");

		expect(world.querySelector("scene-ghost")).toBeNull();
	});
});

describe("camera", () => {
	test("the camera button flips the wrapped scene-camera's mode attribute", () => {
		expect(sceneCamera.getAttribute("mode")).toBeNull();

		clickPaletteButton('[data-action="camera"]');
		expect(sceneCamera.getAttribute("mode")).toBe("orbit");

		clickPaletteButton('[data-action="camera"]');
		expect(sceneCamera.getAttribute("mode")).toBe("free");
	});
});

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
		input.dispatchEvent(new Event("change", { bubbles: true }));

		expect(block.getAttribute("position")).toBe("5 2 3");
		expect(block.hasAttribute("x")).toBe(false);
	});

	test("the size row is disabled for a group, which has no size of its own", async () => {
		const group = addBlock("scene-group");
		pointerDown(group);
		await flush();

		expect(fieldInput("size", 0)?.disabled).toBe(true);

		//Editing it is also a no-op: no size attribute is written.
		const input = fieldInput("size", 0)!;
		input.value = "3";
		input.dispatchEvent(new Event("change", { bubbles: true }));
		expect(group.hasAttribute("size")).toBe(false);
	});
});
