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

// The inspector edits one authored triple at a time; this maps the field name to
// its per-axis specific attributes (so editing `position` clears a stale `x`).
type InspectorField = "position" | "rotation" | "size";
const FIELD_SPECIFIC: Record<
	InspectorField,
	readonly [string, string, string]
> = {
	position: POSITION_SPECIFIC,
	rotation: ROTATION_SPECIFIC,
	size: SIZE_SPECIFIC,
};

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

	// Selection wraps the chosen blocks in ONE `<scene-gizmo><scene-select>…</scene-select>
	// </scene-gizmo>`: the gizmo carries the knobs, the scene-select the cage. Every
	// selected block — the first and any cmd-clicked extras — is a sibling inside that
	// one scene-select, so a single-block and a multi-block selection look identical and
	// the gizmo moves/rotates them all with one logic. The wrappers' existence IS the
	// selection; no `selected` attribute lives on the geometry.
	let gizmo: HTMLElement | null = null;
	let sceneSelect: HTMLElement | null = null;
	const selection = new Set<HTMLElement>();
	// Keeps the inspector inputs in step while the selected block is edited from
	// anywhere else — chiefly a gizmo handle drag, which commits by writing the block's
	// own attributes. Without this the inputs go stale and the next spinner nudge writes
	// a stale value back, undoing the drag.
	let selectionObserver: MutationObserver | null = null;

	// The lone selected block, or null when zero or many are selected — the inspector
	// only makes sense for a single block.
	const primaryBlock = (): HTMLElement | null =>
		selection.size === 1 ? [...selection][0] : null;

	type Placement = { tag: string; ghost: HTMLElement; child: HTMLElement; position: Vector3 };
	let placement: Placement | null = null;
	let looking = false;

	const ground = buildGroundPlane();
	host.appendChild(ground);

	// --- Selection (wrap / unwrap) ---------------------------------------------

	const observeSelection = (): void => {
		selectionObserver?.disconnect();
		selectionObserver = new MutationObserver(() => updateInspector());
		for (const block of selection) {
			selectionObserver.observe(block, {
				attributes: true,
				attributeFilter: [
					"position",
					"rotation",
					"size",
					...POSITION_SPECIFIC,
					...ROTATION_SPECIFIC,
					...SIZE_SPECIFIC,
				],
			});
		}
	};

	// Pulling a block into the cage leaves a comment anchor at its original spot in
	// the host, so deselecting drops it back exactly where it was. Without this the
	// live DOM order — and therefore Export order — drifted every time blocks were
	// gathered into one selection and released.
	const anchors = new Map<HTMLElement, Comment>();

	const foldIn = (block: HTMLElement): void => {
		if (sceneSelect === null) return;
		const anchor = document.createComment("scene-selection-anchor");
		block.parentNode?.insertBefore(anchor, block);
		anchors.set(block, anchor);
		sceneSelect.appendChild(block);
		selection.add(block);
	};

	const foldOut = (block: HTMLElement): void => {
		const anchor = anchors.get(block);
		if (anchor?.parentNode != null) {
			anchor.parentNode.insertBefore(block, anchor);
			anchor.remove();
		} else {
			host.appendChild(block);
		}
		anchors.delete(block);
		selection.delete(block);
	};

	// Tear the wrappers down, dropping every block back onto its anchor.
	const clearSelection = (): void => {
		if (gizmo === null) return;
		selectionObserver?.disconnect();
		selectionObserver = null;
		for (const block of [...selection]) foldOut(block);
		gizmo.remove();
		gizmo = null;
		sceneSelect = null;
		selection.clear();
	};

	// Build the gizmo + scene-select at the block's spot, then fold the block in.
	const buildSelection = (block: HTMLElement): void => {
		gizmo = document.createElement("scene-gizmo");
		sceneSelect = document.createElement("scene-select");
		gizmo.appendChild(sceneSelect);
		block.parentNode?.insertBefore(gizmo, block);
		foldIn(block);
	};

	const select = (block: HTMLElement): void => {
		if (selection.size === 1 && selection.has(block)) return;
		clearSelection();
		buildSelection(block);
		observeSelection();
		updateInspector();
	};

	// Cmd/Ctrl-click: fold a block into the existing cage (or lift it back out),
	// so the gizmo operates on the whole set at once.
	const toggleSelect = (block: HTMLElement): void => {
		if (gizmo === null || sceneSelect === null) {
			select(block);
			return;
		}
		if (selection.has(block)) {
			foldOut(block);
			if (selection.size === 0) clearSelection();
			else observeSelection();
		} else {
			foldIn(block);
			observeSelection();
		}
		updateInspector();
	};

	const deselectAll = (): void => {
		clearSelection();
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
		select(child);
	};

	// --- Grouping --------------------------------------------------------------

	const groupSelection = (): void => {
		const members = [...selection];
		if (members.length < 2) return;

		clearSelection();

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
			// The attribute → re-render bridge is async, but the group's own translate
			// renders synchronously on connect. If we leave it there, the cage's first
			// sync (run synchronously inside select()) reads each child's STALE world
			// position while the group already carries the centroid, so the centroid is
			// double-counted and the highlight box sits one centroid off. We write the
			// rebased transform to the live inline channel too (inline wins over the
			// shadow :host rule) so the first read sees the new group-local position.
			block.style.setProperty("--block-x", `${rebased[0] * UNIT_SIZE}px`);
			block.style.setProperty("--block-y", `${-rebased[1] * UNIT_SIZE}px`);
			block.style.setProperty("--block-z", `${rebased[2] * UNIT_SIZE}px`);
			group.appendChild(block);
		}
		select(group);
		// Once the bridge has re-resolved the rebased attributes, drop the live
		// overrides so the blocks fall back to their authored values — the same
		// commit-then-clear the gizmo uses after a drag. Clearing the inline `style`
		// is itself a mutation the new scene-select observer catches, so the cage
		// re-syncs against the now-settled positions.
		requestAnimationFrame(() => {
			for (const block of members) {
				block.style.removeProperty("--block-x");
				block.style.removeProperty("--block-y");
				block.style.removeProperty("--block-z");
			}
		});
	};

	const ungroupSelection = (): void => {
		const group = primaryBlock();
		if (group === null || group.tagName.toLowerCase() !== "scene-group") {
			return;
		}
		clearSelection();
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
		if (gizmo === null) return;
		// Removing the gizmo takes the scene-select and every wrapped block with it;
		// the blocks' anchors stay behind in the host, so clear them too.
		selectionObserver?.disconnect();
		selectionObserver = null;
		for (const anchor of anchors.values()) anchor.remove();
		anchors.clear();
		gizmo.remove();
		gizmo = null;
		sceneSelect = null;
		selection.clear();
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
		onField: (field, axis, value) => {
			const block = primaryBlock();
			if (block === null) return;
			if (field === "size" && !SIZED_TAGS.has(block.tagName.toLowerCase())) {
				return;
			}
			const specific = FIELD_SPECIFIC[field];
			const triple = resolveTriple(
				block,
				field,
				specific,
				field === "size" ? 1 : 0,
			);
			triple[axis] = value;
			block.setAttribute(field, triple.map(formatNumber).join(" "));
			// Clear the per-axis override so the edited shorthand wins.
			block.removeAttribute(specific[axis]);
		},
	});
	shadowRoot.appendChild(palette);

	// Reflect the primary's transform into the inspector inputs. The whole panel
	// shows for a single selection (block or group); the size row is disabled for a
	// group, which has no size of its own.
	function updateInspector(): void {
		const inspector = palette.querySelector(".inspector") as HTMLElement | null;
		if (inspector === null) return;
		const block = primaryBlock();
		inspector.style.display = block !== null ? "" : "none";
		if (block === null) return;
		const sized = SIZED_TAGS.has(block.tagName.toLowerCase());
		const fields: InspectorField[] = ["position", "rotation", "size"];
		for (const field of fields) {
			const triple = resolveTriple(
				block,
				field,
				FIELD_SPECIFIC[field],
				field === "size" ? 1 : 0,
			);
			for (let axis = 0; axis < 3; axis++) {
				const input = inspector.querySelector(
					`input[data-field="${field}"][data-axis="${axis}"]`,
				) as HTMLInputElement | null;
				if (input === null) continue;
				input.value = String(triple[axis]);
				if (field === "size") input.disabled = !sized;
			}
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
			if (event.metaKey || event.ctrlKey) toggleSelect(block);
			else select(block);
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
		selectionObserver?.disconnect();
		for (const anchor of anchors.values()) anchor.remove();
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
	onField: (
		field: InspectorField,
		axis: number,
		value: number,
	) => void;
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
			.editor-palette .inspector {
				display: flex;
				flex-direction: column;
				gap: 4px;
			}
			.editor-palette .field-row {
				gap: 4px;
				color: rgba(255, 255, 255, 0.75);
				font: 600 11px/1 system-ui, sans-serif;
			}
			.editor-palette .field-row > span {
				width: 30px;
			}
			.editor-palette .field-row input {
				width: 48px;
				font: 600 11px/1 system-ui, sans-serif;
				color: #f5f5f5;
				background: rgba(255, 255, 255, 0.08);
				border: 1px solid rgba(255, 255, 255, 0.18);
				border-radius: 5px;
				padding: 4px 5px;
			}
			.editor-palette .field-row input:disabled {
				opacity: 0.4;
				cursor: not-allowed;
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
		<div class="inspector" style="display:none">
			<div class="row field-row">
				<span>Pos</span>
				<input type="number" step="0.5" data-field="position" data-axis="0" title="x" />
				<input type="number" step="0.5" data-field="position" data-axis="1" title="y" />
				<input type="number" step="0.5" data-field="position" data-axis="2" title="z" />
			</div>
			<div class="row field-row">
				<span>Rot</span>
				<input type="number" step="15" data-field="rotation" data-axis="0" title="rotate-x" />
				<input type="number" step="15" data-field="rotation" data-axis="1" title="rotate-y" />
				<input type="number" step="15" data-field="rotation" data-axis="2" title="rotate-z" />
			</div>
			<div class="row field-row">
				<span>Size</span>
				<input type="number" step="0.5" min="0.1" data-field="size" data-axis="0" title="width" />
				<input type="number" step="0.5" min="0.1" data-field="size" data-axis="1" title="height" />
				<input type="number" step="0.5" min="0.1" data-field="size" data-axis="2" title="depth" />
			</div>
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
		const field = target.dataset.field as InspectorField | undefined;
		const axis = target.dataset.axis;
		if (field === undefined || axis === undefined) return;
		const value = Number(target.value);
		if (Number.isNaN(value)) return;
		// Position and rotation accept any value; only size must stay positive.
		if (field === "size" && value <= 0) return;
		handlers.onField(field, Number(axis), value);
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
	// Selected blocks sit inside a scene-select inside a gizmo, so reach through both
	// wrappers. The placement ghost is a transient preview and is deliberately skipped.
	const walk = (parent: Element): void => {
		for (const child of Array.from(parent.children)) {
			if (isSelectable(child)) serializeBlock(child, 1, lines);
			else if (
				child.tagName.toLowerCase() === "scene-gizmo" ||
				child.tagName.toLowerCase() === "scene-select"
			)
				walk(child);
		}
	};
	walk(host);
	lines.push("</scene-world>");
	const markup = lines.join("\n");

	console.log(markup);
	void navigator.clipboard?.writeText(markup).catch(() => {});
};
