import { html, component } from "../../../../lib/src";
import {
	formatNumber,
	POSITION_SPECIFIC,
	resolveBlockTransform,
	ROTATION_SPECIFIC,
	SIZE_SPECIFIC,
} from "../scene-shared";
import "../wrappers/scene-gizmo";
import "../wrappers/scene-ghost";
import "../wrappers/scene-select";
import "./scene-palette";
import type {
	InspectorField,
	InspectorState,
	PaletteHandlers,
	ScenePaletteElement,
} from "./scene-palette";
import { type EditorState, primaryBlock } from "./context";
import { createSelection } from "./selection";
import { createPlacement } from "./placement";
import { createGrouping } from "./grouping";
import { exportScene } from "./serialization"; // scene-editor — the authoring spine, the outermost wrapper. It wraps the navigable

// scene-editor — the authoring spine, the outermost wrapper. It wraps the navigable
// scene (`<scene-editor><scene-camera><scene-world>…</scene-world></scene-camera>`) and
// reaches DOWN to the world it wraps to author it. The editor never becomes the source
// of truth: selection is DOM-native, and manipulation lives in the <scene-gizmo> that
// wraps the selected block, writing the block's own attributes. The editor only does
// selection (wrap/unwrap), placement, grouping, the palette, and serialization — and it
// toggles the camera's mode through the camera's `mode` attribute. It is transparent:
// the only thing it renders is the <scene-palette> chrome, anchored over the slotted
// viewport.
//
// The behaviour is split across cohesive modules — selection, placement, grouping,
// serialization, plus the shared transforms and the EditorState every subsystem acts
// on. This file is the coordinator: it resolves the wrapped scene, builds that state,
// wires the subsystems together, owns the palette/inspector glue, and routes the raw
// pointer/keyboard input into them.

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

customElements.define(
	"scene-editor",
	component(function* (element) {
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

		// Everything below runs only on the client — the lib stops the generator at the
		// yield on the server, so a server render emits just the slotted scene with no
		// editor chrome. Resolve the wrapped scene: `host` is the <scene-world> whose
		// geometry we author; `cameraElement` is the optional navigation wrapper whose
		// `mode` the camera button toggles (absent when editing a fixed-camera scene).
		const world = element.querySelector("scene-world");
		if (world === null) return;
		const host = world as HTMLElement;
		const cameraElement = element.querySelector("scene-camera");

		// The chrome we mount in our OWN shadow, alongside the slot.
		const palette = document.createElement(
			"scene-palette",
		) as ScenePaletteElement;

		// The one mutable state every subsystem shares by reference (see context.ts).
		const state: EditorState = {
			host,
			palette,
			gizmo: null,
			sceneSelect: null,
			selection: new Set(),
			anchors: new Map(),
			placement: null,
		};

		// Reflect the primary's transform into the inspector. We hand the palette a plain
		// snapshot and let it render; we never reach into its inputs. The panel shows for a
		// single selection (block or group); `sized` is false for a group, which has no size
		// of its own and greys out the size row.
		const updateInspector = (): void => {
			const block = primaryBlock(state);
			if (block === null) {
				palette.setProp("inspector", {
					visible: false,
					position: [0, 0, 0],
					rotation: [0, 0, 0],
					size: [1, 1, 1],
					sized: false,
				} satisfies InspectorState);
				return;
			}
			const { position, rotation, size } = resolveBlockTransform(block);
			palette.setProp("inspector", {
				visible: true,
				position,
				rotation,
				size,
				sized: SIZED_TAGS.has(block.tagName.toLowerCase()),
			} satisfies InspectorState);
		};

		// Wire the subsystems, injecting the cross-cutting glue (updateInspector, and each
		// other's entry points) so no two modules import one another.
		const selection = createSelection(state, { updateInspector });
		const placement = createPlacement(state, {
			select: selection.select,
			deselectAll: selection.deselectAll,
			repaintSelection: selection.repaintSelection,
		});
		const grouping = createGrouping(state, {
			select: selection.select,
			clearSelection: selection.clearSelection,
			repaintSelection: selection.repaintSelection,
			updateInspector,
		});

		// The palette talks to the editor through this fixed handler bag; the inspector
		// snapshot we push separately through setProp as the selection changes.
		const handlers: PaletteHandlers = {
			onAdd: placement.enterPlacement,
			onExport: () => exportScene(host),
			onDelete: selection.deleteSelection,
			onGroup: grouping.groupSelection,
			onUngroup: grouping.ungroupSelection,
			// onToggleCamera stays undefined when there is no <scene-camera> to drive, so
			// the palette hides the button. We fill it in below once the wrapper resolves.
			onField: (field, axis, value) => {
				const block = primaryBlock(state);
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
				void selection.signalGizmoResync(block);
			},
		};

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
		// the inspector snapshot we push through setProp as the selection changes.
		palette.handlers = handlers;
		element.shadowRoot?.appendChild(palette);

		// --- Pointer / key wiring ------------------------------------------------

		const onPointerDown = (event: PointerEvent): void => {
			if (event.button !== 0) return;
			// Alt + drag is the camera's look gesture — <scene-camera> owns it, so we
			// let it pass and never treat it as a selection click.
			if (event.altKey) return;
			if (event.composedPath().includes(palette)) return;
			if (state.placement !== null) {
				event.preventDefault();
				placement.dropPlacement();
				return;
			}

			const block = selection.pickBlock(event);
			if (block !== null) {
				if (event.metaKey || event.ctrlKey) selection.toggleSelect(block);
				else selection.select(block);
			} else {
				selection.deselectAll();
			}
		};

		const onKeyDown = (event: KeyboardEvent): void => {
			// Inputs live in shadow DOM; at window scope the real target is composedPath[0].
			if (event.composedPath()[0] instanceof HTMLInputElement) return;
			if (event.key === "Escape") {
				placement.cancelPlacement();
				selection.deselectAll();
				return;
			}
			if (event.key === "Delete" || event.key === "Backspace")
				selection.deleteSelection();
			if (event.key.toLowerCase() === "g") grouping.groupSelection();
			if (event.key.toLowerCase() === "u") grouping.ungroupSelection();
		};

		// The gizmo bubbles "scene-commit" after a drag; flatten the cage's rigid move
		// down into the leaf blocks and refresh the inspector against the new transform.
		const onGizmoCommit = (): void => {
			grouping.flattenSelection();
			updateInspector();
		};

		// The placement ground bubbles a floor point up through the world while placing.
		element.addEventListener("scene-floor-point", placement.onFloorPoint);
		element.addEventListener("pointerdown", onPointerDown);
		element.addEventListener("scene-commit", onGizmoCommit);
		window.addEventListener("keydown", onKeyDown);
		updateInspector();

		// Generator return = teardown, fired by the lib on disconnect (client-only).
		return () => {
			element.removeEventListener("scene-floor-point", placement.onFloorPoint);
			element.removeEventListener("pointerdown", onPointerDown);
			element.removeEventListener("scene-commit", onGizmoCommit);
			window.removeEventListener("keydown", onKeyDown);
			placement.cancelPlacement();
			palette.remove();
			for (const anchor of state.anchors.values()) anchor.remove();
		};
	}),
);
