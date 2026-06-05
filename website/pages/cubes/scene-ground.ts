import { html, render } from "../../../lib/src";
import { UNIT_SIZE } from "./scene-shared";

// <scene-ground> — the placement grid. A flat, world-axis-aligned sheet on Y=0 that
// the editor shows only while a block is being placed: it is both the visual grid
// and the hit target the editor reads the snapped drop point from (offsetX/offsetY
// land on it because it lies flat). Editor-only chrome, never serialized.
//
// Visibility is the editor's to drive — it toggles our inline `display` as placement
// starts and ends — so :host deliberately carries NO display rule (an absolutely
// positioned host computes to block either way), letting `display: none` / `""` win
// from the outside. Everything else here is static, so we render once.

// Half the grid's extent in units; the sheet spans this many cells either side of the
// origin. The editor imports it to map a screen hit back to a world cell, so the
// drawn grid and the snapped point share one definition.
export const GROUND_HALF_UNITS = 20;

const GROUND_SIZE = GROUND_HALF_UNITS * 2 * UNIT_SIZE;

customElements.define(
	"scene-ground",
	render(function* () {
		yield html`
			<style>
				:host {
					position: absolute;
					top: 50%;
					left: 50%;
					width: ${GROUND_SIZE}px;
					height: ${GROUND_SIZE}px;
					margin: ${-GROUND_SIZE / 2}px 0 0 ${-GROUND_SIZE / 2}px;
					/* Lay the sheet flat on the floor (Y=0). */
					transform: rotateX(90deg);
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
		`;
	}),
);
