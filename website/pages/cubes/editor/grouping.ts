import {
	formatNumber,
	sceneElementRendered,
	snapToGrid,
	UNIT_SIZE,
	type Vector3,
} from "../scene-shared";
import {
	blocksBoundsPx,
	frameMatrix,
	fromScreenPoint,
	isBlock,
	rotationMatrix,
} from "../scene-geometry";
import { primaryBlock, type EditorState } from "./context";
import { liftThroughFrame, readPosition, readRotation, subtractVectors } from "./transforms";

// Structure is baked into the geometry, never into a hidden wrapper, so exported markup is
// the whole scene

export type GroupingDeps = {
	select: (block: HTMLElement) => void;
	clearSelection: () => void;
	repaintSelection: () => void;
	updateInspector: () => void;
};

export type WrapperTagName = "scene-group" | "scene-cube";

export type GroupingApi = {
	wrapSelection: (wrapperTagName: WrapperTagName) => void;
	unwrapSelection: () => void;
	flattenSelection: () => void;
};

export const createGrouping = (state: EditorState, deps: GroupingDeps): GroupingApi => {
	const wrapSelection = (wrapperTagName: WrapperTagName): void => {
		const members = [...state.selection];
		const isWorthWrapping =
			members.length >= 2 || (members.length === 1 && wrapperTagName === "scene-cube");
		if (!isWorthWrapping) return;

		deps.clearSelection();

		// Every member has to sit in one parent's frame, or one rebase cannot hold them all
		const parent = members[0].parentElement;
		if (parent === null || members.some((block) => block.parentElement !== parent)) {
			throw new Error("Wrap blocks that share one parent; these sit in different ones.");
		}

		// Measured after clearSelection, so the bounds are in the parent's frame, not the cage's
		const bounds = blocksBoundsPx(members);
		if (bounds === null) {
			throw new Error("Wrap blocks that have rendered; these have no bounds yet.");
		}
		const center = fromScreenPoint(new DOMPoint(...bounds.center));

		const wrapper = document.createElement(wrapperTagName);
		wrapper.setAttribute("position", center.map(formatNumber).join(" "));
		if (wrapperTagName === "scene-cube") {
			wrapper.setAttribute(
				"size",
				bounds.half.map((halfPx) => formatNumber((halfPx * 2) / UNIT_SIZE)).join(" "),
			);
		}
		parent.insertBefore(wrapper, members[0]);
		for (const block of members) {
			const rebased = subtractVectors(readPosition(block), center);
			block.setAttribute("position", rebased.map(formatNumber).join(" "));
			block.removeAttribute("x");
			block.removeAttribute("y");
			block.removeAttribute("z");
			wrapper.appendChild(block);
		}
		deps.select(wrapper);
	};

	// A cube keeps its own geometry when its children leave; a group is nothing without them.
	const unwrapSelection = (): void => {
		const wrapper = primaryBlock(state);
		if (wrapper === null) return;
		const childBlocks = [...wrapper.children].filter(
			(child): child is HTMLElement => child instanceof HTMLElement && isBlock(child),
		);
		if (childBlocks.length === 0) return;

		deps.clearSelection();
		const frame = frameMatrix(readPosition(wrapper), readRotation(wrapper));
		const wrapperRotation = rotationMatrix(readRotation(wrapper));
		for (const child of childBlocks) {
			const { position, rotation } = liftThroughFrame(child, frame, wrapperRotation);
			child.setAttribute("position", position.map(formatNumber).join(" "));
			child.setAttribute("rotation", rotation.map(formatNumber).join(" "));
			wrapper.before(child);
		}
		if (wrapper.tagName.toLowerCase() === "scene-group") wrapper.remove();
		deps.updateInspector();
	};

	// The blocks stay the single source of truth, so the gizmo's move on the cage is baked
	// into them
	const flattenSelection = (): void => {
		if (state.sceneSelect === null) return;
		const cage = state.sceneSelect;
		const blocks = [...state.selection];
		if (blocks.length === 0) return;

		const frame = frameMatrix(readPosition(cage), readRotation(cage));
		const cageRotation = rotationMatrix(readRotation(cage));
		for (const block of blocks) {
			const { position, rotation } = liftThroughFrame(block, frame, cageRotation);
			// The move snaps, not the pose, so an off-grid block stays off-grid on axes the drag never touched
			const positionBeforeDrag = readPosition(block);
			const world = position.map(
				(coordinate, axis) =>
					positionBeforeDrag[axis] + snapToGrid(coordinate - positionBeforeDrag[axis]),
			) as Vector3;
			const rounded = rotation.map((degrees) => Math.round(degrees)) as Vector3;
			block.setAttribute("position", world.map(formatNumber).join(" "));
			block.setAttribute("rotation", rounded.map(formatNumber).join(" "));
			block.removeAttribute("x");
			block.removeAttribute("y");
			block.removeAttribute("z");
		}
		// Both flip in one batch and cage · block equals the new pose, so nothing flashes
		cage.setAttribute("position", "0 0 0");
		cage.setAttribute("rotation", "0 0 0");
		void Promise.all([cage, ...blocks].map((node) => sceneElementRendered(node))).then(
			deps.repaintSelection,
		);
	};

	return { wrapSelection, unwrapSelection, flattenSelection };
};
