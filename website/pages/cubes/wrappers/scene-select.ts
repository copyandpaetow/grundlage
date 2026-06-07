import { html, render } from "../../../../lib/src";
import {
	blocksBoundsPx,
	HALF_UNIT,
	isBlock,
	resolveBlockTransform,
	UNIT_SIZE,
} from "../scene-shared";

// <scene-select> — the selection highlight, and nothing else. Selecting wraps the
// chosen blocks in `<scene-gizmo><scene-select>…</scene-select></scene-gizmo>`: this
// element draws the cage, the gizmo draws the knobs. Splitting the two jobs is what
// makes a one-block and a many-block selection look identical — every selected block
// (the first and any cmd-clicked extras) is just another child of this one element,
// so there is a single shared cage instead of "first block gets a gizmo, the rest
// get something else".
//
// It is a self-contained drop-in: `<scene-select><scene-cube/></scene-select>` works
// on its own. Two properties make that true:
//
//  1. It is a Transform carrier. Its :host transform is `var(--carrier-live, <committed>)`:
//     normally it resolves position/rotation into the committed transform, but a wrapping
//     gizmo can DECLARE `--carrier-live` on its own host (an inherited custom property), and
//     we pull it — so the whole cage AND its slotted blocks ride the gizmo's in-flight
//     transform as one rigid body, by pure CSS inheritance, with no JS and no one writing
//     our DOM. The editor flattens any committed transform back into the leaf blocks.
//
//  2. It re-fits the cage to its content by MEASURING the blocks at render time and emitting
//     the box size as bindings — no imperative style writes, no observer. We do not watch our
//     own subtree; the editor (the one that folds blocks in/out and edits them) re-renders us
//     through update(). One render channel: every change funnels through a re-render.
//
// The cage is WORLD-axis-aligned and sized from the blocks' actual rotated corners
// (blocksBoundsPx), so it always encompasses them: tight when a block is axis-aligned,
// larger when one is turned corner-on. A small margin floats it just clear of the
// opaque faces — a flush cage z-fights and disappears. Measurement reads each block's
// LOCAL matrix, so it is invariant to our own host transform: the box and the blocks
// share our frame and ride it together.

// Screen-px the cage stands proud of the bounding box, so it reads as a halo rather
// than fighting the block surface.
const SELECT_MARGIN = 6;

// Our slotted blocks: what the cage measures and wraps. Null-safe for the very first
// render, before the template's slot exists (no blocks are folded in yet anyway).
const slottedBlocks = (element: HTMLElement): Element[] => {
	const slot = element.shadowRoot?.querySelector("slot");
	return (slot?.assignedElements() ?? []).filter(isBlock);
};

customElements.define(
	"scene-select",
	render(function* (element) {
		// A Render function: re-invoked on every update(). It measures the blocks (each
		// renders independently, so they are already laid out) and bakes the world-aligned
		// box straight into the markup as bindings. update() is driven by the editor on a
		// content change and fires automatically on our own committed position/rotation.
		yield () => {
			// Carrier resolution: our committed transform in, concrete --block-* out. A cage
			// has no size of its own, so we resolve position/rotation only.
			const {
				position: [positionX, positionY, positionZ],
				rotation: [rotationX, rotationY, rotationZ],
			} = resolveBlockTransform(element);

			// Measure the blocks' shared world-axis-aligned box. Null when there is nothing
			// to wrap (e.g. the first render) — we hide the box rather than draw a zero cage.
			const bounds = blocksBoundsPx(slottedBlocks(element));
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

						/* Committed carrier transform, resolved from position/rotation exactly
						   as a block or group does (author +Y up → screen −Y, negated here). */
						--block-x: ${positionX * UNIT_SIZE}px;
						--block-y: ${-positionY * UNIT_SIZE}px;
						--block-z: ${positionZ * UNIT_SIZE}px;
						--block-rotate-x: ${rotationX}deg;
						--block-rotate-y: ${rotationY}deg;
						--block-rotate-z: ${rotationZ}deg;

						/* The measured box, emitted as variables the chrome below reads. */
						--box-display: ${bounds === null ? "none" : "block"};
						--center-x: ${centerX}px;
						--center-y: ${centerY}px;
						--center-z: ${centerZ}px;
						--half-x: ${halfX}px;
						--half-y: ${halfY}px;
						--half-z: ${halfZ}px;

						/* A wrapping gizmo DECLARES --carrier-live on its own host; it inherits
						   across the slot to us and we pull it, moving the cage + blocks as one
						   rigid body for the duration of a drag. Unset (its initial value) the
						   var() falls back to our committed transform — no gizmo, no override. */
						transform: var(
							--carrier-live,
							translate3d(var(--block-x), var(--block-y), var(--block-z))
								rotateX(var(--block-rotate-x)) rotateY(var(--block-rotate-y))
								rotateZ(var(--block-rotate-z))
						);
					}

					/* The cage sits at the bounding-box centre with NO rotation of its own — it
					   is world-axis-aligned within our frame, so it never swings behind a turned
					   block and it wraps every child at once. Hidden when there is nothing to
					   wrap. */
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

					/* The wrapped blocks share our 3D context, so the slot must not flatten. */
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
	}),
);
