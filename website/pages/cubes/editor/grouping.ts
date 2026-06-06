import {
	blockRendered,
	commitBlockRender,
	formatNumber,
	frameMatrix,
	isBlock,
	rotationMatrix,
	snapToGrid,
	UNIT_SIZE,
	type Vector3,
} from "../scene-shared";
import { primaryBlock, type EditorState } from "./context";
import {
	addVectors,
	clearLiveTransform,
	liftThroughFrame,
	readPosition,
	readRotation,
	subtractVectors,
} from "./transforms";

// Grouping bakes structure into the geometry itself, never into a hidden wrapper:
// grouping rebases children into a new <scene-group>'s local space, ungrouping lifts
// them back into world space, and flatten (after a gizmo commit) bakes the cage's rigid
// move down into its leaf blocks so the cage returns to identity. All three share the
// matrix lift in transforms.liftThroughFrame.

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
		state.host.appendChild(group);
		for (const block of members) {
			const rebased = subtractVectors(readPosition(block), centroid);
			block.setAttribute("position", rebased.map(formatNumber).join(" "));
			block.removeAttribute("x");
			block.removeAttribute("y");
			block.removeAttribute("z");
			// The rebased attribute re-renders ASYNCHRONOUSLY, but the group's own
			// translate renders synchronously on connect. Until the child catches up its
			// resolved --block-* still hold its old WORLD position, which — now inside the
			// group's centroid translate — would double-count and put the cage one
			// centroid off. So we also write the rebased transform to the inline channel
			// (inline wins over the shadow :host rule) so the first measure reads it.
			block.style.setProperty("--block-x", `${rebased[0] * UNIT_SIZE}px`);
			block.style.setProperty("--block-y", `${-rebased[1] * UNIT_SIZE}px`);
			block.style.setProperty("--block-z", `${rebased[2] * UNIT_SIZE}px`);
			group.appendChild(block);
		}
		deps.select(group);
		// Same commit-then-clear the gizmo uses after a drag: once each child has
		// re-rendered from its rebased attribute (commitBlockRender awaits that), drop
		// the inline override so it falls back to its authored value — no flash, because
		// by then the resolved transform already matches.
		void Promise.all(
			members.map((block) => commitBlockRender(block, clearLiveTransform)),
		);
	};

	const ungroupSelection = (): void => {
		const group = primaryBlock(state);
		if (group === null || group.tagName.toLowerCase() !== "scene-group") {
			return;
		}
		deps.clearSelection();
		// The group's full frame and its rotation alone. Each child lifts into world
		// space by pushing its position through the frame and composing its rotation
		// with the group's BY MATRIX — correct for a group authored with X/Z rotation,
		// not only the yaw case the old add-the-Euler-triples math handled.
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
			state.host.appendChild(child);
		}
		group.remove();
		deps.updateInspector();
	};

	// The gizmo commits a drag by bubbling "scene-commit": it has written the dragged
	// transform onto its direct child — our scene-select cage — as one rigid move, then
	// settled. We flatten that transform down into the leaf blocks so the blocks stay the
	// single source of truth and the cage returns to identity. The gizmo knows nothing of
	// this; it just transformed its child.
	const flattenSelection = (): void => {
		if (state.sceneSelect === null) return;
		const cage = state.sceneSelect;
		const blocks = [...state.selection];
		if (blocks.length === 0) return;
		// The cage's committed frame and its rotation alone. Each block lifts into world
		// space through the frame, composing its rotation with the cage's BY MATRIX —
		// correct for any cage rotation, not just yaw.
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
		// Return the cage to identity. The blocks now hold the full transform; until both
		// they and the cage re-render the visible pose is unchanged (cage-frame ·
		// block-local == the new world transform), so flipping the pair in one render
		// batch shows no flash. Once settled, re-pin the gizmo handles to the flattened
		// blocks.
		cage.setAttribute("position", "0 0 0");
		cage.setAttribute("rotation", "0 0 0");
		void Promise.all(
			[cage, ...blocks].map((node) => blockRendered(node as HTMLElement)),
		).then(deps.repaintSelection);
	};

	return { groupSelection, ungroupSelection, flattenSelection };
};
