import { blockRendered, isBlock } from "../scene-shared";
import type { EditorState } from "./context";

// Selection is DOM-native: choosing blocks wraps them in ONE
// `<scene-gizmo><scene-select>…</scene-select></scene-gizmo>` — the gizmo carries the
// knobs, the scene-select the cage. Every selected block is a sibling inside that one
// cage, so single- and multi-block selections share one structure and the gizmo
// moves them all with one logic. The wrappers' existence IS the selection.

export type SelectionDeps = {
	// Reflect the current primary selection into the inspector. Owned by the editor
	// (it talks to the palette); selection just signals when the set changed.
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

	// One render channel: the gizmo and cage do not observe their content (they pull it at
	// render time), so WE — the coordinator that changes their content — re-render them.
	// This re-pins the gizmo handles and re-fits the cage box to whatever the selection holds.
	const repaintSelection = (): void => {
		type Renderable = { update?: () => Promise<void> };
		void (state.gizmo as Renderable | null)?.update?.();
		void (state.sceneSelect as Renderable | null)?.update?.();
	};

	// After an inspector edit the block re-renders asynchronously; once it has, re-render the
	// selection chrome so its handles and box re-pin to the new transform (it no longer
	// observes the block's attributes — that change is one we own here).
	const signalGizmoResync = async (block: HTMLElement): Promise<void> => {
		await blockRendered(block);
		repaintSelection();
	};

	// Pulling a block into the cage leaves a comment anchor at its original spot in the
	// host, so deselecting drops it back exactly where it was — keeping DOM (and Export)
	// order stable across repeated gather/release.
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
			state.host.appendChild(block);
		}
		state.anchors.delete(block);
		state.selection.delete(block);
	};

	// Drop the gizmo + scene-select and reset the selection state. Callers decide what to
	// do with the blocks FIRST: clearSelection folds them back out; deleteSelection
	// discards them with the gizmo.
	const teardownSelection = (): void => {
		state.gizmo?.remove();
		state.gizmo = null;
		state.sceneSelect = null;
		state.selection.clear();
	};

	// Tear the wrappers down, dropping every block back onto its anchor.
	const clearSelection = (): void => {
		if (state.gizmo === null) return;
		for (const block of [...state.selection]) foldOut(block);
		teardownSelection();
	};

	// Build the gizmo + scene-select at the block's spot, then fold the block in.
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
		// The gizmo and cage ran their first render against an empty fresh cage. Now that the
		// block is folded in, re-render both so the handles pin to it and the box fits it.
		repaintSelection();
		updateInspector();
	};

	// Cmd/Ctrl-click: fold a block into the existing cage (or lift it back out),
	// so the gizmo operates on the whole set at once.
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
		// Both the cage box and the gizmo handles re-pin to the new set; we own the content
		// change, so we re-render them.
		repaintSelection();
		updateInspector();
	};

	const deselectAll = (): void => {
		clearSelection();
		updateInspector();
	};

	const deleteSelection = (): void => {
		if (state.gizmo === null) return;
		// Removing the gizmo takes the scene-select and every wrapped block with it;
		// the blocks' anchors stay behind in the host, so clear them too.
		for (const anchor of state.anchors.values()) anchor.remove();
		state.anchors.clear();
		teardownSelection();
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
