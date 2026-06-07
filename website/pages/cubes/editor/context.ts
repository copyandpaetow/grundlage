import type { Vector3 } from "../scene-shared";
import type { ScenePaletteElement } from "./scene-palette";

// The editor splits across several subsystems (selection, placement, grouping), but they
// all act on one shared, mutable state — the selection wrappers, the folded blocks, the
// in-flight placement. Rather than make those module globals or thread them through every
// call, we keep them in ONE object the generator owns and hands to each subsystem by
// reference. A subsystem reads and reassigns fields on it; everyone sees the same truth.

// The transient placement preview: a translucent ghost of the geometry plus the grid it
// is dragged across. Its mere existence is the "placing" state — there is no flag.
export type Placement = {
	tag: string;
	ghost: HTMLElement;
	child: HTMLElement;
	ground: HTMLElement;
	// Null until the pointer has actually crossed the floor and we've heard a
	// `scene-floor-point`. Dropping before then is a no-op, so a click that never
	// touched the grid can't strand a block at the origin.
	position: Vector3 | null;
};

export type EditorState = {
	// The <scene-world> we author — where geometry lives and placed blocks land.
	host: HTMLElement;
	// The chrome (toolbar + inspector) mounted in our own shadow on the client.
	palette: ScenePaletteElement;
	// The selection wrappers — `gizmo > sceneSelect` — or null when nothing is selected.
	// The gizmo carries the knobs, the scene-select the cage; their existence IS the
	// selection, so no `selected` attribute ever lives on the geometry.
	gizmo: HTMLElement | null;
	sceneSelect: HTMLElement | null;
	// The blocks currently folded into the cage.
	selection: Set<HTMLElement>;
	// Where each folded block came from, so deselect (and therefore Export) restores the
	// original DOM order instead of drifting every time blocks are gathered and released.
	anchors: Map<HTMLElement, Comment>;
	// The in-progress placement, or null when not placing.
	placement: Placement | null;
};

// The lone selected block, or null when zero or many are selected — the inspector and
// ungroup only make sense for a single block.
export const primaryBlock = (state: EditorState): HTMLElement | null =>
	state.selection.size === 1 ? [...state.selection][0] : null;
