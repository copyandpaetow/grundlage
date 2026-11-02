import { html, component, prop } from "../../../lib/src";
import { startSceneCulling } from "./scene-culling";
import { registerProperties } from "./scene-shared";

// One inverse-camera transform the whole scene inherits, so a camera move is one write and
// no per-block work. The view lives in the world's own camera-* attributes, so a copied world
// keeps it.
const props = {
	"camera-x": prop.attribute(String, "0px"),
	"camera-y": prop.attribute(String, "0px"),
	"camera-z": prop.attribute(String, "600px"),
	"camera-yaw": prop.attribute(String, "0deg"),
	"camera-pitch": prop.attribute(String, "0deg"),
	"camera-perspective": prop.attribute(String, "800px"),
	"camera-orbit-radius": prop.attribute(String, "0px"),
};

// Non-inheriting, so a camera frame restyles the world alone, not every element of every
// block. Bound on .world itself: pulled down with `inherit`, WebKit never re-resolves them
// when the host's value changes, and as stylesheet holes they double Chrome's style time.
registerProperties([
	...["x", "y", "z", "perspective", "orbit-radius"].map((name) => ({
		name: `--camera-${name}`,
		syntax: "<length>",
		inherits: false,
		initialValue: "0px",
	})),
	...["yaw", "pitch"].map((name) => ({
		name: `--camera-${name}`,
		syntax: "<angle>",
		inherits: false,
		initialValue: "0deg",
	})),
]);

customElements.define(
	"scene-world",
	component(
		function* ({ host }) {
			const stopSceneCulling = startSceneCulling(
				host,
				"scene-cube",
				"scene-gizmo",
				// The placement preview is translucent
				"[see-through], scene-ghost *",
			);
			yield function* view(componentProps) {
				yield html`
					<style>
						:host {
							--camera-perspective: ${componentProps["camera-perspective"]};

							display: block;
							position: relative;
							width: 100%;
							height: 70vh;
							overflow: hidden;
							border: 1px solid rgba(255, 255, 255, 0.12);
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
							/* Inverse camera: view = T(perspective - r) · Rx(-pitch) · Ry(-yaw) · T(-camera).
							   translateZ(perspective) lands the camera point on the eye, so yaw and
							   pitch turn the view in place. Backing off by the orbit radius r before
							   rotating swings the same yaw and pitch round the camera point, with no
							   trig. */
							transform: translateZ(var(--camera-perspective))
								translateZ(calc(var(--camera-orbit-radius) * -1))
								rotateX(calc(var(--camera-pitch) * -1))
								rotateY(calc(var(--camera-yaw) * -1))
								translate3d(
									calc(var(--camera-x) * -1),
									calc(var(--camera-y) * -1),
									calc(var(--camera-z) * -1)
								);
						}

						/* display:contents is the UA default for <slot>; pinned, because a
						   block-level slot would flatten the whole scene's preserve-3d. */
						slot {
							display: contents;
						}
					</style>
					<div
						class="world"
						style="--camera-x: ${componentProps["camera-x"]}; --camera-y: ${componentProps["camera-y"]}; --camera-z: ${componentProps["camera-z"]}; --camera-yaw: ${componentProps["camera-yaw"]}; --camera-pitch: ${componentProps["camera-pitch"]}; --camera-perspective: ${componentProps["camera-perspective"]}; --camera-orbit-radius: ${componentProps["camera-orbit-radius"]};"
					>
						<!-- Editor chrome in the world's 3D space, such as the placement grid.
						     The world knows nothing about what fills it. -->
						<slot name="ground"></slot>
						<slot></slot>
					</div>
				`;
			};
			return stopSceneCulling;
		},
		{ props },
	),
);
