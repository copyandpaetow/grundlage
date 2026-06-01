import { html, render } from "../../../lib/src";
import { HALF_UNIT, resolveBlockTransform, UNIT_SIZE } from "./scene-shared";

// <scene-wall> — one element per geometry. A thin upright panel: its own unit
// geometry is a single quad with a small baked-in thickness, two painted faces
// (front and back) plus four slim edge faces so the slab reads as solid from
// grazing angles. Same authoring contract as <scene-cube> — shorthand vs.
// specific attributes resolved in JS, written out as concrete --block-* variables
// — but the dimension resolution is duplicated here on purpose. The plan keeps
// the geometry elements isolated through Phases 1–2; the shared spine is only
// extracted in Phase 3, once the right abstraction is obvious rather than guessed.

// Baked thickness of the panel before scale3d. A wall is authored as a flat
// surface, so depth defaults thin; `depth`/`size`'s third axis still scales it.
const THICKNESS = UNIT_SIZE * 0.06;
const HALF_THICKNESS = THICKNESS / 2;

customElements.define(
	"scene-wall",
	render(function* (element) {
		yield () => {
			const {
				size: [width, height, depth],
				position: [positionX, positionY, positionZ],
				rotation: [rotationX, rotationY, rotationZ],
			} = resolveBlockTransform(element);

			return html`
				<style>
					:host {
						position: absolute;
						top: 50%;
						left: 50%;
						transform-style: preserve-3d;

						--block-x: ${positionX * UNIT_SIZE}px;
						--block-y: ${-positionY * UNIT_SIZE}px;
						--block-z: ${positionZ * UNIT_SIZE}px;
						--block-rotate-x: ${rotationX}deg;
						--block-rotate-y: ${rotationY}deg;
						--block-rotate-z: ${rotationZ}deg;
						--block-scale-x: ${width};
						--block-scale-y: ${height};
						--block-scale-z: ${depth};
						/* Local half-extents (px, before scale): let the selection cage bound this
						   geometry without assuming it fills its unit cube. */
						--block-extent-x: ${HALF_UNIT}px;
						--block-extent-y: ${HALF_UNIT}px;
						--block-extent-z: ${HALF_THICKNESS}px;

						transform: translate3d(
								var(--block-x),
								var(--block-y),
								var(--block-z)
							)
							rotateX(var(--block-rotate-x))
							rotateY(var(--block-rotate-y))
							rotateZ(var(--block-rotate-z))
							scale3d(
								var(--block-scale-x),
								var(--block-scale-y),
								var(--block-scale-z)
							);
					}

					.face {
						position: absolute;
						top: 50%;
						left: 50%;
						box-sizing: border-box;
						border: 1px solid rgba(0, 0, 0, 0.35);
						backface-visibility: hidden;
						/* World sheet is pointer-events:none; faces opt back in to stay clickable. */
						pointer-events: auto;
						/* Ambient dim hook: a wrapping <scene-ghost> sets --block-opacity and
						   it inherits across the slot to here. Per-face opacity keeps the 3D
						   context intact (opacity on a preserve-3d ancestor would flatten the
						   whole block). Geometry knows nothing about ghosting. */
						opacity: var(--block-opacity, 1);
					}


					/* Broad faces: the painted surfaces of the panel. */
					.front,
					.back {
						width: ${UNIT_SIZE}px;
						height: ${UNIT_SIZE}px;
						margin: ${-HALF_UNIT}px 0 0 ${-HALF_UNIT}px;
						background: #8a93a6;
					}
					.front {
						transform: translateZ(${HALF_THICKNESS}px);
					}
					.back {
						transform: rotateY(180deg) translateZ(${HALF_THICKNESS}px);
					}

					/* Edge faces: span the thickness so the slab is closed. */
					.left,
					.right {
						width: ${THICKNESS}px;
						height: ${UNIT_SIZE}px;
						margin: ${-HALF_UNIT}px 0 0 ${-HALF_THICKNESS}px;
						background: #6c748a;
					}
					.right {
						transform: rotateY(90deg) translateZ(${HALF_UNIT}px);
					}
					.left {
						transform: rotateY(-90deg) translateZ(${HALF_UNIT}px);
					}
					.top,
					.bottom {
						width: ${UNIT_SIZE}px;
						height: ${THICKNESS}px;
						margin: ${-HALF_THICKNESS}px 0 0 ${-HALF_UNIT}px;
						background: #767f94;
					}
					.top {
						transform: rotateX(90deg) translateZ(${HALF_UNIT}px);
					}
					.bottom {
						transform: rotateX(-90deg) translateZ(${HALF_UNIT}px);
					}
				</style>
				<div class="face front"></div>
				<div class="face back"></div>
				<div class="face right"></div>
				<div class="face left"></div>
				<div class="face top"></div>
				<div class="face bottom"></div>
			`;
		};
	}),
);
