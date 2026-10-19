import { html, component } from "../../../../lib/src";
import {
	blockTransformFromProps,
	geometryProps,
	HALF_UNIT,
	UNIT_SIZE,
} from "../scene-shared";

// <scene-cube> — six faces on a fixed unit cube. Authored attributes come in, concrete
// --block-* variables go out, and everything routes to `transform`: size is scale3d over
// the unit, never a layout property.

customElements.define(
	"scene-cube",
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
							/* Pre-scale half-extents, so the selection cage can bound this
							   geometry without assuming it fills its unit cube. */
							--block-extent-x: ${HALF_UNIT}px;
							--block-extent-y: ${HALF_UNIT}px;
							--block-extent-z: ${HALF_UNIT}px;

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
							width: ${UNIT_SIZE}px;
							height: ${UNIT_SIZE}px;
							margin: ${-HALF_UNIT}px 0 0 ${-HALF_UNIT}px;
							box-sizing: border-box;
							border: 1px solid rgba(0, 0, 0, 0.35);
							display: grid;
							place-items: center;
							font:
								600 14px/1 system-ui,
								sans-serif;
							color: rgba(0, 0, 0, 0.7);
							/* Compositor-side, perspective-correct culling: no JS decides
							   per-face visibility. */
							backface-visibility: hidden;
							/* The world sheet is pointer-events:none; faces opt back in. */
							pointer-events: auto;
							/* A wrapping <scene-ghost> sets --block-opacity and it inherits
							   across the slot to here. Per-face keeps the 3D context intact —
							   opacity on a preserve-3d ancestor would flatten the block. */
							opacity: var(--block-opacity, 1);
						}

						.front {
							transform: translateZ(${HALF_UNIT}px);
							background: #f6c945;
						}
						.back {
							transform: rotateY(180deg) translateZ(${HALF_UNIT}px);
							background: #e8923b;
						}
						.right {
							transform: rotateY(90deg) translateZ(${HALF_UNIT}px);
							background: #4fa6e0;
						}
						.left {
							transform: rotateY(-90deg) translateZ(${HALF_UNIT}px);
							background: #5fc2a8;
						}
						.top {
							transform: rotateX(90deg) translateZ(${HALF_UNIT}px);
							background: #b98cd6;
						}
						.bottom {
							transform: rotateX(-90deg) translateZ(${HALF_UNIT}px);
							background: #d96c8a;
						}
					</style>
					<div class="face front">front</div>
					<div class="face back">back</div>
					<div class="face right">right</div>
					<div class="face left">left</div>
					<div class="face top">top</div>
					<div class="face bottom">bottom</div>
				`;
			};
		},
		{ props: geometryProps },
	),
);
