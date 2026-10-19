import {
	formatNumber,
	frameMatrix,
	isBlock,
	rotationMatrix,
	sceneElementRendered,
	snapToGrid,
	type Vector3,
} from "../scene-shared";
import { primaryBlock, type EditorState } from "./context";
import {
	addVectors,
	liftThroughFrame,
	readPosition,
	readRotation,
	subtractVectors,
} from "./transforms";

// Grouping bakes structure into the geometry itself, never into a hidden wrapper:
// grouping rebases children into a new <scene-group>'s local space, ungrouping lifts them
// back into world space, and flatten (after a gizmo commit) bakes the cage's rigid move
// down into its leaf blocks so the cage returns to identity. All three share the matrix
// lift in transforms.liftThroughFrame.

export type GroupingDeps = {
	select: (block: HTMLElement) => void;
	clearSelection: () => void;
	repaintSelection: () => void;
	updateInspector: () => void;
};

export type GroupingApi = {
	groupSelection: () => void;
	ungroupSelection: () => void;
	flattenSelection: () => void;
};

export const createGrouping = (
	state: EditorState,
	deps: GroupingDeps,
): GroupingApi => {
	const groupSelection = (): void => {
		const members = [...state.selection];
		if (members.length < 2) return;

		deps.clearSelection();

		const centroid = members
			.map((block) => readPosition(block))
			.reduce(addVectors, [0, 0, 0] as Vector3)
			.map((sum) => sum / members.length) as Vector3;

		const group = document.createElement("scene-group");
		group.setAttribute("position", centroid.map(formatNumber).join(" "));
		state.world.appendChild(group);
		for (const block of members) {
			const rebased = subtractVectors(readPosition(block), centroid);
			block.setAttribute("position", rebased.map(formatNumber).join(" "));
			block.removeAttribute("x");
			block.removeAttribute("y");
			block.removeAttribute("z");
			group.appendChild(block);
		}
		deps.select(group);
	};

	const ungroupSelection = (): void => {
		const group = primaryBlock(state);
		if (group === null || group.tagName.toLowerCase() !== "scene-group") return;

		deps.clearSelection();
		const frame = frameMatrix(readPosition(group), readRotation(group));
		const groupRotation = rotationMatrix(readRotation(group));
		for (const child of [...group.children]) {
			if (!(child instanceof HTMLElement) || !isBlock(child)) continue;
			const { position, rotation } = liftThroughFrame(
				child,
				frame,
				groupRotation,
			);
			child.setAttribute("position", position.map(formatNumber).join(" "));
			child.setAttribute("rotation", rotation.map(formatNumber).join(" "));
			state.world.appendChild(child);
		}
		group.remove();
		deps.updateInspector();
	};

	// The gizmo bubbles "scene-commit" once it has written a dragged transform onto its
	// direct child, our cage, as one rigid move. We flatten that down into the leaf blocks
	// so the blocks stay the single source of truth and the cage returns to identity. The
	// gizmo knows nothing of this; it just transformed its child.
	const flattenSelection = (): void => {
		if (state.sceneSelect === null) return;
		const cage = state.sceneSelect;
		const blocks = [...state.selection];
		if (blocks.length === 0) return;

		const frame = frameMatrix(readPosition(cage), readRotation(cage));
		const cageRotation = rotationMatrix(readRotation(cage));
		for (const block of blocks) {
			const { position, rotation } = liftThroughFrame(
				block,
				frame,
				cageRotation,
			);
			const world = position.map(snapToGrid) as Vector3;
			const rounded = rotation.map((degrees) => Math.round(degrees)) as Vector3;
			block.setAttribute("position", world.map(formatNumber).join(" "));
			block.setAttribute("rotation", rounded.map(formatNumber).join(" "));
			block.removeAttribute("x");
			block.removeAttribute("y");
			block.removeAttribute("z");
		}
		// The blocks now hold the full transform, so the cage returns to identity. Until
		// both sides re-render the visible pose is unchanged (cage-frame · block-local ==
		// the new world transform), so flipping the pair in one batch shows no flash.
		cage.setAttribute("position", "0 0 0");
		cage.setAttribute("rotation", "0 0 0");
		void Promise.all(
			[cage, ...blocks].map((node) => sceneElementRendered(node)),
		).then(deps.repaintSelection);
	};

	return { groupSelection, ungroupSelection, flattenSelection };
};
