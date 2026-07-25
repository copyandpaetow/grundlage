import { blockRendered, formatNumber, snapToGrid } from "../scene-shared";
import type { EditorState } from "./context";
import "./scene-ground";

// Placement chrome is transient, like the selection wrappers: its existence IS the
// "placing" state. We drop a translucent ghost of the geometry and a <scene-ground>
// grid into the world — the ground rides the world's `ground` slot into its 3D floor
// space — and remove both when placement ends, so there is no visibility flag to keep.

export type PlacementDeps = {
	select: (block: HTMLElement) => void;
	deselectAll: () => void;
	repaintSelection: () => void;
};

export type PlacementApi = {
	enterPlacement: (tag: string) => void;
	cancelPlacement: () => void;
	onFloorPoint: (event: Event) => void;
	dropPlacement: () => void;
};

export const createPlacement = (
	state: EditorState,
	deps: PlacementDeps,
): PlacementApi => {
	const cancelPlacement = (): void => {
		if (state.placement === null) return;
		state.placement.ghost.remove();
		state.placement.ground.remove();
		state.placement = null;
	};

	const enterPlacement = (tag: string): void => {
		cancelPlacement();
		deps.deselectAll();
		const ghost = document.createElement("scene-ghost");
		ghost.setAttribute("position", "0 0 0");
		const child = document.createElement(tag);
		ghost.appendChild(child);
		state.host.appendChild(ghost);

		const ground = document.createElement("scene-ground");
		ground.slot = "ground";
		state.host.appendChild(ground);

		state.placement = { tag, ghost, child, ground, position: null };
	};

	// The ground reports where the pointer sits on the floor, in world units; we snap
	// it to the authoring lattice (the floor stays policy-free) and drive the ghost's
	// position attribute — the render channel is fast enough per frame now that the
	// sheet stays static (css value-indirection), so there is no inline-var side lane.
	// The direct update() skips the attribute observer's microtask hops so the ghost
	// re-renders in the same frame as the pointer move; the observer's own trailing
	// update lands on the skip path (nothing changed) and writes no DOM.
	const onFloorPoint = (event: Event): void => {
		if (state.placement === null) return;
		const { x, z } = (event as CustomEvent<{ x: number; z: number }>).detail;
		const worldX = snapToGrid(x);
		const worldZ = snapToGrid(z);
		state.placement.position = [worldX, 0, worldZ];
		state.placement.ghost.setAttribute(
			"position",
			`${formatNumber(worldX)} 0 ${formatNumber(worldZ)}`,
		);
		void blockRendered(state.placement.ghost);
	};

	const dropPlacement = (): void => {
		// No floor point yet means the pointer never crossed the grid — ignore the
		// drop rather than stranding the block at the origin.
		if (state.placement === null || state.placement.position === null) return;
		const { child, position } = state.placement;
		child.setAttribute("position", position.map(formatNumber).join(" "));
		state.host.appendChild(child);
		cancelPlacement();
		deps.select(child);
		// The placed block rendered at the origin while it rode the ghost (the ghost
		// carried the live position, not the bare child). Its drop position is a fresh
		// attribute that re-renders ASYNCHRONOUSLY, so the cage and gizmo that select()
		// just measured pinned to that stale origin. Re-pin them once the block has
		// rendered at the drop point — same commit-then-repaint the gizmo/group use.
		void blockRendered(child).then(deps.repaintSelection);
	};

	return { enterPlacement, cancelPlacement, onFloorPoint, dropPlacement };
};
