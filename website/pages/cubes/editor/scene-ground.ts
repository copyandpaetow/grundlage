import { html, component } from "../../../../lib/src";
import { GROUND_HALF_UNITS, GROUND_SIZE, UNIT_SIZE } from "../scene-shared";

// The sheet lies axis-flat, so offsetX/offsetY arrive with the perspective already
// inverted and no projection math is needed

customElements.define(
	"scene-ground",
	component(function* ({ host: element }) {
		// Unsnapped: snapping is the editor's policy
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
					/* Offset rather than anchor at 50% and pull back with a negative margin:
					   the host lives in the light DOM, so a document-scope reset
					   (:where(*) { margin: 0 }) would wipe a margin-based centring and
					   collapse the sheet into the corner, outside the world's overflow box. */
					top: calc(50% - ${GROUND_SIZE / 2}px);
					left: calc(50% - ${GROUND_SIZE / 2}px);
					transform: rotateX(90deg);
				}

				/* Coplanar with the host — no transform of its own — so offsetX/offsetY stay
				   local-plane coordinates. */
				.surface {
					position: absolute;
					inset: 0;
					/* The world sheet is pointer-events:none; we opt back in to catch the
					   placement pointer. */
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
			<div class="surface" onPointerMove=${onPointerMove}></div>
		`;
	}),
);
