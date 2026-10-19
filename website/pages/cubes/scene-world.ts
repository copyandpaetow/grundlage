import { html, component, type Schema } from "../../../lib/src";

// <scene-world> — projection only: the perspective, the single inverse-camera transform
// the whole scene inherits through, and the viewport box it renders into. Authored
// geometry is slotted in as light-DOM children, so the view moves the entire world with
// one transform write and zero per-block work.
//
// The world takes no JS input. The view is entirely its own --camera-* custom properties,
// and the world OWNS them: render it bare and it sits at the default angle below; wrap it
// in <scene-camera> and the camera writes them from the outside. Because the variables live here, a flown view is portable — copy the world and
// paste it bare for a perfectly placed static scene.

// What a hand-authored static embed may pin through `camera-*` attributes; the fallbacks
// are the default view. A wrapping <scene-camera> writes the same variables inline on
// this element, which beats our :host rule.
const props = {
	"camera-x": [String, "0px"],
	"camera-y": [String, "0px"],
	"camera-z": [String, "600px"],
	"camera-yaw": [String, "0deg"],
	"camera-pitch": [String, "0deg"],
	"camera-perspective": [String, "800px"],
} satisfies Schema;

customElements.define(
	"scene-world",
	component(
		function* () {
			yield function* view(componentProps) {
				yield html`
					<style>
						:host {
							--camera-x: ${componentProps["camera-x"]};
							--camera-y: ${componentProps["camera-y"]};
							--camera-z: ${componentProps["camera-z"]};
							--camera-yaw: ${componentProps["camera-yaw"]};
							--camera-pitch: ${componentProps["camera-pitch"]};
							--camera-perspective: ${componentProps["camera-perspective"]};

							display: block;
							position: relative;
							width: 100%;
							height: 70vh;
							overflow: hidden;
							border: 1px solid rgba(255, 255, 255, 0.12);
							border-radius: 12px;
							background: radial-gradient(circle at 50% 30%, #2a2f3a, #14161c);
							cursor: default;
							/* Text selection would fight every click-drag. */
							user-select: none;
							-webkit-user-select: none;
							perspective: var(--camera-perspective);
							perspective-origin: 50% 50%;
						}

						.world {
							position: absolute;
							inset: 0;
							transform-style: preserve-3d;
							transform-origin: 50% 50%;
							/* The flat sheet would shadow every block behind it, so it never
						   intercepts clicks; geometry faces opt back in. */
							pointer-events: none;
							/* Inverse-camera transform. The leading translateZ(perspective) lands the
						   camera point on the eye, so yaw/pitch rotate the view in place. */
							transform: translateZ(var(--camera-perspective))
								rotateX(calc(var(--camera-pitch) * -1))
								rotateY(calc(var(--camera-yaw) * -1))
								translate3d(
									calc(var(--camera-x) * -1),
									calc(var(--camera-y) * -1),
									calc(var(--camera-z) * -1)
								);
						}

						/* display:contents is the UA default for <slot>; we pin it because a
					   block-level slot would collapse the preserve-3d above it and flatten the
					   whole scene. */
						slot {
							display: contents;
						}
					</style>
					<div class="world">
						<!-- A place in the world's 3D floor space for editor chrome: the placement
					     grid lands here. The world lends the slot and knows nothing about what
					     fills it. -->
						<slot name="ground"></slot>
						<slot></slot>
					</div>
				`;
			};
		},
		{ props },
	),
);
