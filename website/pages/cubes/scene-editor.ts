import {
	formatNumber,
	resolveTriple,
	snapToGrid,
	UNIT_SIZE,
} from "./scene-shared";

// scene-editor — the authoring spine layered over the renderer. <scene-world>
// installs it and hands it a plain camera-controls object (not a method bolted
// onto the element). The editor never becomes the source of truth: selection is
// DOM-native, and manipulation lives in the <scene-gizmo> that wraps the selected
// block, writing the block's own attributes. The editor only does selection
// (wrap/unwrap), placement, grouping, the palette, and serialization.

// The camera surface the world exposes to us — passed in, never attached to a node.
export type CameraControls = {
	applyLook(deltaX: number, deltaY: number): void;
	zoom(delta: number): boolean;
	toggleMode(): "Free" | "Orbit";
};

const SELECTABLE_TAGS = new Set([
	"scene-cube",
	"scene-wall",
	"scene-ramp",
	"scene-group",
]);
const SIZED_TAGS = new Set(["scene-cube", "scene-wall", "scene-ramp"]);

const SIZE_SPECIFIC = ["width", "height", "depth"] as const;
const POSITION_SPECIFIC = ["x", "y", "z"] as const;
const ROTATION_SPECIFIC = ["rotate-x", "rotate-y", "rotate-z"] as const;

const GROUND_HALF_UNITS = 20;

type Vector3 = [number, number, number];

const addVectors = (a: Vector3, b: Vector3): Vector3 => [
	a[0] + b[0],
	a[1] + b[1],
	a[2] + b[2],
];
const subtractVectors = (a: Vector3, b: Vector3): Vector3 => [
	a[0] - b[0],
	a[1] - b[1],
	a[2] - b[2],
];

// Rotate a position about Y, matching CSS rotateY. Used when ungrouping a yaw-
// rotated group; X/Z group rotation stays exact only for the unrotated case (the
// Euler-order question the plan parks for later).
const rotateAroundY = ([x, y, z]: Vector3, degrees: number): Vector3 => {
	const radians = (degrees * Math.PI) / 180;
	const sin = Math.sin(radians);
	const cos = Math.cos(radians);
	return [x * cos + z * sin, y, -x * sin + z * cos];
};

const readPosition = (block: Element): Vector3 =>
	resolveTriple(block, "position", POSITION_SPECIFIC, 0);
const readRotation = (block: Element): Vector3 =>
	resolveTriple(block, "rotation", ROTATION_SPECIFIC, 0);

const isSelectable = (node: Element): boolean =>
	SELECTABLE_TAGS.has(node.tagName.toLowerCase());

export const installEditor = (
	host: HTMLElement,
	camera: CameraControls,
): (() => void) => {
	const shadowRoot = host.shadowRoot;
	if (shadowRoot === null) return () => {};

	// The primary selection is the block currently wrapped in a gizmo; `gizmo` is
	// that wrapper. `coSelection` is the lighter "these go together" set for
	// grouping, marked with a faint outline rather than a gizmo.
	let selected: HTMLElement | null = null;
	let gizmo: HTMLElement | null = null;
	const coSelection = new Set<HTMLElement>();

	type Placement = { tag: string; ghost: HTMLElement; child: HTMLElement; position: Vector3 };
	let placement: Placement | null = null;
	let looking = false;

	const ground = buildGroundPlane();
	host.appendChild(ground);

	// --- Selection (wrap / unwrap) ---------------------------------------------

	const wrap = (block: HTMLElement): void => {
		const wrapper = document.createElement("scene-gizmo");
		block.parentNode?.insertBefore(wrapper, block);
		wrapper.appendChild(block);
		selected = block;
		gizmo = wrapper;
		updateInspector();
	};

	const unwrap = (): void => {
		if (gizmo === null || selected === null) return;
		gizmo.parentNode?.insertBefore(selected, gizmo);
		gizmo.remove();
		selected = null;
		gizmo = null;
	};

	const clearCoSelection = (): void => {
		for (const block of coSelection) block.removeAttribute("co-selected");
		coSelection.clear();
	};

	const selectPrimary = (block: HTMLElement): void => {
		if (block === selected) return;
		unwrap();
		coSelection.delete(block);
		block.removeAttribute("co-selected");
		wrap(block);
	};

	const toggleCoSelect = (block: HTMLElement): void => {
		if (selected === null) {
			wrap(block);
			return;
		}
		if (block === selected) return;
		if (coSelection.has(block)) {
			coSelection.delete(block);
			block.removeAttribute("co-selected");
		} else {
			coSelection.add(block);
			block.setAttribute("co-selected", "");
		}
	};

	const deselectAll = (): void => {
		unwrap();
		clearCoSelection();
		updateInspector();
	};

	// Outermost selectable in the path, so a grouped child resolves to its group
	// and a wrapped block resolves to the block (the gizmo is not selectable).
	const pickBlock = (event: PointerEvent): HTMLElement | null => {
		let block: HTMLElement | null = null;
		for (const node of event.composedPath()) {
			if (node instanceof HTMLElement && isSelectable(node)) block = node;
		}
		return block;
	};

	// --- Camera look (Alt + left-drag) -----------------------------------------

	const onLookMove = (event: PointerEvent): void => {
		if (looking) camera.applyLook(event.movementX, event.movementY);
	};
	const onLookUp = (): void => {
		looking = false;
		window.removeEventListener("pointermove", onLookMove);
		window.removeEventListener("pointerup", onLookUp);
	};

	const onWheel = (event: WheelEvent): void => {
		if (camera.zoom(event.deltaY)) event.preventDefault();
	};

	// --- Placement -------------------------------------------------------------

	const enterPlacement = (tag: string): void => {
		cancelPlacement();
		deselectAll();
		const ghost = document.createElement("scene-ghost");
		ghost.setAttribute("position", "0 0 0");
		const child = document.createElement(tag);
		ghost.appendChild(child);
		host.appendChild(ghost);
		placement = { tag, ghost, child, position: [0, 0, 0] };
		ground.style.display = "";
	};

	const cancelPlacement = (): void => {
		if (placement === null) return;
		placement.ghost.remove();
		placement = null;
		ground.style.display = "none";
	};

	// The ground plane lies flat on Y=0, so the browser hands us the local hit
	// point as offsetX/offsetY (it already inverted the perspective): screen→world
	// on the floor is a subtraction. We write the ghost's vars live (no re-render).
	const onGroundMove = (event: PointerEvent): void => {
		if (placement === null) return;
		const half = GROUND_HALF_UNITS * UNIT_SIZE;
		const worldX = snapToGrid((event.offsetX - half) / UNIT_SIZE);
		const worldZ = snapToGrid((event.offsetY - half) / UNIT_SIZE);
		placement.position = [worldX, 0, worldZ];
		placement.ghost.style.setProperty("--block-x", `${worldX * UNIT_SIZE}px`);
		placement.ghost.style.setProperty("--block-y", "0px");
		placement.ghost.style.setProperty("--block-z", `${worldZ * UNIT_SIZE}px`);
	};

	const dropPlacement = (): void => {
		if (placement === null) return;
		const { child, position } = placement;
		child.setAttribute("position", position.map(formatNumber).join(" "));
		host.appendChild(child);
		cancelPlacement();
		selectPrimary(child);
	};

	// --- Grouping --------------------------------------------------------------

	const groupSelection = (): void => {
		const primaryBlock = selected;
		const members: HTMLElement[] = [];
		if (primaryBlock !== null) members.push(primaryBlock);
		members.push(...coSelection);
		if (members.length < 2) return;

		unwrap();
		clearCoSelection();

		const centroid = members
			.map((block) => readPosition(block))
			.reduce(addVectors, [0, 0, 0] as Vector3)
			.map((sum) => sum / members.length) as Vector3;

		const group = document.createElement("scene-group");
		group.setAttribute("position", centroid.map(formatNumber).join(" "));
		host.appendChild(group);
		for (const block of members) {
			const rebased = subtractVectors(readPosition(block), centroid);
			block.setAttribute("position", rebased.map(formatNumber).join(" "));
			block.removeAttribute("x");
			block.removeAttribute("y");
			block.removeAttribute("z");
			group.appendChild(block);
		}
		selectPrimary(group);
	};

	const ungroupSelection = (): void => {
		if (selected === null || selected.tagName.toLowerCase() !== "scene-group") {
			return;
		}
		const group = selected;
		unwrap();
		const groupPosition = readPosition(group);
		const groupRotation = readRotation(group);
		for (const child of [...group.children]) {
			if (!(child instanceof HTMLElement) || !isSelectable(child)) continue;
			const world = addVectors(
				groupPosition,
				rotateAroundY(readPosition(child), groupRotation[1]),
			);
			child.setAttribute("position", world.map(formatNumber).join(" "));
			child.setAttribute(
				"rotation",
				addVectors(readRotation(child), groupRotation)
					.map(formatNumber)
					.join(" "),
			);
			host.appendChild(child);
		}
		group.remove();
		updateInspector();
	};

	const deleteSelection = (): void => {
		// Removing the gizmo takes its wrapped child with it.
		gizmo?.remove();
		selected = null;
		gizmo = null;
		for (const block of coSelection) block.remove();
		coSelection.clear();
		updateInspector();
	};

	// --- Palette + size inspector ----------------------------------------------

	const palette = buildPalette({
		onAdd: enterPlacement,
		onExport: () => exportScene(host),
		onDelete: deleteSelection,
		onGroup: groupSelection,
		onUngroup: ungroupSelection,
		onToggleCamera: () => camera.toggleMode(),
		onSize: (axis, value) => {
			if (selected === null || !SIZED_TAGS.has(selected.tagName.toLowerCase())) {
				return;
			}
			const size = resolveTriple(selected, "size", SIZE_SPECIFIC, 1);
			size[axis] = value;
			selected.setAttribute("size", size.map(formatNumber).join(" "));
			selected.removeAttribute(SIZE_SPECIFIC[axis]);
		},
	});
	shadowRoot.appendChild(palette);

	// Reflect the primary's size into the inspector inputs, and show them only for
	// a single sized block (not a group, not a multi-selection).
	function updateInspector(): void {
		const inspector = palette.querySelector(
			".size-inspector",
		) as HTMLElement | null;
		if (inspector === null) return;
		const showable =
			selected !== null &&
			coSelection.size === 0 &&
			SIZED_TAGS.has(selected.tagName.toLowerCase());
		inspector.style.display = showable ? "" : "none";
		if (!showable || selected === null) return;
		const size = resolveTriple(selected, "size", SIZE_SPECIFIC, 1);
		for (let axis = 0; axis < 3; axis++) {
			const input = inspector.querySelector(
				`input[data-size="${axis}"]`,
			) as HTMLInputElement | null;
			if (input !== null) input.value = String(size[axis]);
		}
	}

	// --- Pointer wiring --------------------------------------------------------

	const onPointerDown = (event: PointerEvent): void => {
		if (event.button !== 0) return;
		// Alt + drag is the look gesture (touchpad-safe — no right button).
		if (event.altKey) {
			event.preventDefault();
			looking = true;
			window.addEventListener("pointermove", onLookMove);
			window.addEventListener("pointerup", onLookUp);
			return;
		}
		if (event.composedPath().includes(palette)) return;
		if (placement !== null) {
			event.preventDefault();
			dropPlacement();
			return;
		}

		const block = pickBlock(event);
		if (block !== null) {
			if (event.metaKey || event.ctrlKey) toggleCoSelect(block);
			else selectPrimary(block);
		} else {
			deselectAll();
		}
	};

	const onKeyDown = (event: KeyboardEvent): void => {
		// Inputs live in shadow DOM; at window scope the real target is composedPath[0].
		if (event.composedPath()[0] instanceof HTMLInputElement) return;
		if (event.key === "Escape") {
			cancelPlacement();
			deselectAll();
			return;
		}
		if (event.key === "Delete" || event.key === "Backspace") deleteSelection();
		if (event.key.toLowerCase() === "g") groupSelection();
		if (event.key.toLowerCase() === "u") ungroupSelection();
	};

	ground.addEventListener("pointermove", onGroundMove);
	host.addEventListener("pointerdown", onPointerDown);
	host.addEventListener("wheel", onWheel, { passive: false });
	window.addEventListener("keydown", onKeyDown);
	updateInspector();

	return () => {
		host.removeEventListener("pointerdown", onPointerDown);
		host.removeEventListener("wheel", onWheel);
		window.removeEventListener("keydown", onKeyDown);
		window.removeEventListener("pointermove", onLookMove);
		window.removeEventListener("pointerup", onLookUp);
		ground.removeEventListener("pointermove", onGroundMove);
		ground.remove();
		palette.remove();
	};
};

// --- Chrome builders ---------------------------------------------------------

const buildGroundPlane = (): HTMLElement => {
	const size = GROUND_HALF_UNITS * 2 * UNIT_SIZE;
	const plane = document.createElement("div");
	plane.style.cssText = `
		position: absolute;
		top: 50%;
		left: 50%;
		width: ${size}px;
		height: ${size}px;
		margin: ${-size / 2}px 0 0 ${-size / 2}px;
		transform: rotateX(90deg);
		display: none;
		pointer-events: auto;
		background-image:
			repeating-linear-gradient(0deg, rgba(120, 200, 255, 0.25) 0 1px, transparent 1px ${UNIT_SIZE}px),
			repeating-linear-gradient(90deg, rgba(120, 200, 255, 0.25) 0 1px, transparent 1px ${UNIT_SIZE}px);
	`;
	return plane;
};

const buildPalette = (handlers: {
	onAdd: (tag: string) => void;
	onExport: () => void;
	onDelete: () => void;
	onGroup: () => void;
	onUngroup: () => void;
	onToggleCamera: () => string;
	onSize: (axis: number, value: number) => void;
}): HTMLElement => {
	const container = document.createElement("div");
	container.className = "editor-palette";
	container.innerHTML = /*html*/ `
		<style>
			.editor-palette {
				position: absolute;
				top: 12px;
				left: 12px;
				display: flex;
				flex-direction: column;
				gap: 6px;
				padding: 8px;
				border-radius: 10px;
				background: rgba(20, 22, 28, 0.85);
				border: 1px solid rgba(255, 255, 255, 0.12);
				backdrop-filter: blur(6px);
				z-index: 1;
			}
			.editor-palette .row {
				display: flex;
				gap: 6px;
				flex-wrap: wrap;
				align-items: center;
			}
			.editor-palette button {
				font: 600 12px/1 system-ui, sans-serif;
				color: #f5f5f5;
				background: rgba(255, 255, 255, 0.08);
				border: 1px solid rgba(255, 255, 255, 0.18);
				border-radius: 6px;
				padding: 6px 9px;
				cursor: pointer;
			}
			.editor-palette button:hover {
				background: rgba(255, 255, 255, 0.16);
			}
			.editor-palette .spacer {
				width: 1px;
				align-self: stretch;
				background: rgba(255, 255, 255, 0.18);
				margin: 0 2px;
			}
			.editor-palette .size-inspector {
				gap: 4px;
				color: rgba(255, 255, 255, 0.75);
				font: 600 11px/1 system-ui, sans-serif;
			}
			.editor-palette .size-inspector input {
				width: 48px;
				font: 600 11px/1 system-ui, sans-serif;
				color: #f5f5f5;
				background: rgba(255, 255, 255, 0.08);
				border: 1px solid rgba(255, 255, 255, 0.18);
				border-radius: 5px;
				padding: 4px 5px;
			}
		</style>
		<div class="row">
			<button data-add="scene-cube">+ Cube</button>
			<button data-add="scene-wall">+ Wall</button>
			<button data-add="scene-ramp">+ Ramp</button>
			<span class="spacer"></span>
			<button data-action="group">Group</button>
			<button data-action="ungroup">Ungroup</button>
			<button data-action="delete">Delete</button>
			<span class="spacer"></span>
			<button data-action="camera">Camera: Free</button>
			<button data-action="export">Export</button>
		</div>
		<div class="row size-inspector" style="display:none">
			<span>Size</span>
			<input type="number" step="0.5" min="0.1" data-size="0" title="width" />
			<input type="number" step="0.5" min="0.1" data-size="1" title="height" />
			<input type="number" step="0.5" min="0.1" data-size="2" title="depth" />
		</div>
	`;
	container.addEventListener("click", (event) => {
		const target = event.target;
		if (!(target instanceof HTMLElement)) return;
		const addTag = target.dataset.add;
		if (addTag) handlers.onAdd(addTag);
		switch (target.dataset.action) {
			case "export":
				handlers.onExport();
				break;
			case "delete":
				handlers.onDelete();
				break;
			case "group":
				handlers.onGroup();
				break;
			case "ungroup":
				handlers.onUngroup();
				break;
			case "camera":
				target.textContent = `Camera: ${handlers.onToggleCamera()}`;
				break;
		}
	});
	container.addEventListener("input", (event) => {
		const target = event.target;
		if (!(target instanceof HTMLInputElement)) return;
		const axis = target.dataset.size;
		if (axis === undefined) return;
		const value = Number(target.value);
		if (!Number.isNaN(value) && value > 0) handlers.onSize(Number(axis), value);
	});
	return container;
};

// --- Serialization -----------------------------------------------------------

// Serialize the live scene to portable markup: skip editor-only overlays
// (gizmo/ghost are not selectable, so they fall away), recurse into groups, and
// normalize each block's shorthand-vs-specific attributes to one concrete triple
// so a reader never implements precedence. Round-trips back into an equal scene.
const serializeBlock = (
	block: Element,
	depth: number,
	lines: string[],
): void => {
	const indent = "\t".repeat(depth);
	const tag = block.tagName.toLowerCase();
	const isGroup = tag === "scene-group";

	const attributes: string[] = [];
	const position = readPosition(block);
	const rotation = readRotation(block);
	if (position.some((value) => value !== 0)) {
		attributes.push(`position="${position.map(formatNumber).join(" ")}"`);
	}
	if (rotation.some((value) => value !== 0)) {
		attributes.push(`rotation="${rotation.map(formatNumber).join(" ")}"`);
	}
	if (!isGroup) {
		const size = resolveTriple(block, "size", SIZE_SPECIFIC, 1);
		if (size.some((value) => value !== 1)) {
			attributes.push(`size="${size.map(formatNumber).join(" ")}"`);
		}
	}
	const suffix = attributes.length > 0 ? ` ${attributes.join(" ")}` : "";

	// A selected block sits inside a gizmo; serialize the real geometry, not the
	// wrapper, by recursing through children for groups only.
	const childBlocks = Array.from(block.children).filter(isSelectable);
	if (isGroup && childBlocks.length > 0) {
		lines.push(`${indent}<${tag}${suffix}>`);
		for (const child of childBlocks) serializeBlock(child, depth + 1, lines);
		lines.push(`${indent}</${tag}>`);
	} else {
		lines.push(`${indent}<${tag}${suffix}></${tag}>`);
	}
};

const exportScene = (host: HTMLElement): void => {
	const lines: string[] = ["<scene-world>"];
	// The selected block sits one level inside a gizmo wrapper, so reach through
	// it. The placement ghost is a transient preview and is deliberately skipped.
	const walk = (parent: Element): void => {
		for (const child of Array.from(parent.children)) {
			if (isSelectable(child)) serializeBlock(child, 1, lines);
			else if (child.tagName.toLowerCase() === "scene-gizmo") walk(child);
		}
	};
	walk(host);
	lines.push("</scene-world>");
	const markup = lines.join("\n");

	console.log(markup);
	void navigator.clipboard?.writeText(markup).catch(() => {});
};
