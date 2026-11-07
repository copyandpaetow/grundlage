import { sceneElementRendered } from "../scene-shared";
import { isBlock } from "../scene-geometry";
import type { EditorState } from "./context";

// Every selected block sits in one cage, so one and many blocks share one structure and
// the gizmo moves them alike

export type SelectionDeps = {
	updateInspector: () => void;
};

export type SelectionApi = {
	select: (block: HTMLElement) => void;
	toggleSelect: (block: HTMLElement) => void;
	deselectAll: () => void;
	clearSelection: () => void;
	deleteSelection: () => void;
	repaintSelection: () => void;
	signalGizmoResync: (block: HTMLElement) => Promise<void>;
	pickBlock: (event: PointerEvent) => HTMLElement | null;
};

export const createSelection = (state: EditorState, deps: SelectionDeps): SelectionApi => {
	const { updateInspector } = deps;

	// The gizmo and cage read their content only when rendering, so whoever changes it
	// re-renders them
	const repaintSelection = (): void => {
		if (state.gizmo !== null) void sceneElementRendered(state.gizmo);
		if (state.sceneSelect !== null) void sceneElementRendered(state.sceneSelect);
	};

	// An inspector edit re-renders the block asynchronously; the selection chrome only
	// re-pins correctly once that has landed.
	const signalGizmoResync = async (block: HTMLElement): Promise<void> => {
		await sceneElementRendered(block);
		repaintSelection();
	};

	// The anchor keeps DOM order, and so Export, stable across gather and release
	const foldIn = (block: HTMLElement): void => {
		if (state.sceneSelect === null) return;
		const anchor = document.createComment("scene-selection-anchor");
		block.parentNode?.insertBefore(anchor, block);
		state.anchors.set(block, anchor);
		state.sceneSelect.appendChild(block);
		state.selection.add(block);
	};

	const foldOut = (block: HTMLElement): void => {
		const anchor = state.anchors.get(block);
		if (anchor?.parentNode != null) {
			anchor.parentNode.insertBefore(block, anchor);
			anchor.remove();
		} else {
			state.world.appendChild(block);
		}
		state.anchors.delete(block);
		state.selection.delete(block);
	};

	// Callers decide what happens to the blocks FIRST: clearSelection folds them back
	// out, deleteSelection discards them with the gizmo.
	const teardownSelection = (): void => {
		state.gizmo?.remove();
		state.gizmo = null;
		state.sceneSelect = null;
		state.selection.clear();
	};

	const clearSelection = (): void => {
		if (state.gizmo === null) return;
		for (const block of [...state.selection]) foldOut(block);
		teardownSelection();
	};

	const buildSelection = (block: HTMLElement): void => {
		state.gizmo = document.createElement("scene-gizmo");
		state.sceneSelect = document.createElement("scene-select");
		state.gizmo.appendChild(state.sceneSelect);
		block.parentNode?.insertBefore(state.gizmo, block);
		foldIn(block);
	};

	const select = (block: HTMLElement): void => {
		if (state.selection.size === 1 && state.selection.has(block)) return;
		clearSelection();
		buildSelection(block);
		// Both ran their first render against an empty fresh cage.
		repaintSelection();
		updateInspector();
	};

	const toggleSelect = (block: HTMLElement): void => {
		if (state.gizmo === null || state.sceneSelect === null) {
			select(block);
			return;
		}
		if (state.selection.has(block)) {
			foldOut(block);
			if (state.selection.size === 0) clearSelection();
		} else {
			foldIn(block);
		}
		repaintSelection();
		updateInspector();
	};

	const deselectAll = (): void => {
		clearSelection();
		updateInspector();
	};

	const deleteSelection = (): void => {
		if (state.gizmo === null) return;
		// Removing the gizmo takes the cage and every wrapped block with it; the anchors
		// stay behind in the host, so clear them too.
		for (const anchor of state.anchors.values()) anchor.remove();
		state.anchors.clear();
		teardownSelection();
		updateInspector();
	};

	// Outermost selectable in the path, so a grouped child resolves to its group and a
	// wrapped block resolves to the block (the gizmo is not selectable). Clicking a
	// selected block again picks the block one level inside it. While the selection sits
	// inside a block, clicks within that block pick among its contents.
	const pickBlock = (event: PointerEvent): HTMLElement | null => {
		const blocksOutermostFirst = event
			.composedPath()
			.filter((node): node is HTMLElement => node instanceof HTMLElement && isBlock(node))
			.reverse();
		const selectionParent = state.gizmo?.parentElement ?? null;
		const selectionParentIndex =
			selectionParent === null ? -1 : blocksOutermostFirst.indexOf(selectionParent);
		const candidates = blocksOutermostFirst.slice(selectionParentIndex + 1);

		const selectedIndex = candidates.findIndex((block) => state.selection.has(block));
		const isTogglingSelection = event.metaKey || event.ctrlKey;
		if (selectedIndex === -1 || isTogglingSelection) return candidates[0] ?? null;
		return candidates[selectedIndex + 1] ?? candidates[selectedIndex];
	};

	return {
		select,
		toggleSelect,
		deselectAll,
		clearSelection,
		deleteSelection,
		repaintSelection,
		signalGizmoResync,
		pickBlock,
	};
};
