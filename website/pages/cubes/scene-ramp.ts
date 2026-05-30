import { html, render } from "../../../lib/src";
import { resolveTriple, UNIT_SIZE } from "./scene-shared";

// <scene-ramp> — one element per geometry. A right-triangular prism: a flat base,
// a vertical back, a 45° sloped cap rising from the front-bottom edge to the
// back-top edge, and two triangular sides. The slope rises front→back, so a cube
// sitting "behind and above" reads as the top of the ramp. Same authoring
// contract and the same deliberate duplication as <scene-cube>/<scene-wall>:
// dimension resolution is repeated here on purpose and only unified in Phase 3.
//
// Geometry in local screen space (matching the cube's faces): +z is toward the
// viewer (front), screen-up is -y, +x is right. The sloped cap passes through the
// block centre, so its corners land exactly on the front-bottom and back-top
// edges with no extra push along its normal.

const SIZE_SPECIFIC = ["width", "height", "depth"] as const;
const POSITION_SPECIFIC = ["x", "y", "z"] as const;
const ROTATION_SPECIFIC = ["rotate-x", "rotate-y", "rotate-z"] as const;

const HALF_UNIT = UNIT_SIZE / 2;
// The hypotenuse of a unit right triangle: the sloped cap is this long.
const SLOPE_LENGTH = UNIT_SIZE * Math.SQRT2;
const HALF_SLOPE = SLOPE_LENGTH / 2;

customElements.define(
	"scene-ramp",
	render(function* (element) {
		yield () => {
			const [width, height, depth] = resolveTriple(
				element,
				"size",
				SIZE_SPECIFIC,
				1,
			);
			const [positionX, positionY, positionZ] = resolveTriple(
				element,
				"position",
				POSITION_SPECIFIC,
				0,
			);
			const [rotationX, rotationY, rotationZ] = resolveTriple(
				element,
				"rotation",
				ROTATION_SPECIFIC,
				0,
			);

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
					}

					:host([selected]) .face {
						outline: 2px solid #ffffff;
						outline-offset: -2px;
					}

					/* Placement preview: real geometry, translucent and inert. */
					:host([ghost]) {
						opacity: 0.4;
						pointer-events: none;
					}

					/* Base and back are full unit quads, same as the cube's. */
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

					/* The sloped cap: a quad as wide as the unit but as tall as the
					   hypotenuse, tilted 45° so its ends meet the front-bottom and
					   back-top edges. Its outward normal faces up-and-front. */
					.slope {
						width: ${UNIT_SIZE}px;
						height: ${SLOPE_LENGTH}px;
						margin: ${-HALF_SLOPE}px 0 0 ${-HALF_UNIT}px;
						transform: rotateX(45deg);
						background: #e0a85f;
					}

					/* Triangular sides: full unit quads clipped to the prism profile.
					   The right angle sits at the back-bottom corner. */
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
	}),
);
