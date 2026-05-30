import {
	formatNumber,
	resolveTriple,
	snapToGrid,
	UNIT_SIZE,
} from "./scene-shared";
import type { GizmoElement, ScreenPoint } from "./scene-gizmo";

// scene-editor — the authoring spine layered over the renderer. It is installed
// by <scene-world> (which owns the camera) and turns the live DOM into an editing
// surface without ever becoming the source of truth: selection is DOM-native via
// event.composedPath(), manipulation writes the same --block-* variables the
// bridge produces, and a commit just writes an attribute and lets the bridge
// re-resolve. Editor-only chrome (the palette, the gizmo, the ground plane) lives
// in shadow roots or is stripped on export, so nothing here leaks into markup.

// Which custom elements are pickable geometry / carriers. Overlays (gizmo) and
// the world itself are excluded so clicks never select chrome. A group is
// selectable so the whole subtree moves as one.
const SELECTABLE_TAGS = new Set([
	"scene-cube",
	"scene-wall",
	"scene-ramp",
	"scene-group",
]);

const SIZE_SPECIFIC = ["width", "height", "depth"] as const;
const POSITION_SPECIFIC = ["x", "y", "z"] as const;
const ROTATION_SPECIFIC = ["rotate-x", "rotate-y", "rotate-z"] as const;

// Degrees of yaw applied per pixel of horizontal drag on the rotate handle.
const YAW_PER_PIXEL = 0.5;
// Half-extent of the placement ground plane, in grid units.
const GROUND_HALF_UNITS = 20;

type Vector3 = [number, number, number];
type DragMode = "x" | "y" | "z" | "yaw";

// Each block we drag remembers where it started so the live projection stays
// stable for the whole gesture.
type DragMember = { block: HTMLElement; startPosition: Vector3 };
type DragState = {
	mode: DragMode;
	startPointer: ScreenPoint;
	// Screen-space direction of the dragged world axis, sampled once at drag
	// start. Pointer pixels project onto this to recover world units.
	axisScreen: ScreenPoint;
	// Translation moves the whole selection rigidly; yaw spins the primary alone.
	members: DragMember[];
	primary: HTMLElement;
	startRotation: Vector3;
};

type Placement = { tag: string; ghost: HTMLElement; position: Vector3 };

// A camera element exposes this so the palette can flip free-fly ↔ orbit.
type CameraControl = { toggleCameraMode?: () => string };

const dot = (a: ScreenPoint, b: ScreenPoint): number => a.x * b.x + a.y * b.y;

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

// Rotate a position about the Y axis by `degrees`, matching CSS rotateY's sense.
// Used when ungrouping a yaw-rotated group; X/Z group rotation is left exact-only
// for the unrotated case (the Euler-order question the plan parks for later).
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
	SELECTABLE_TAGS.has(node.tagName.toLowerCase()) && !node.hasAttribute("ghost");

// The gizmo (and a block's transform) live in screen px with +Y up authored as
// -Y on screen — the same negation the bridge applies.
const positionToTransform = ([x, y, z]: Vector3): string =>
	`translate3d(${x * UNIT_SIZE}px, ${-y * UNIT_SIZE}px, ${z * UNIT_SIZE}px)`;

export const installEditor = (host: HTMLElement): (() => void) => {
	const shadowRoot = host.shadowRoot;
	if (shadowRoot === null) return () => {};

	// Selection is a set with a "primary" the gizmo tracks. It lives only in JS —
	// the lighter "move these together" concept — while a <scene-group> is the
	// serializable, transform-sharing form.
	const selection = new Set<HTMLElement>();
	let primary: HTMLElement | null = null;
	let drag: DragState | null = null;
	let placement: Placement | null = null;

	const gizmo = document.createElement("scene-gizmo") as GizmoElement;
	gizmo.style.display = "none";
	host.appendChild(gizmo);

	const ground = buildGroundPlane();
	host.appendChild(ground);

	const placeGizmo = (position: Vector3): void => {
		gizmo.style.transform = positionToTransform(position);
	};

	// --- Selection -------------------------------------------------------------

	const refreshGizmo = (): void => {
		if (primary === null) {
			gizmo.style.display = "none";
			return;
		}
		placeGizmo(readPosition(primary));
		gizmo.style.display = "";
	};

	const selectOnly = (block: HTMLElement): void => {
		for (const member of selection) member.removeAttribute("selected");
		selection.clear();
		selection.add(block);
		block.setAttribute("selected", "");
		primary = block;
		refreshGizmo();
	};

	const toggleInSelection = (block: HTMLElement): void => {
		if (selection.has(block)) {
			selection.delete(block);
			block.removeAttribute("selected");
			if (primary === block) primary = selection.values().next().value ?? null;
		} else {
			selection.add(block);
			block.setAttribute("selected", "");
			primary = block;
		}
		refreshGizmo();
	};

	const clearSelection = (): void => {
		for (const member of selection) member.removeAttribute("selected");
		selection.clear();
		primary = null;
		refreshGizmo();
	};

	// Walk the composed path outermost-last so a grouped child resolves to its
	// outermost block (the group), and surface the axis tag if a handle was hit.
	const inspectPath = (
		event: PointerEvent,
	): { block: HTMLElement | null; axis: DragMode | null } => {
		let block: HTMLElement | null = null;
		let axis: DragMode | null = null;
		for (const node of event.composedPath()) {
			if (!(node instanceof HTMLElement)) continue;
			const handleAxis = node.dataset.axis;
			if (handleAxis) axis = handleAxis as DragMode;
			if (isSelectable(node)) block = node;
		}
		return { block, axis };
	};

	// --- Live manipulation -----------------------------------------------------

	// Live drag writes go straight onto the block's inline style, overriding the
	// bridge's :host values (inline wins) so manipulation stays compositor-only
	// with no re-render. They are cleared once the commit re-resolves the bridge.
	const writeLivePosition = (block: HTMLElement, [x, y, z]: Vector3): void => {
		block.style.setProperty("--block-x", `${x * UNIT_SIZE}px`);
		block.style.setProperty("--block-y", `${-y * UNIT_SIZE}px`);
		block.style.setProperty("--block-z", `${z * UNIT_SIZE}px`);
	};
	const writeLiveYaw = (block: HTMLElement, yaw: number): void => {
		block.style.setProperty("--block-rotate-y", `${yaw}deg`);
	};
	const clearLive = (block: HTMLElement): void => {
		block.style.removeProperty("--block-x");
		block.style.removeProperty("--block-y");
		block.style.removeProperty("--block-z");
		block.style.removeProperty("--block-rotate-y");
	};

	const readLivePosition = (block: HTMLElement, fallback: Vector3): Vector3 => {
		const axis = (name: string, fallbackValue: number, sign = 1): number => {
			const raw = block.style.getPropertyValue(name);
			if (raw === "") return fallbackValue;
			return (parseFloat(raw) / UNIT_SIZE) * sign;
		};
		return [
			axis("--block-x", fallback[0]),
			axis("--block-y", fallback[1], -1),
			axis("--block-z", fallback[2]),
		];
	};
	const parseLiveYaw = (block: HTMLElement, fallback: number): number => {
		const raw = block.style.getPropertyValue("--block-rotate-y");
		return raw === "" ? fallback : parseFloat(raw);
	};

	const onPointerMove = (event: PointerEvent): void => {
		if (drag === null) return;
		const delta: ScreenPoint = {
			x: event.clientX - drag.startPointer.x,
			y: event.clientY - drag.startPointer.y,
		};

		if (drag.mode === "yaw") {
			writeLiveYaw(
				drag.primary,
				drag.startRotation[1] + delta.x * YAW_PER_PIXEL,
			);
			return;
		}

		// Project the pointer delta onto the axis's on-screen direction: the scalar
		// is in handle-lengths, and one handle length is exactly one world unit.
		const lengthSquared = dot(drag.axisScreen, drag.axisScreen);
		const units =
			lengthSquared === 0 ? 0 : dot(delta, drag.axisScreen) / lengthSquared;
		const axisIndex = drag.mode === "x" ? 0 : drag.mode === "y" ? 1 : 2;
		for (const member of drag.members) {
			const next = [...member.startPosition] as Vector3;
			next[axisIndex] = member.startPosition[axisIndex] + units;
			writeLivePosition(member.block, next);
			if (member.block === drag.primary) placeGizmo(next);
		}
	};

	// Commit on drop: snap, write the authored attribute (re-resolved by the
	// bridge), then drop the live overrides on the next frame so the freshly
	// resolved :host values take over without a flash.
	const commitDrag = (): void => {
		if (drag === null) return;
		const settled = drag;
		if (settled.mode === "yaw") {
			// Rotation snaps to whole degrees; the grid lattice is for position.
			const yaw = Math.round(
				parseLiveYaw(settled.primary, settled.startRotation[1]),
			);
			const [rotateX, , rotateZ] = settled.startRotation;
			settled.primary.setAttribute(
				"rotation",
				`${formatNumber(rotateX)} ${formatNumber(yaw)} ${formatNumber(rotateZ)}`,
			);
			requestAnimationFrame(() => clearLive(settled.primary));
		} else {
			for (const member of settled.members) {
				const committed = readLivePosition(
					member.block,
					member.startPosition,
				).map(snapToGrid) as Vector3;
				member.block.setAttribute(
					"position",
					committed.map(formatNumber).join(" "),
				);
				member.block.removeAttribute("x");
				member.block.removeAttribute("y");
				member.block.removeAttribute("z");
				if (member.block === settled.primary) placeGizmo(committed);
				const settledBlock = member.block;
				requestAnimationFrame(() => clearLive(settledBlock));
			}
		}
		drag = null;
		window.removeEventListener("pointermove", onPointerMove);
		window.removeEventListener("pointerup", commitDrag);
	};

	// --- Placement -------------------------------------------------------------

	const enterPlacement = (tag: string): void => {
		cancelPlacement();
		const ghost = document.createElement(tag);
		ghost.setAttribute("ghost", "");
		ghost.setAttribute("position", "0 0 0");
		host.appendChild(ghost);
		placement = { tag, ghost, position: [0, 0, 0] };
		ground.style.display = "";
	};

	const cancelPlacement = (): void => {
		if (placement === null) return;
		placement.ghost.remove();
		placement = null;
		ground.style.display = "none";
	};

	// The ground plane lies flat on Y=0, so the browser hands us the local hit
	// point as offsetX/offsetY (it already inverted the perspective for us):
	// screen→world on the floor is a subtraction, no projection math on our side.
	const onGroundMove = (event: PointerEvent): void => {
		if (placement === null) return;
		const half = GROUND_HALF_UNITS * UNIT_SIZE;
		const worldX = snapToGrid((event.offsetX - half) / UNIT_SIZE);
		const worldZ = snapToGrid((event.offsetY - half) / UNIT_SIZE);
		placement.position = [worldX, 0, worldZ];
		writeLivePosition(placement.ghost, placement.position);
	};

	const dropPlacement = (): void => {
		if (placement === null) return;
		const { tag, position } = placement;
		cancelPlacement();
		const block = document.createElement(tag);
		block.setAttribute("position", position.map(formatNumber).join(" "));
		host.appendChild(block);
		selectOnly(block);
	};

	// --- Grouping --------------------------------------------------------------

	// Group the current selection under a new <scene-group> at their centroid,
	// rebasing each child's position into the group's local space. Grouping is the
	// cascade: the children keep their attributes, just expressed relative to the
	// group, and inherit its transform through preserve-3d.
	const groupSelection = (): void => {
		if (selection.size < 2) return;
		const members = [...selection];
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
		clearSelection();
		selectOnly(group);
	};

	// Ungroup the primary <scene-group>: lift each child back into the world,
	// rebasing its transform into the parent's space, then drop the group.
	const ungroupSelection = (): void => {
		if (primary === null || primary.tagName.toLowerCase() !== "scene-group") {
			return;
		}
		const group = primary;
		const groupPosition = readPosition(group);
		const groupRotation = readRotation(group);
		const freed: HTMLElement[] = [];
		for (const child of [...group.children]) {
			if (!(child instanceof HTMLElement) || !isSelectable(child)) continue;
			const localPosition = readPosition(child);
			const worldPosition = addVectors(
				groupPosition,
				rotateAroundY(localPosition, groupRotation[1]),
			);
			const childRotation = readRotation(child);
			child.setAttribute("position", worldPosition.map(formatNumber).join(" "));
			child.setAttribute(
				"rotation",
				addVectors(childRotation, groupRotation).map(formatNumber).join(" "),
			);
			host.appendChild(child);
			freed.push(child);
		}
		clearSelection();
		group.remove();
		for (const block of freed) {
			selection.add(block);
			block.setAttribute("selected", "");
			primary = block;
		}
		refreshGizmo();
	};

	const deleteSelection = (): void => {
		if (selection.size === 0) return;
		const doomed = [...selection];
		clearSelection();
		for (const block of doomed) block.remove();
	};

	// --- Event wiring ----------------------------------------------------------

	const palette = buildPalette({
		onAdd: enterPlacement,
		onExport: () => exportScene(host),
		onDelete: deleteSelection,
		onGroup: groupSelection,
		onUngroup: ungroupSelection,
		onToggleCamera: () =>
			(host as unknown as CameraControl).toggleCameraMode?.() ?? "free",
	});
	shadowRoot.appendChild(palette);

	const onPointerDown = (event: PointerEvent): void => {
		// Left button only; the world keeps the right button for camera look.
		if (event.button !== 0) return;
		// Palette chrome is not a scene interaction — bail before we would deselect
		// so the palette's own click handlers see the current selection.
		if (event.composedPath().includes(palette)) return;
		// In placement mode a click drops the previewed block.
		if (placement !== null) {
			event.preventDefault();
			dropPlacement();
			return;
		}

		const { block, axis } = inspectPath(event);

		// A gizmo handle starts a manipulation on the current selection.
		if (axis !== null && primary !== null) {
			event.preventDefault();
			event.stopPropagation();
			const points = gizmo.getHandlePoints();
			const tip = axis === "x" ? points.x : axis === "y" ? points.y : points.z;
			drag = {
				mode: axis,
				startPointer: { x: event.clientX, y: event.clientY },
				axisScreen:
					axis === "yaw"
						? { x: 0, y: 0 }
						: { x: tip.x - points.origin.x, y: tip.y - points.origin.y },
				members:
					axis === "yaw"
						? [{ block: primary, startPosition: readPosition(primary) }]
						: [...selection].map((member) => ({
								block: member,
								startPosition: readPosition(member),
							})),
				primary,
				startRotation: readRotation(primary),
			};
			window.addEventListener("pointermove", onPointerMove);
			window.addEventListener("pointerup", commitDrag);
			return;
		}

		if (block !== null) {
			if (event.shiftKey) toggleInSelection(block);
			else selectOnly(block);
		} else {
			clearSelection();
		}
	};

	const onKeyDown = (event: KeyboardEvent): void => {
		if (event.key === "Escape") {
			cancelPlacement();
			clearSelection();
			return;
		}
		if (selection.size === 0) return;
		if (event.key === "Delete" || event.key === "Backspace") deleteSelection();
		if (event.key.toLowerCase() === "g") groupSelection();
		if (event.key.toLowerCase() === "u") ungroupSelection();
	};

	ground.addEventListener("pointermove", onGroundMove);
	host.addEventListener("pointerdown", onPointerDown);
	window.addEventListener("keydown", onKeyDown);

	return () => {
		host.removeEventListener("pointerdown", onPointerDown);
		window.removeEventListener("keydown", onKeyDown);
		window.removeEventListener("pointermove", onPointerMove);
		window.removeEventListener("pointerup", commitDrag);
		ground.removeEventListener("pointermove", onGroundMove);
		gizmo.remove();
		ground.remove();
		palette.remove();
	};
};

// --- Chrome builders ---------------------------------------------------------

// The placement floor: one flat element with CSS grid lines, rotated onto Y=0.
// Hidden until placement starts; the editor reads pointer offsets off it.
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
		background-image:
			repeating-linear-gradient(0deg, rgba(120, 200, 255, 0.25) 0 1px, transparent 1px ${UNIT_SIZE}px),
			repeating-linear-gradient(90deg, rgba(120, 200, 255, 0.25) 0 1px, transparent 1px ${UNIT_SIZE}px);
	`;
	return plane;
};

// Build the editor toolbar as a detached subtree (styles inline so it carries no
// dependency on the page stylesheet) for the world to host in its shadow.
const buildPalette = (handlers: {
	onAdd: (tag: string) => void;
	onExport: () => void;
	onDelete: () => void;
	onGroup: () => void;
	onUngroup: () => void;
	onToggleCamera: () => string;
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
				gap: 6px;
				flex-wrap: wrap;
				padding: 8px;
				border-radius: 10px;
				background: rgba(20, 22, 28, 0.85);
				border: 1px solid rgba(255, 255, 255, 0.12);
				backdrop-filter: blur(6px);
				z-index: 1;
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
				background: rgba(255, 255, 255, 0.18);
				margin: 0 2px;
			}
		</style>
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
	return container;
};

// --- Serialization -----------------------------------------------------------

// Serialize the live scene to portable markup: strip editor-only overlays and
// attributes, recurse into groups, and normalize each block's shorthand-vs-
// specific attributes to a single concrete triple so a reader never has to
// implement precedence. The result round-trips — re-importing yields an
// equivalent scene.
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
	// Groups carry no size of their own; only geometry does.
	if (!isGroup) {
		const size = resolveTriple(block, "size", SIZE_SPECIFIC, 1);
		if (size.some((value) => value !== 1)) {
			attributes.push(`size="${size.map(formatNumber).join(" ")}"`);
		}
	}
	const suffix = attributes.length > 0 ? ` ${attributes.join(" ")}` : "";

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
	for (const child of Array.from(host.children)) {
		if (isSelectable(child)) serializeBlock(child, 1, lines);
	}
	lines.push("</scene-world>");
	const markup = lines.join("\n");

	console.log(markup);
	void navigator.clipboard?.writeText(markup).catch(() => {});
};
