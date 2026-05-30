import { html, render } from "../../../lib/src";
import { resolveTriple, UNIT_SIZE } from "./scene-shared";

// <scene-cube> — one element per geometry. It owns its six faces and a fixed
// unit-cube layout. Authored state arrives as attributes; the render function
// re-runs on every attribute change (the lib watches attributes with a
// MutationObserver), resolves shorthand-vs-specific precedence, and writes the
// concrete --block-* variables. Everything routes to `transform`: size is
// scale3d over the unit cube, never a layout property.

const SIZE_SPECIFIC = ["width", "height", "depth"] as const;
const POSITION_SPECIFIC = ["x", "y", "z"] as const;
const ROTATION_SPECIFIC = ["rotate-x", "rotate-y", "rotate-z"] as const;

const HALF_UNIT = UNIT_SIZE / 2;

customElements.define(
	"scene-cube",
	render(function* (element) {
		yield () => {
			// The attribute → variable bridge: committed attributes in, concrete
			// render variables out. CSS downstream reads only the resolved values.
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
						/* Faces compose into one 3D context with the world through
						   preserve-3d. */
						transform-style: preserve-3d;

						/* Author with +Y up; CSS screen-space is +Y down, so we
						   negate the Y position here at the bridge. */
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
						/* Self-backface culling: free, compositor-side, and
						   perspective-correct. No JS decides per-face visibility. */
						backface-visibility: hidden;
						/* World sheet is pointer-events:none; faces opt back in to stay clickable. */
						pointer-events: auto;
					}

					/* Multi-select cue for grouping. The primary selection is shown by
					   the <scene-gizmo> that wraps it, not a class; this faint outline
					   only marks the extra co-selected members. Editor-only, never
					   serialized. */
					:host([co-selected]) .face {
						outline: 2px dashed rgba(255, 255, 255, 0.8);
						outline-offset: -2px;
					}

					/* Six faces of a unit cube, laid out once. Each is pushed out by
					   half a unit along its own normal after orienting; with backface
					   culling only the outward side of each ever paints. */
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
	}),
);
