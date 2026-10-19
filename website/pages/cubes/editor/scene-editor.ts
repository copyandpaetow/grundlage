import { html, component, type Template } from "../../../../lib/src";
import {
	blockTransformFromAttributes,
	formatNumber,
	POSITION_SPECIFIC,
	ROTATION_SPECIFIC,
	SIZE_SPECIFIC,
} from "../scene-shared";
import "../wrappers/scene-gizmo";
import "../wrappers/scene-ghost";
import "../wrappers/scene-select";
import "./scene-palette";
import type {
	CameraMode,
	InspectorField,
	InspectorState,
	PaletteCommand,
	PaletteCommandEvent,
} from "./scene-palette";
import { type EditorState, primaryBlock } from "./context";
import { createSelection } from "./selection";
import { createPlacement } from "./placement";
import { createGrouping } from "./grouping";
import { exportScene } from "./serialization";

// <scene-editor> — the authoring spine and the outermost wrapper. It wraps the navigable
// scene (`<scene-editor><scene-camera><scene-world>…`) and reaches DOWN into the world to
// author it, without ever becoming the source of truth: selection is DOM-native and
// manipulation lives in the <scene-gizmo> that wraps the selected block, writing the
// block's own attributes. The editor does selection, placement, grouping, the palette and
// serialization, and toggles the camera through its `mode` attribute. The only thing it
// renders is the palette chrome, anchored over the slotted viewport.
//
// The behaviour is split across cohesive modules; this file is the coordinator. It
// resolves the wrapped scene, builds the shared state, wires the subsystems together,
// answers the palette's commands, and routes raw pointer and keyboard input into them.

// Geometry that has a size of its own: everything except the group carrier, which would
// distort its children if scaled.
const SIZED_TAGS = new Set(["scene-cube", "scene-wall", "scene-ramp"]);

// Editing a shorthand clears the per-axis override it would otherwise lose to.
const FIELD_SPECIFIC: Record<
	InspectorField,
	readonly [string, string, string]
> = {
	position: POSITION_SPECIFIC,
	rotation: ROTATION_SPECIFIC,
	size: SIZE_SPECIFIC,
};

// :host is a positioned block so the absolutely-placed palette anchors to the viewport;
// the slot keeps the wrapped camera and world in flow. One literal for both paints, so
// adding the palette patches the shell instead of rebuilding the slot.
const editorShell = (palette: Template | null) => html`
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
	${palette}
`;

// A press on the chrome is never a click into the scene behind it.
const keepPointerOutOfScene = (event: Event): void => event.stopPropagation();

customElements.define(
	"scene-editor",
	component(function* ({ host }) {
		yield editorShell(null);

		// Everything below runs only on the client, so a server render emits just the
		// slotted scene with no editor chrome. The camera is optional, and its absence is
		// what hides the camera button.
		const world = host.querySelector<HTMLElement>("scene-world");
		if (world === null) return;
		const cameraElement = host.querySelector("scene-camera");

		const state: EditorState = {
			world,
			gizmo: null,
			sceneSelect: null,
			selection: new Set(),
			anchors: new Map(),
			placement: null,
		};

		// Null while zero or many blocks are selected, which hides the panel.
		let inspector: InspectorState | null = null;

		const updateInspector = (): void => {
			const block = primaryBlock(state);
			if (block === null) {
				inspector = null;
			} else {
				const { position, rotation, size } =
					blockTransformFromAttributes(block);
				inspector = {
					position,
					rotation,
					size,
					sized: SIZED_TAGS.has(block.tagName.toLowerCase()),
				};
			}
			void host.update();
		};

		// Injecting the cross-cutting glue keeps any two subsystems from importing each
		// other.
		const selection = createSelection(state, { updateInspector });
		const placement = createPlacement(state, {
			select: selection.select,
			deselectAll: selection.deselectAll,
		});
		const grouping = createGrouping(state, {
			select: selection.select,
			clearSelection: selection.clearSelection,
			repaintSelection: selection.repaintSelection,
			updateInspector,
		});

		const editField = (
			field: InspectorField,
			axis: number,
			value: number,
		): void => {
			const block = primaryBlock(state);
			if (block === null) return;
			if (field === "size" && !SIZED_TAGS.has(block.tagName.toLowerCase()))
				return;

			const triple = blockTransformFromAttributes(block)[field];
			triple[axis] = value;
			block.setAttribute(field, triple.map(formatNumber).join(" "));
			block.removeAttribute(FIELD_SPECIFIC[field][axis]);
			updateInspector();
			void selection.signalGizmoResync(block);
		};

		// Read off the camera's own attribute rather than mirrored, so it cannot drift.
		const cameraMode = (): CameraMode | null => {
			if (cameraElement === null) return null;
			return cameraElement.getAttribute("mode") === "orbit" ? "orbit" : "free";
		};

		const toggleCamera = (): void => {
			if (cameraElement === null) return;
			cameraElement.setAttribute(
				"mode",
				cameraMode() === "orbit" ? "free" : "orbit",
			);
			void host.update();
		};

		const runPaletteCommand = (event: Event): void => {
			const command: PaletteCommand = (event as PaletteCommandEvent).detail;
			switch (command.kind) {
				case "add":
					placement.enterPlacement(command.tag);
					return;
				case "export":
					exportScene(world);
					return;
				case "delete":
					selection.deleteSelection();
					return;
				case "group":
					grouping.groupSelection();
					return;
				case "ungroup":
					grouping.ungroupSelection();
					return;
				case "toggle-camera":
					toggleCamera();
					return;
				case "edit-field":
					editField(command.field, command.axis, command.value);
					return;
				default:
					return command satisfies never;
			}
		};

		const onPointerDown = (event: PointerEvent): void => {
			if (event.button !== 0) return;
			// Alt + drag is the camera's look gesture, so it is never a selection click.
			if (event.altKey) return;
			if (state.placement !== null) {
				event.preventDefault();
				placement.dropPlacement();
				return;
			}

			const block = selection.pickBlock(event);
			if (block === null) {
				selection.deselectAll();
				return;
			}
			if (event.metaKey || event.ctrlKey) selection.toggleSelect(block);
			else selection.select(block);
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

		// After a gizmo drag, flatten the cage's rigid move down into the leaf blocks.
		const onGizmoCommit = (): void => {
			grouping.flattenSelection();
			updateInspector();
		};

		host.addEventListener("scene-floor-point", placement.onFloorPoint);
		host.addEventListener("pointerdown", onPointerDown);
		host.addEventListener("scene-commit", onGizmoCommit);
		window.addEventListener("keydown", onKeyDown);

		yield function* view() {
			yield editorShell(html`
				<scene-palette
					inspector=${inspector}
					cameraMode=${cameraMode()}
					on-palette-command=${runPaletteCommand}
					onPointerDown=${keepPointerOutOfScene}
				></scene-palette>
			`);
		};

		return () => {
			host.removeEventListener("scene-floor-point", placement.onFloorPoint);
			host.removeEventListener("pointerdown", onPointerDown);
			host.removeEventListener("scene-commit", onGizmoCommit);
			window.removeEventListener("keydown", onKeyDown);
			placement.cancelPlacement();
			for (const anchor of state.anchors.values()) anchor.remove();
		};
	}),
);
