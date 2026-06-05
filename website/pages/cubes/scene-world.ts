import { html, render } from "../../../lib/src";

// <scene-world> — projection only. It holds the perspective and the single
// inverse-camera wrapper transform the whole scene inherits through, plus the viewport
// box the scene renders into. Authored geometry is slotted in as light-DOM children, so
// the view moves the entire world with one transform write and zero per-block work.
//
// The world takes NO JS input: the view is entirely its own `--camera-*` custom
// properties, read through `var(--camera-*, fallback)`. The world OWNS these variables;
// whoever sets them owns the view. Render it bare and it sits at the fixed fallback angle
// (a read-only embed). Wrap it in <scene-camera> and the camera writes the variables onto
// this element from the outside to fly it; wrap that in <scene-editor> to author it.
// Because the variables live here, a flown view is portable: copy the world (its inline
// `--camera-*` come along) and paste it bare for a perfectly-placed static scene. A
// hand-authored static embed can pick its angle through `camera-*` attributes, which we
// map once onto inline `--camera-*` below.

// The camera variables an author may pin through `camera-*` attributes on a bare world.
const CAMERA_VARIABLES = [
	"x",
	"y",
	"z",
	"yaw",
	"pitch",
	"perspective",
] as const;

customElements.define(
	"scene-world",
	render(function* (element) {
		yield html`
			<style>
				:host {
					display: block;
					position: relative;
					width: 100%;
					height: 70vh;
					overflow: hidden;
					border: 1px solid rgba(255, 255, 255, 0.12);
					border-radius: 12px;
					background: radial-gradient(circle at 50% 30%, #2a2f3a, #14161c);
					cursor: default;
					/* Selecting text would fight every click-drag, so opt the whole
					   scene out of selection. */
					user-select: none;
					-webkit-user-select: none;
					perspective: var(--camera-perspective, 800px);
					perspective-origin: 50% 50%;
				}

				.world {
					position: absolute;
					inset: 0;
					transform-style: preserve-3d;
					transform-origin: 50% 50%;
					/* The flat world sheet must never intercept clicks, or it would
					   shadow every block sitting behind it (the "can't click the back
					   half" bug). Geometry faces opt back into pointer events. */
					pointer-events: none;
					/* Inverse-camera transform, read through fallbacks so a bare world
					   sits at a fixed default and a wrapping <scene-camera> overrides by
					   inheritance. The leading translateZ(perspective) lands the camera
					   point on the eye so yaw/pitch rotate the view in place. One write
					   moves everything. */
					transform: translateZ(var(--camera-perspective, 800px))
						rotateX(calc(var(--camera-pitch, 0deg) * -1))
						rotateY(calc(var(--camera-yaw, 0deg) * -1))
						translate3d(
							calc(var(--camera-x, 0px) * -1),
							calc(var(--camera-y, 0px) * -1),
							calc(var(--camera-z, 600px) * -1)
						);
				}

				/* Slotted geometry must share the world's 3D context, so the slot
				   itself must not introduce a flattening box. */
				slot {
					display: contents;
				}
			</style>
			<div class="world"><slot></slot></div>
		`;

		// Map any `camera-*` attributes onto inline `--camera-*` so a bare (camera-less)
		// world can still pick a fixed angle. This runs after the first yield, which the
		// lib reaches only on the client; a wrapping <scene-camera> overrides these the
		// moment it writes its own variables, so they only matter for the static embed.
		for (const variable of CAMERA_VARIABLES) {
			const value = element.getAttribute(`camera-${variable}`);
			if (value !== null) {
				element.style.setProperty(`--camera-${variable}`, value);
			}
		}
	}),
);
