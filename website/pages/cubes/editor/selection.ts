import { isBlock, sceneElementRendered } from "../scene-shared";
import type { EditorState } from "./context";

// Selection is DOM-native: choosing blocks wraps them in ONE
// `<scene-gizmo><scene-select>…</scene-select></scene-gizmo>`. Every selected block is a
// sibling inside that one cage, so single- and multi-block selections share one structure
// and the gizmo moves them all with one logic. The wrappers' existence IS the selection.

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

export const createSelection = (
	state: EditorState,
	deps: SelectionDeps,
): SelectionApi => {
	const { updateInspector } = deps;

	// The gizmo and cage pull their content at render time rather than observing it, so
	// the coordinator that changed that content is the one that re-renders them. This
	// re-pins the handles and re-fits the box to whatever the selection now holds.
	const repaintSelection = (): void => {
		if (state.gizmo !== null) void sceneElementRendered(state.gizmo);
		if (state.sceneSelect !== null)
			void sceneElementRendered(state.sceneSelect);
	};

	// An inspector edit re-renders the block asynchronously; the selection chrome only
	// re-pins correctly once that has landed.
	const signalGizmoResync = async (block: HTMLElement): Promise<void> => {
		await sceneElementRendered(block);
		repaintSelection();
	};

	// Pulling a block into the cage leaves a comment anchor at its original spot, so
	// deselecting drops it back exactly where it was and DOM (and Export) order stays
	// stable across repeated gather/release.
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

	// Cmd/Ctrl-click folds a block into the existing cage or lifts it back out, so the
	// gizmo operates on the whole set at once.
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
	// wrapped block resolves to the block (the gizmo is not selectable).
	const pickBlock = (event: PointerEvent): HTMLElement | null => {
		let block: HTMLElement | null = null;
		for (const node of event.composedPath()) {
			if (node instanceof HTMLElement && isBlock(node)) block = node;
		}
		return block;
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
