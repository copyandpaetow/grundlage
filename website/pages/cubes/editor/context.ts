import type { Vector3 } from "../scene-shared";

//One object the generator owns and every subsystem shares by reference, so no subsystem
//keeps module state

//Its existence is the placing state, so there is no flag
export type Placement = {
	tag: string;
	ghost: HTMLElement;
	child: HTMLElement;
	ground: HTMLElement;
	//Null until the pointer has crossed the floor, so a click that never touched the
	//grid can't strand a block at the origin.
	position: Vector3 | null;
};

export type EditorState = {
	world: HTMLElement;
	//Their existence is the selection, so no `selected` attribute lands on the geometry
	gizmo: HTMLElement | null;
	sceneSelect: HTMLElement | null;
	selection: Set<HTMLElement>;
	//Deselect restores the original DOM order, so Export does not drift
	anchors: Map<HTMLElement, Comment>;
	placement: Placement | null;
};

export const primaryBlock = (state: EditorState): HTMLElement | null =>
	state.selection.size === 1 ? [...state.selection][0] : null;
