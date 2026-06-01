import { html, render } from "../../../lib/src";
import { blocksBoundsPx, HALF_UNIT, isBlock } from "./scene-shared";

// <scene-select> — the selection highlight, and nothing else. Selecting wraps the
// chosen blocks in `<scene-gizmo><scene-select>…</scene-select></scene-gizmo>`: this
// element draws the cage, the gizmo draws the knobs. Splitting the two jobs is what
// makes a one-block and a many-block selection look identical — every selected block
// (the first and any cmd-clicked extras) is just another child of this one element,
// so there is a single shared cage instead of "first block gets a gizmo, the rest
// get something else".
//
// The cage is WORLD-axis-aligned and sized from the blocks' actual rotated corners
// (blocksBoundsPx), so it always encompasses them: tight when a block is axis-aligned,
// larger when one is turned corner-on (where a cube projects biggest). A small margin
// floats it just clear of the opaque faces — a flush cage z-fights and disappears.
// The blocks stay the single source of truth; we only read them and follow.
//
// We do NOT observe the blocks for changes. The cage remeasures on exactly two owned
// cadences (see writeBounds): the framework re-render after a committed move (the
// trailing call below, which runs once the template's DOM has landed), and a live
// drag, where the wrapping gizmo writes the block transforms and then reaches through
// to call writeBounds() synchronously. Watching for our own consequences with a
// MutationObserver was the dead pattern this replaces.

// Screen-px the cage stands proud of the bounding box, so it reads as a halo rather
// than fighting the block surface.
const SELECT_MARGIN = 6;

// The element class carries writeBounds as a real method (not a property bolted on
// after the fact) so the gizmo can reach through and call it during a drag, and the
// render generator can call it as trailing post-DOM code.
class SceneSelect extends render(function* (element) {
	// A yielded INNER generator becomes the re-runnable current source: on every
	// update() it re-runs top-to-bottom, re-yields the (hash-stable) template so the
	// runtime diffs it in place, and then runs the trailing code below — by which
	// point the cage's DOM has landed, so we can measure and place it.
	yield function* () {
		yield html`
			<style>
				:host {
					position: absolute;
					top: 50%;
					left: 50%;
					transform-style: preserve-3d;
					pointer-events: none;
				}

				/* The cage sits at the bounding-box centre with NO rotation — it is
				   world-axis-aligned, so it never swings behind a turned block and it
				   wraps every child at once. Its extent comes from --half-* (the union of
				   the blocks' rotated corners plus a margin). */
				.box {
					position: absolute;
					top: 50%;
					left: 50%;
					transform-style: preserve-3d;
					pointer-events: none;
					transform: translate3d(
						var(--center-x, 0px),
						var(--center-y, 0px),
						var(--center-z, 0px)
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
					width: calc(2 * var(--half-x, ${HALF_UNIT}px));
					height: calc(2 * var(--half-y, ${HALF_UNIT}px));
					margin: calc(-1 * var(--half-y, ${HALF_UNIT}px)) 0 0
						calc(-1 * var(--half-x, ${HALF_UNIT}px));
				}
				.front {
					transform: translateZ(var(--half-z, ${HALF_UNIT}px));
				}
				.back {
					transform: translateZ(calc(-1 * var(--half-z, ${HALF_UNIT}px)));
				}
				.right,
				.left {
					width: calc(2 * var(--half-z, ${HALF_UNIT}px));
					height: calc(2 * var(--half-y, ${HALF_UNIT}px));
					margin: calc(-1 * var(--half-y, ${HALF_UNIT}px)) 0 0
						calc(-1 * var(--half-z, ${HALF_UNIT}px));
				}
				.right {
					transform: rotateY(90deg) translateZ(var(--half-x, ${HALF_UNIT}px));
				}
				.left {
					transform: rotateY(-90deg) translateZ(var(--half-x, ${HALF_UNIT}px));
				}
				.top,
				.bottom {
					width: calc(2 * var(--half-x, ${HALF_UNIT}px));
					height: calc(2 * var(--half-z, ${HALF_UNIT}px));
					margin: calc(-1 * var(--half-z, ${HALF_UNIT}px)) 0 0
						calc(-1 * var(--half-x, ${HALF_UNIT}px));
				}
				.top {
					transform: rotateX(90deg) translateZ(var(--half-y, ${HALF_UNIT}px));
				}
				.bottom {
					transform: rotateX(-90deg) translateZ(var(--half-y, ${HALF_UNIT}px));
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
		// The cage chrome has landed; measure it against the current blocks.
		(element as SceneSelect).writeBounds();
	};
}) {
	// Size and place the cage so it wraps every slotted block. World-axis-aligned, so
	// it never swings behind a turned block. Hidden when there is nothing to wrap.
	writeBounds(): void {
		const box = this.shadowRoot?.querySelector(".box") as HTMLElement | null;
		if (box === null) return;
		const slot = this.shadowRoot?.querySelector("slot");
		const blocks = (slot?.assignedElements() ?? []).filter(isBlock);
		const bounds = blocksBoundsPx(blocks);
		if (bounds === null) {
			box.style.display = "none";
			return;
		}
		box.style.display = "";
		box.style.setProperty("--center-x", `${bounds.center[0]}px`);
		box.style.setProperty("--center-y", `${bounds.center[1]}px`);
		box.style.setProperty("--center-z", `${bounds.center[2]}px`);
		box.style.setProperty("--half-x", `${bounds.half[0] + SELECT_MARGIN}px`);
		box.style.setProperty("--half-y", `${bounds.half[1] + SELECT_MARGIN}px`);
		box.style.setProperty("--half-z", `${bounds.half[2] + SELECT_MARGIN}px`);
	}
}

customElements.define("scene-select", SceneSelect);
