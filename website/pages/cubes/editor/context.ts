import type { Vector3 } from "../scene-shared";

// The editor splits across subsystems (selection, placement, grouping) that all act on
// one shared, mutable state. Rather than make those module globals or thread them through
// every call, the generator owns ONE object and hands it to each subsystem by reference.

// The transient placement preview: a translucent ghost plus the grid it is dragged
// across. Its existence IS the "placing" state — there is no flag.
export type Placement = {
	tag: string;
	ghost: HTMLElement;
	child: HTMLElement;
	ground: HTMLElement;
	// Null until the pointer has crossed the floor, so a click that never touched the
	// grid can't strand a block at the origin.
	position: Vector3 | null;
};

export type EditorState = {
	// The <scene-world> we author: where geometry lives and placed blocks land.
	world: HTMLElement;
	// The selection wrappers, `gizmo > sceneSelect`, or null when nothing is selected.
	// Their existence IS the selection, so no `selected` attribute ever lives on the
	// geometry.
	gizmo: HTMLElement | null;
	sceneSelect: HTMLElement | null;
	selection: Set<HTMLElement>;
	// Where each folded block came from, so deselect (and therefore Export) restores the
	// original DOM order instead of drifting every time blocks are gathered and released.
	anchors: Map<HTMLElement, Comment>;
	placement: Placement | null;
};

// The inspector and ungroup only make sense for a single block.
export const primaryBlock = (state: EditorState): HTMLElement | null =>
	state.selection.size === 1 ? [...state.selection][0] : null;
