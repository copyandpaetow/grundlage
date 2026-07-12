import { html, component } from "../../../../lib/src";
import { GROUND_HALF_UNITS, GROUND_SIZE, UNIT_SIZE } from "../scene-shared";

// <scene-ground> — the placement floor. A flat, world-axis-aligned grid sheet on Y=0
// that the editor drops into the world's `ground` slot while a block is being placed,
// and removes when placement ends — so its mere existence is the grid being shown
// (no visibility flag to toggle). Editor-only chrome, never serialized.
//
// Self-contained: it IS the floor, so it owns its own surface and reports where you
// point on it. Because the sheet lies axis-flat, the browser hands us the local hit as
// `offsetX`/`offsetY` (the perspective is already inverted), and since we know our own
// extent we map that to a world cell ourselves and emit it as `scene-floor-point`.
// Whoever holds the ground just listens — no projection maths leaks outward.

customElements.define(
	"scene-ground",
	component(function* (element) {
		// Map the local hit on the flat sheet to a world point, in grid units, and hand
		// it out. We emit the raw (unsnapped) point: snapping to the authoring lattice is
		// the editor's policy, not the floor's.
		const onPointerMove = (event: PointerEvent): void => {
			const half = GROUND_HALF_UNITS * UNIT_SIZE;
			element.dispatchEvent(
				new CustomEvent("scene-floor-point", {
					bubbles: true,
					detail: {
						x: (event.offsetX - half) / UNIT_SIZE,
						z: (event.offsetY - half) / UNIT_SIZE,
					},
				}),
			);
		};

		yield html`
			<style>
				:host {
					position: absolute;
					width: ${GROUND_SIZE}px;
					height: ${GROUND_SIZE}px;
					/* Centre the sheet on the world origin. We offset top/left by half the
					   sheet rather than anchoring at 50% and pulling back with a negative
					   margin: the host lives in the light DOM, so a document-scope reset
					   (e.g. :where(*) { margin: 0 }) reaches it and would wipe a
					   margin-based centring — collapsing the sheet into the corner, off
					   the world's overflow box (invisible, and no longer under the
					   pointer). top/left offsets stay ours. */
					top: calc(50% - ${GROUND_SIZE / 2}px);
					left: calc(50% - ${GROUND_SIZE / 2}px);
					/* Lay the sheet flat on the floor (Y=0), inside the world's 3D. */
					transform: rotateX(90deg);
				}

				/* The visible, interactive surface. Coplanar with the host (no transform of
				   its own), so offsetX/offsetY stay local-plane coordinates. */
				.surface {
					position: absolute;
					inset: 0;
					/* The world sheet is pointer-events:none; we opt back in so the grid
					   can catch the placement pointer. */
					pointer-events: auto;
					background-image:
						repeating-linear-gradient(
							0deg,
							rgba(120, 200, 255, 0.25) 0 1px,
							transparent 1px ${UNIT_SIZE}px
						),
						repeating-linear-gradient(
							90deg,
							rgba(120, 200, 255, 0.25) 0 1px,
							transparent 1px ${UNIT_SIZE}px
						);
				}
			</style>
			<div class="surface" onpointermove="${onPointerMove}"></div>
		`;
	}),
);
