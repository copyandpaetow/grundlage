import { html, component } from "../../../../lib/src";
import {
	blockTransformFromProps,
	geometryProps,
	HALF_UNIT,
	UNIT_SIZE,
} from "../scene-shared";

// <scene-ramp> — a right-triangular prism: flat base, vertical back, a 45° cap rising
// front→back, and two triangular sides. Same authoring contract as <scene-cube>. Local
// space matches the cube's: +z toward the viewer, screen-up is -y, +x right.

// The hypotenuse of a unit right triangle: how long the sloped cap has to be.
const SLOPE_LENGTH = UNIT_SIZE * Math.SQRT2;
const HALF_SLOPE = SLOPE_LENGTH / 2;

customElements.define(
	"scene-ramp",
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
							/* Pre-scale half-extents, for the selection cage to bound. */
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

						.bottom,
						.back {
							width: ${UNIT_SIZE}px;
							height: ${UNIT_SIZE}px;
							margin: ${-HALF_UNIT}px 0 0 ${-HALF_UNIT}px;
						}
						.bottom {
							transform: rotateX(-90deg) translateZ(${HALF_UNIT}px);
							background: #c08a4f;
						}
						.back {
							transform: rotateY(180deg) translateZ(${HALF_UNIT}px);
							background: #a8763f;
						}

						/* The cap passes through the block centre, so its corners land on the
						   front-bottom and back-top edges with no push along its normal. */
						.slope {
							width: ${UNIT_SIZE}px;
							height: ${SLOPE_LENGTH}px;
							margin: ${-HALF_SLOPE}px 0 0 ${-HALF_UNIT}px;
							transform: rotateX(45deg);
							background: #e0a85f;
						}

						/* Full unit quads clipped to the prism profile; the right angle sits
						   at the back-bottom corner. */
						.right,
						.left {
							width: ${UNIT_SIZE}px;
							height: ${UNIT_SIZE}px;
							margin: ${-HALF_UNIT}px 0 0 ${-HALF_UNIT}px;
							background: #b3814a;
						}
						.right {
							transform: rotateY(90deg) translateZ(${HALF_UNIT}px);
							clip-path: polygon(0% 100%, 100% 100%, 100% 0%);
						}
						.left {
							transform: rotateY(-90deg) translateZ(${HALF_UNIT}px);
							clip-path: polygon(0% 0%, 0% 100%, 100% 100%);
						}
					</style>
					<div class="face bottom"></div>
					<div class="face back"></div>
					<div class="face slope"></div>
					<div class="face right"></div>
					<div class="face left"></div>
				`;
			};
		},
		{ props: geometryProps },
	),
);
