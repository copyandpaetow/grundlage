import { formatNumber, snapToGrid } from "../scene-shared";
import type { EditorState } from "./context";
import "./scene-ground";

// The ghost and the ground exist only while placing, so there is no visibility flag

export type PlacementDeps = {
	select: (block: HTMLElement) => void;
	deselectAll: () => void;
};

export type PlacementApi = {
	enterPlacement: (tag: string) => void;
	cancelPlacement: () => void;
	onFloorPoint: (event: Event) => void;
	dropPlacement: () => void;
};

export const createPlacement = (state: EditorState, deps: PlacementDeps): PlacementApi => {
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
		state.world.appendChild(ghost);

		const ground = document.createElement("scene-ground");
		ground.slot = "ground";
		state.world.appendChild(ground);

		state.placement = { tag, ghost, child, ground, position: null };
	};

	// Snapped here, so the floor stays policy-free
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
	};

	const dropPlacement = (): void => {
		// The pointer never crossed the grid, so the block would land at the origin
		if (state.placement === null || state.placement.position === null) return;
		const { child, position } = state.placement;
		child.setAttribute("position", position.map(formatNumber).join(" "));
		state.world.appendChild(child);
		cancelPlacement();
		deps.select(child);
	};

	return { enterPlacement, cancelPlacement, onFloorPoint, dropPlacement };
};
