import {
	blockRendered,
	commitBlockRender,
	formatNumber,
	isBlock,
	POSITION_SPECIFIC,
	resolveBlockTransform,
	ROTATION_SPECIFIC,
	SIZE_SPECIFIC,
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

// Geometry that has a size of its own — everything except the group carrier, which
// would distort its children if scaled. Used to disable the inspector's size row.
const SIZED_TAGS = new Set(["scene-cube", "scene-wall", "scene-ramp"]);

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

// Author-space position (grid units, +Y up) ↔ the screen-px point the geometry
// translates to (+Y down). The bridge negates Y, so we mirror that here.
const toScreenPoint = ([x, y, z]: Vector3): DOMPoint =>
	new DOMPoint(x * UNIT_SIZE, -y * UNIT_SIZE, z * UNIT_SIZE);
const fromScreenPoint = (point: DOMPoint): Vector3 => [
	point.x / UNIT_SIZE,
	-point.y / UNIT_SIZE,
	point.z / UNIT_SIZE,
];

// A pure rotation matrix in the geometry's own order (rotateX · rotateY · rotateZ),
// built from a resolved Euler triple. We compose two of these by matrix multiply to
// combine rotations — Euler angles do NOT compose by addition, which is why the old
// rotateAroundY-plus-sum approach was only ever right for a yaw-only group.
const rotationMatrix = ([rotateX, rotateY, rotateZ]: Vector3): DOMMatrix =>
	new DOMMatrix(
		`rotateX(${rotateX}deg) rotateY(${rotateY}deg) rotateZ(${rotateZ}deg)`,
	);

// The full transform a group contributes to its children: translate then rotate, in
// the same order the geometry's :host writes it (a group never scales). A child lifts
// into the parent frame by pushing its own translation through this.
const frameMatrix = (position: Vector3, rotation: Vector3): DOMMatrix =>
	new DOMMatrix(
		`translate3d(${position[0] * UNIT_SIZE}px, ${-position[1] * UNIT_SIZE}px, ${
			position[2] * UNIT_SIZE
		}px) rotateX(${rotation[0]}deg) rotateY(${rotation[1]}deg) rotateZ(${
			rotation[2]
		}deg)`,
	);

// Decompose a rotation matrix back into the geometry's rotateX·rotateY·rotateZ Euler
// triple (degrees), mirroring the composition order so a round-trip is stable. Reads
// the rotated basis vectors out of the matrix; falls back to a yaw-only read at the
// ±90° pitch gimbal, where the X and Z rotations couple and one must be chosen as 0.
const eulerFromMatrix = (matrix: DOMMatrix): Vector3 => {
	const xAxis = matrix.transformPoint(new DOMPoint(1, 0, 0));
	const yAxis = matrix.transformPoint(new DOMPoint(0, 1, 0));
	const zAxis = matrix.transformPoint(new DOMPoint(0, 0, 1));
	const sinPitch = Math.max(-1, Math.min(1, zAxis.x));
	const pitch = Math.asin(sinPitch);
	const toDegrees = (radians: number): number => (radians * 180) / Math.PI;
	if (Math.abs(Math.cos(pitch)) > 1e-6) {
		return [
			toDegrees(Math.atan2(-zAxis.y, zAxis.z)),
			toDegrees(pitch),
			toDegrees(Math.atan2(-yAxis.x, xAxis.x)),
		];
	}
	// Gimbal lock: fold the coupled rotation into X and leave Z at zero.
	return [toDegrees(Math.atan2(sinPitch * xAxis.y, yAxis.y)), toDegrees(pitch), 0];
};

// Drop a block's in-flight inline transform override so it falls back to its authored
// --block-* (set once the committed attribute has re-rendered — see commitBlockRender).
const clearLiveTransform = (block: HTMLElement): void => {
	block.style.removeProperty("--block-x");
	block.style.removeProperty("--block-y");
	block.style.removeProperty("--block-z");
};

const readPosition = (block: Element): Vector3 =>
	resolveBlockTransform(block).position;
const readRotation = (block: Element): Vector3 =>
	resolveBlockTransform(block).rotation;

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
	// The inspector stays in step with the selected block through the two events that
	// edit it, rather than by observing the block's attributes for our own writes: a
	// gizmo drag commits with a bubbling "scene-commit" event we listen for below, and
	// an inspector spinner edit goes through onField, which refreshes the inputs itself.

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

	// After an inspector edit the block re-renders asynchronously; once it has, signal
	// the gizmo so its handles and cage re-pin to the new transform (it no longer
	// observes the block's attributes — that change is one we own here).
	const signalGizmoResync = async (block: HTMLElement): Promise<void> => {
		await blockRendered(block);
		gizmo?.dispatchEvent(new CustomEvent("scene-resync"));
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

	// Drop the gizmo + scene-select and reset the selection state. The two callers
	// differ only in what they do with the blocks FIRST: clearSelection folds them back
	// out onto their anchors; deleteSelection discards them with the gizmo.
	const teardownSelection = (): void => {
		gizmo?.remove();
		gizmo = null;
		sceneSelect = null;
		selection.clear();
	};

	// Tear the wrappers down, dropping every block back onto its anchor.
	const clearSelection = (): void => {
		if (gizmo === null) return;
		for (const block of [...selection]) foldOut(block);
		teardownSelection();
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
		} else {
			foldIn(block);
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
			if (node instanceof HTMLElement && isBlock(node)) block = node;
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
			// The rebased attribute re-renders ASYNCHRONOUSLY, but the group's own
			// translate renders synchronously on connect. Until the child catches up its
			// resolved --block-* still hold its old WORLD position, which — now inside the
			// group's centroid translate — would double-count and put the cage one
			// centroid off. So we also write the rebased transform to the inline channel
			// (inline wins over the shadow :host rule) so the first measure reads it.
			block.style.setProperty("--block-x", `${rebased[0] * UNIT_SIZE}px`);
			block.style.setProperty("--block-y", `${-rebased[1] * UNIT_SIZE}px`);
			block.style.setProperty("--block-z", `${rebased[2] * UNIT_SIZE}px`);
			group.appendChild(block);
		}
		select(group);
		// Same commit-then-clear the gizmo uses after a drag: once each child has
		// re-rendered from its rebased attribute (commitBlockRender awaits that), drop
		// the inline override so it falls back to its authored value — no flash, because
		// by then the resolved transform already matches.
		void Promise.all(
			members.map((block) => commitBlockRender(block, clearLiveTransform)),
		);
	};

	const ungroupSelection = (): void => {
		const group = primaryBlock();
		if (group === null || group.tagName.toLowerCase() !== "scene-group") {
			return;
		}
		clearSelection();
		// The group's full frame and its rotation alone. Each child lifts into world
		// space by pushing its position through the frame and composing its rotation
		// with the group's BY MATRIX — correct for a group authored with X/Z rotation,
		// not only the yaw case the old add-the-Euler-triples math handled.
		const frame = frameMatrix(readPosition(group), readRotation(group));
		const groupRotation = rotationMatrix(readRotation(group));
		for (const child of [...group.children]) {
			if (!(child instanceof HTMLElement) || !isBlock(child)) continue;
			const world = fromScreenPoint(
				frame.transformPoint(toScreenPoint(readPosition(child))),
			);
			const rotation = eulerFromMatrix(
				groupRotation.multiply(rotationMatrix(readRotation(child))),
			);
			child.setAttribute("position", world.map(formatNumber).join(" "));
			child.setAttribute("rotation", rotation.map(formatNumber).join(" "));
			host.appendChild(child);
		}
		group.remove();
		updateInspector();
	};

	const deleteSelection = (): void => {
		if (gizmo === null) return;
		// Removing the gizmo takes the scene-select and every wrapped block with it;
		// the blocks' anchors stay behind in the host, so clear them too.
		for (const anchor of anchors.values()) anchor.remove();
		anchors.clear();
		teardownSelection();
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
			const triple = resolveBlockTransform(block)[field];
			triple[axis] = value;
			block.setAttribute(field, triple.map(formatNumber).join(" "));
			// Clear the per-axis override so the edited shorthand wins.
			block.removeAttribute(specific[axis]);
			// Reflect the normalized value back into the inputs, and once the block has
			// re-rendered, have the gizmo re-pin its handles and cage to the new transform.
			updateInspector();
			void signalGizmoResync(block);
		},
	});
	shadowRoot.appendChild(palette);

	// Reflect the primary's transform into the inspector inputs. The whole panel
	// shows for a single selection (block or group); the size row is disabled for a
	// group, which has no size of its own.
	const updateInspector = (): void => {
		const inspector = palette.querySelector(".inspector") as HTMLElement | null;
		if (inspector === null) return;
		const block = primaryBlock();
		inspector.style.display = block !== null ? "" : "none";
		if (block === null) return;
		const sized = SIZED_TAGS.has(block.tagName.toLowerCase());
		const transform = resolveBlockTransform(block);
		const fields: InspectorField[] = ["position", "rotation", "size"];
		for (const field of fields) {
			const triple = transform[field];
			for (let axis = 0; axis < 3; axis++) {
				const input = inspector.querySelector(
					`input[data-field="${field}"][data-axis="${axis}"]`,
				) as HTMLInputElement | null;
				if (input === null) continue;
				input.value = String(triple[axis]);
				if (field === "size") input.disabled = !sized;
			}
		}
	};

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

	// The gizmo signals a drag commit by bubbling "scene-commit" up to us; refresh the
	// inspector inputs against the freshly committed transform.
	const onGizmoCommit = (): void => updateInspector();

	ground.addEventListener("pointermove", onGroundMove);
	host.addEventListener("pointerdown", onPointerDown);
	host.addEventListener("wheel", onWheel, { passive: false });
	host.addEventListener("scene-commit", onGizmoCommit);
	window.addEventListener("keydown", onKeyDown);
	updateInspector();

	return () => {
		host.removeEventListener("pointerdown", onPointerDown);
		host.removeEventListener("wheel", onWheel);
		host.removeEventListener("scene-commit", onGizmoCommit);
		window.removeEventListener("keydown", onKeyDown);
		window.removeEventListener("pointermove", onLookMove);
		window.removeEventListener("pointerup", onLookUp);
		ground.removeEventListener("pointermove", onGroundMove);
		ground.remove();
		palette.remove();
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
		const size = resolveBlockTransform(block).size;
		if (size.some((value) => value !== 1)) {
			attributes.push(`size="${size.map(formatNumber).join(" ")}"`);
		}
	}
	const suffix = attributes.length > 0 ? ` ${attributes.join(" ")}` : "";

	// A selected block sits inside a gizmo; serialize the real geometry, not the
	// wrapper, by recursing through children for groups only.
	const childBlocks = Array.from(block.children).filter(isBlock);
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
			if (isBlock(child)) serializeBlock(child, 1, lines);
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
