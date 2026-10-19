import { html, component } from "../../../../lib/src";
import {
	blockTransformFromProps,
	geometryProps,
	HALF_UNIT,
	UNIT_SIZE,
} from "../scene-shared";

// <scene-wall> — a thin upright panel: two painted faces plus four slim edge faces so
// the slab reads as solid from grazing angles. Same authoring contract as <scene-cube>.

// Baked thickness before scale3d: a wall is authored as a flat surface, so depth
// defaults thin. `depth` (and size's third axis) still scales it.
const THICKNESS = UNIT_SIZE * 0.06;
const HALF_THICKNESS = THICKNESS / 2;

customElements.define(
	"scene-wall",
	component(
		function* () {
			yield function* (props) {
				const {
					size: [width, height, depth],
					position: [positionX, positionY, positionZ],
					rotation: [rotationX, rotationY, rotationZ],
				} = blockTransformFromProps(props);

				yield html`
					<style>
						:host {
							position: absolute;
							top: 50%;
							left: 50%;
							transform-style: preserve-3d;

							/* Author +Y is up, screen +Y is down: negated here at the bridge. */
							--block-x: ${positionX * UNIT_SIZE}px;
							--block-y: ${-positionY * UNIT_SIZE}px;
							--block-z: ${positionZ * UNIT_SIZE}px;
							--block-rotate-x: ${rotationX}deg;
							--block-rotate-y: ${rotationY}deg;
							--block-rotate-z: ${rotationZ}deg;
							--block-scale-x: ${width};
							--block-scale-y: ${height};
							--block-scale-z: ${depth};
							/* Pre-scale half-extents: a wall bounds as a slab, not a cube. */
							--block-extent-x: ${HALF_UNIT}px;
							--block-extent-y: ${HALF_UNIT}px;
							--block-extent-z: ${HALF_THICKNESS}px;

							transform: translate3d(
									var(--block-x),
									var(--block-y),
									var(--block-z)
								)
								rotateX(var(--block-rotate-x)) rotateY(var(--block-rotate-y))
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
							/* The world sheet is pointer-events:none; faces opt back in. */
							pointer-events: auto;
							/* A wrapping <scene-ghost> sets --block-opacity and it inherits
							   across the slot to here. Per-face keeps the 3D context intact —
							   opacity on a preserve-3d ancestor would flatten the block. */
							opacity: var(--block-opacity, 1);
						}

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
		},
		{ props: geometryProps },
	),
);
