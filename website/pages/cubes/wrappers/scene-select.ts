import { html, component } from "../../../../lib/src";
import {
	blocksBoundsPx,
	blockTransformFromProps,
	type Bounds,
	carrierProps,
	HALF_UNIT,
	isBlock,
	UNIT_SIZE,
} from "../scene-shared";

// <scene-select> — the selection cage, and nothing else. Selecting wraps the chosen
// blocks in `<scene-gizmo><scene-select>…</scene-select></scene-gizmo>`: this element
// draws the cage, the gizmo draws the knobs. Splitting the two is what makes a one-block
// and a many-block selection identical — every selected block is just another child here.
//
// It is a self-contained drop-in, on two properties:
//
//  1. It is a transform carrier. Its :host transform is `var(--carrier-live, <committed>)`,
//     so a wrapping gizmo can DECLARE --carrier-live on its own host and the cage plus its
//     slotted blocks ride the drag as one rigid body, by pure CSS inheritance, with nobody
//     writing our DOM. The editor flattens any committed transform back into the blocks.
//  2. It re-fits by MEASURING its blocks and emitting the box as bindings. The blocks
//     only assign once our <slot> exists, so each render paints twice: once to put the
//     slot up, then again with the box the measurement produced. Both paints are the same
//     template, so the second is a patch and the slot is never rebuilt. It does not watch
//     its own subtree; the editor, which owns every content change, re-renders it.
//
// The cage is world-axis-aligned and sized from the blocks' rotated corners, so it stays
// tight when a block is axis-aligned and grows to wrap one turned corner-on. Measurement
// reads each block's LOCAL matrix, so it is invariant to our own host transform: box and
// blocks share our frame and ride it together.

// Screen px the cage stands proud of the box: flush, it z-fights the faces and vanishes.
const SELECT_MARGIN = 6;

const slottedBlocks = (element: HTMLElement): Element[] => {
	const slot = element.shadowRoot?.querySelector("slot");
	return (slot?.assignedElements() ?? []).filter(isBlock);
};

customElements.define(
	"scene-select",
	component(
		function* () {
			yield function* (props) {
				const {
					position: [positionX, positionY, positionZ],
					rotation: [rotationX, rotationY, rotationZ],
				} = blockTransformFromProps(props);

				// Null while the slot is still going up, and on a cage holding nothing; both
				// hide the box rather than draw a zero one.
				const cage = (bounds: Bounds | null) => {
					const centerX = bounds ? bounds.center[0] : 0;
					const centerY = bounds ? bounds.center[1] : 0;
					const centerZ = bounds ? bounds.center[2] : 0;
					const halfX = bounds ? bounds.half[0] + SELECT_MARGIN : HALF_UNIT;
					const halfY = bounds ? bounds.half[1] + SELECT_MARGIN : HALF_UNIT;
					const halfZ = bounds ? bounds.half[2] + SELECT_MARGIN : HALF_UNIT;

					return html`
						<style>
							:host {
								position: absolute;
								top: 50%;
								left: 50%;
								transform-style: preserve-3d;
								pointer-events: none;

								/* Author +Y is up, screen +Y is down: negated here at the bridge. */
								--block-x: ${positionX * UNIT_SIZE}px;
								--block-y: ${-positionY * UNIT_SIZE}px;
								--block-z: ${positionZ * UNIT_SIZE}px;
								--block-rotate-x: ${rotationX}deg;
								--block-rotate-y: ${rotationY}deg;
								--block-rotate-z: ${rotationZ}deg;

								--box-display: ${bounds === null ? "none" : "block"};
								--center-x: ${centerX}px;
								--center-y: ${centerY}px;
								--center-z: ${centerZ}px;
								--half-x: ${halfX}px;
								--half-y: ${halfY}px;
								--half-z: ${halfZ}px;

								/* A wrapping gizmo DECLARES --carrier-live on its own host; it
							   inherits across the slot to us and we pull it, so cage and blocks
							   move as one rigid body for the length of a drag. Unset, the var()
							   falls back to our committed transform. */
								transform: var(
									--carrier-live,
									translate3d(var(--block-x), var(--block-y), var(--block-z))
										rotateX(var(--block-rotate-x))
										rotateY(var(--block-rotate-y))
										rotateZ(var(--block-rotate-z))
								);
							}

							/* No rotation of its own: world-axis-aligned within our frame, so it
						   never swings behind a turned block and wraps every child at once. */
							.box {
								display: var(--box-display);
								position: absolute;
								top: 50%;
								left: 50%;
								transform-style: preserve-3d;
								pointer-events: none;
								transform: translate3d(
									var(--center-x),
									var(--center-y),
									var(--center-z)
								);
							}

							.edge {
								position: absolute;
								top: 50%;
								left: 50%;
								box-sizing: border-box;
								border: 2px dashed rgba(120, 220, 255, 0.95);
								background: rgba(120, 220, 255, 0.08);
							}
							.front,
							.back {
								width: calc(2 * var(--half-x));
								height: calc(2 * var(--half-y));
								margin: calc(-1 * var(--half-y)) 0 0 calc(-1 * var(--half-x));
							}
							.front {
								transform: translateZ(var(--half-z));
							}
							.back {
								transform: translateZ(calc(-1 * var(--half-z)));
							}
							.right,
							.left {
								width: calc(2 * var(--half-z));
								height: calc(2 * var(--half-y));
								margin: calc(-1 * var(--half-y)) 0 0 calc(-1 * var(--half-z));
							}
							.right {
								transform: rotateY(90deg) translateZ(var(--half-x));
							}
							.left {
								transform: rotateY(-90deg) translateZ(var(--half-x));
							}
							.top,
							.bottom {
								width: calc(2 * var(--half-x));
								height: calc(2 * var(--half-z));
								margin: calc(-1 * var(--half-z)) 0 0 calc(-1 * var(--half-x));
							}
							.top {
								transform: rotateX(90deg) translateZ(var(--half-y));
							}
							.bottom {
								transform: rotateX(-90deg) translateZ(var(--half-y));
							}

							/* A flattening box here would collapse the blocks' preserve-3d. */
							slot {
								display: contents;
							}
						</style>
						<div class="box">
							<div class="edge front"></div>
							<div class="edge back"></div>
							<div class="edge right"></div>
							<div class="edge left"></div>
							<div class="edge top"></div>
							<div class="edge bottom"></div>
						</div>
						<slot></slot>
					`;
				};

				yield cage(null);
				yield cage(blocksBoundsPx(slottedBlocks(props.host)));
			};
		},
		{ props: carrierProps },
	),
);
