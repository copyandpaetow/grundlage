import { html, render } from "../../../lib/src";
import {
	blockRendered,
	commitBlockRender,
	eulerFromMatrix,
	formatNumber,
	frameMatrix,
	fromScreenPoint,
	isBlock,
	POSITION_SPECIFIC,
	resolveBlockTransform,
	rotationMatrix,
	ROTATION_SPECIFIC,
	SIZE_SPECIFIC,
	snapToGrid,
	toScreenPoint,
	UNIT_SIZE,
} from "./scene-shared";
import "./scene-ground";
import type {
	InspectorField,
	InspectorState,
	PaletteHandlers,
	ScenePaletteElement,
} from "./scene-palette";
import "./scene-palette";
import "./wrappers/scene-gizmo";
import "./wrappers/scene-ghost";
import "./wrappers/scene-select";

// scene-editor — the authoring spine, the outermost wrapper. It wraps the navigable
// scene (`<scene-editor><scene-camera><scene-world>…</scene-world></scene-camera>`) and
// reaches DOWN to the world it wraps to author it. The editor never becomes the source
// of truth: selection is DOM-native, and manipulation lives in the <scene-gizmo> that
// wraps the selected block, writing the block's own attributes. The editor only does
// selection (wrap/unwrap), placement, grouping, the palette, and serialization — and it
// toggles the camera's mode through the camera's `mode` attribute. It is transparent:
// the only thing it renders is the <scene-palette> chrome, anchored over the slotted
// viewport.

// Geometry that has a size of its own — everything except the group carrier, which
// would distort its children if scaled. Used to disable the inspector's size row.
const SIZED_TAGS = new Set(["scene-cube", "scene-wall", "scene-ramp"]);

// The inspector edits one authored triple at a time; this maps the field name to
// its per-axis specific attributes (so editing `position` clears a stale `x`).
const FIELD_SPECIFIC: Record<
	InspectorField,
	readonly [string, string, string]
> = {
	position: POSITION_SPECIFIC,
	rotation: ROTATION_SPECIFIC,
	size: SIZE_SPECIFIC,
};

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

// The transform-matrix helpers (toScreenPoint / fromScreenPoint / frameMatrix /
// rotationMatrix / eulerFromMatrix) live in scene-shared now — the gizmo composes
// transforms with the same maths when it drives its direct child.

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

// <scene-editor> — the authoring spine, the outermost wrapper. It reaches down to the
// `<scene-world>` it wraps (the geometry it operates on) and, if present, the
// `<scene-camera>` between them (whose `mode` it toggles). Both are resolved once after
// the first yield — client-only, since the lib stops the generator at that yield on the
// server, so a server render emits just the slotted scene with no editor chrome. The
// returned function is the teardown the lib fires on disconnect.

customElements.define(
	"scene-editor",
	render(function* (element) {
		// Resolved after the first yield from the wrapped subtree. `host` is the world
		// whose geometry we author; `cameraElement` is the optional navigation wrapper
		// whose `mode` the camera button toggles (absent when editing a fixed-camera
		// scene). `palette` is the chrome we mount in our own shadow on the client.
		let host: HTMLElement;
		let cameraElement: Element | null = null;
		let palette: ScenePaletteElement;

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

		type Placement = {
			tag: string;
			ghost: HTMLElement;
			child: HTMLElement;
			ground: HTMLElement;
			// Null until the pointer has actually crossed the floor and we've heard a
			// `scene-floor-point`. Dropping before then is a no-op, so a click that never
			// touched the grid can't strand a block at the origin.
			position: Vector3 | null;
		};
		let placement: Placement | null = null;

		// --- Selection (wrap / unwrap) ---------------------------------------------

		// One render channel: the gizmo and cage do not observe their content (they pull it at
		// render time), so WE — the coordinator that changes their content — re-render them. This
		// re-pins the gizmo handles and re-fits the cage box to whatever the selection now holds.
		const repaintSelection = (): void => {
			type Renderable = { update?: () => Promise<void> };
			void (gizmo as Renderable | null)?.update?.();
			void (sceneSelect as Renderable | null)?.update?.();
		};

		// After an inspector edit the block re-renders asynchronously; once it has, re-render the
		// selection chrome so its handles and box re-pin to the new transform (it no longer
		// observes the block's attributes — that change is one we own here).
		const signalGizmoResync = async (block: HTMLElement): Promise<void> => {
			await blockRendered(block);
			repaintSelection();
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
			// The gizmo and cage ran their first render against an empty fresh cage. Now that the
			// block is folded in, re-render both so the handles pin to it and the box fits it.
			repaintSelection();
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
			// Both the cage box and the gizmo handles re-pin to the new set; we own the content
			// change, so we re-render them.
			repaintSelection();
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

		// --- Placement -------------------------------------------------------------

		// Placement chrome is transient, like the selection wrappers: its existence IS the
		// "placing" state. We drop a translucent ghost of the geometry and a <scene-ground>
		// grid into the world — the ground rides the world's `ground` slot into its 3D floor
		// space — and remove both when placement ends, so there is no visibility flag to keep.
		const enterPlacement = (tag: string): void => {
			cancelPlacement();
			deselectAll();
			const ghost = document.createElement("scene-ghost");
			ghost.setAttribute("position", "0 0 0");
			const child = document.createElement(tag);
			ghost.appendChild(child);
			host.appendChild(ghost);

			const ground = document.createElement("scene-ground");
			ground.slot = "ground";
			host.appendChild(ground);

			placement = { tag, ghost, child, ground, position: null };
		};

		const cancelPlacement = (): void => {
			if (placement === null) return;
			placement.ghost.remove();
			placement.ground.remove();
			placement = null;
		};

		// The ground reports where the pointer sits on the floor, in world units; we snap
		// it to the authoring lattice (the floor stays policy-free) and drive the ghost's
		// vars live (no re-render).
		const onFloorPoint = (event: Event): void => {
			if (placement === null) return;
			const { x, z } = (event as CustomEvent<{ x: number; z: number }>).detail;
			const worldX = snapToGrid(x);
			const worldZ = snapToGrid(z);
			placement.position = [worldX, 0, worldZ];
			placement.ghost.style.setProperty("--block-x", `${worldX * UNIT_SIZE}px`);
			placement.ghost.style.setProperty("--block-y", "0px");
			placement.ghost.style.setProperty("--block-z", `${worldZ * UNIT_SIZE}px`);
		};

		const dropPlacement = (): void => {
			// No floor point yet means the pointer never crossed the grid — ignore the
			// drop rather than stranding the block at the origin.
			if (placement === null || placement.position === null) return;
			const { child, position } = placement;
			child.setAttribute("position", position.map(formatNumber).join(" "));
			host.appendChild(child);
			cancelPlacement();
			select(child);
			// The placed block rendered at the origin while it rode the ghost (the ghost
			// carried the live position, not the bare child). Its drop position is a fresh
			// attribute that re-renders ASYNCHRONOUSLY, so the cage and gizmo that select()
			// just measured pinned to that stale origin. Re-pin them once the block has
			// rendered at the drop point — same commit-then-repaint the gizmo/group use.
			void blockRendered(child).then(repaintSelection);
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

		const handlers: PaletteHandlers = {
			onAdd: enterPlacement,
			onExport: () => exportScene(host),
			onDelete: deleteSelection,
			onGroup: groupSelection,
			onUngroup: ungroupSelection,
			// onToggleCamera stays undefined when there is no <scene-camera> to drive, so
			// the palette hides the button. We fill it in below once the wrapper resolves.
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
		};
		// Reflect the primary's transform into the inspector. We hand the palette a plain
		// snapshot and let it render; we never reach into its inputs. The panel shows for a
		// single selection (block or group); `sized` is false for a group, which has no size
		// of its own and greys out the size row.
		const updateInspector = (): void => {
			const block = primaryBlock();
			if (block === null) {
				palette.setProperty("inspector", {
					visible: false,
					position: [0, 0, 0],
					rotation: [0, 0, 0],
					size: [1, 1, 1],
					sized: false,
				} satisfies InspectorState);
				return;
			}
			const { position, rotation, size } = resolveBlockTransform(block);
			palette.setProperty("inspector", {
				visible: true,
				position,
				rotation,
				size,
				sized: SIZED_TAGS.has(block.tagName.toLowerCase()),
			} satisfies InspectorState);
		};

		// --- Pointer wiring --------------------------------------------------------

		const onPointerDown = (event: PointerEvent): void => {
			if (event.button !== 0) return;
			// Alt + drag is the camera's look gesture — <scene-camera> owns it, so we
			// let it pass and never treat it as a selection click.
			if (event.altKey) return;
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
			if (event.key === "Delete" || event.key === "Backspace")
				deleteSelection();
			if (event.key.toLowerCase() === "g") groupSelection();
			if (event.key.toLowerCase() === "u") ungroupSelection();
		};

		// The gizmo commits a drag by bubbling "scene-commit": it has written the dragged
		// transform onto its direct child — our scene-select cage — as one rigid move, then
		// settled. We flatten that transform down into the leaf blocks so the blocks stay the
		// single source of truth and the cage returns to identity. The gizmo knows nothing of
		// this; it just transformed its child.
		const flattenSelection = (): void => {
			if (sceneSelect === null) return;
			const cage = sceneSelect;
			const blocks = [...selection];
			if (blocks.length === 0) return;
			// The cage's committed frame and its rotation alone. Each block lifts into world
			// space by pushing its position through the frame and composing its rotation with
			// the cage's BY MATRIX — correct for any cage rotation, not just yaw.
			const frame = frameMatrix(readPosition(cage), readRotation(cage));
			const cageRotation = rotationMatrix(readRotation(cage));
			for (const block of blocks) {
				const world = fromScreenPoint(
					frame.transformPoint(toScreenPoint(readPosition(block))),
				).map(snapToGrid) as Vector3;
				const rotation = eulerFromMatrix(
					cageRotation.multiply(rotationMatrix(readRotation(block))),
				).map((degrees) => Math.round(degrees)) as Vector3;
				block.setAttribute("position", world.map(formatNumber).join(" "));
				block.setAttribute("rotation", rotation.map(formatNumber).join(" "));
				block.removeAttribute("x");
				block.removeAttribute("y");
				block.removeAttribute("z");
			}
			// Return the cage to identity. The blocks now hold the full transform; until both
			// they and the cage re-render the visible pose is unchanged (cage-frame ·
			// block-local == the new world transform), so flipping the pair in one render
			// batch shows no flash. Once settled, re-pin the gizmo handles to the flattened
			// blocks.
			cage.setAttribute("position", "0 0 0");
			cage.setAttribute("rotation", "0 0 0");
			void Promise.all(
				[cage, ...blocks].map((node) => blockRendered(node as HTMLElement)),
			).then(repaintSelection);
		};
		const onGizmoCommit = (): void => {
			flattenSelection();
			updateInspector();
		};

		// The editor is transparent: it renders the palette chrome over the slotted
		// scene. `:host` is a positioned block so the absolutely-placed palette anchors
		// to the viewport; the slot keeps the wrapped camera/world in flow with
		// display:contents (no extra box around the 3D scene).
		yield html`
			<style>
				:host {
					display: block;
					position: relative;
				}
				slot {
					display: contents;
				}
			</style>
			<slot></slot>
		`;

		// Everything below runs only on the client (the lib stops the generator at the
		// yield on the server). Resolve the wrapped scene and mount the chrome.
		const world = element.querySelector("scene-world");
		if (world === null) return;
		host = world as HTMLElement;
		cameraElement = element.querySelector("scene-camera");

		// Toggle the camera through its `mode` attribute — declarative, one-directional,
		// no method bolted onto the element. Wired only when there is a camera to drive,
		// which is what makes the palette show or hide the button.
		if (cameraElement !== null) {
			const cameraToToggle = cameraElement;
			handlers.onToggleCamera = (): string => {
				const next =
					cameraToToggle.getAttribute("mode") === "orbit" ? "free" : "orbit";
				cameraToToggle.setAttribute("mode", next);
				return next === "orbit" ? "Orbit" : "Free";
			};
		}

		// Handlers never change, so we hand them over as a plain property before mounting;
		// the inspector snapshot we push through update() as the selection changes. The
		// palette lives in our OWN shadow, alongside the slot.
		palette = document.createElement("scene-palette") as ScenePaletteElement;
		palette.handlers = handlers;
		element.shadowRoot?.appendChild(palette);

		// The placement ground bubbles a floor point up through the world while placing.
		element.addEventListener("scene-floor-point", onFloorPoint);
		element.addEventListener("pointerdown", onPointerDown);
		element.addEventListener("scene-commit", onGizmoCommit);
		window.addEventListener("keydown", onKeyDown);
		updateInspector();

		return () => {
			element.removeEventListener("scene-floor-point", onFloorPoint);
			element.removeEventListener("pointerdown", onPointerDown);
			element.removeEventListener("scene-commit", onGizmoCommit);
			window.removeEventListener("keydown", onKeyDown);
			cancelPlacement();
			palette.remove();
			for (const anchor of anchors.values()) anchor.remove();
		};
	}),
);

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
