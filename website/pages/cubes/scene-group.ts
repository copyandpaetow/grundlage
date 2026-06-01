import { html, render } from "../../../lib/src";
import { resolveBlockTransform, UNIT_SIZE } from "./scene-shared";

// <scene-group> — a transform carrier. It contributes a transform and nothing
// else: no faces, never paints. Grouping is just the cascade — selected blocks
// are reparented inside a group and inherit its transform through preserve-3d, so
// moving the group moves the whole subtree with one write (the camera trick,
// scoped to a branch). Ungrouping replaces the group with its children, rebasing
// their transforms back into the parent's space (done in the editor).
//
// It shares the geometries' authoring contract — position/rotation resolved by
// the same bridge into --block-* variables — so the editor selects and drags a
// group with the exact same code path as a cube. A group has no meaningful size
// of its own (scaling would distort its children), so `size` is not read here.
// The slot keeps children in the light DOM (portable, serializable) while routing
// them into this element's 3D context.

customElements.define(
	"scene-group",
	render(function* (element) {
		yield () => {
			// A group has no size of its own (scaling would distort its children),
			// so we resolve all three triples and simply ignore the size.
			const {
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

						transform: translate3d(
								var(--block-x),
								var(--block-y),
								var(--block-z)
							)
							rotateX(var(--block-rotate-x))
							rotateY(var(--block-rotate-y))
							rotateZ(var(--block-rotate-z));
					}

					/* Children must share the group's 3D context, so the slot must not
					   introduce a flattening box. */
					slot {
						display: contents;
					}
				</style>
				<slot></slot>
			`;
		};
	}),
);
