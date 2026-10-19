import { html, component } from "../../../../lib/src";
import {
	blockTransformFromProps,
	carrierProps,
	UNIT_SIZE,
} from "../scene-shared";

// <scene-group> — a transform carrier: it contributes a transform and never paints.
// Grouping is just the cascade — members are reparented inside and inherit through
// preserve-3d, so moving the group moves the subtree with one write. It shares the
// geometries' authoring contract, so the editor drags a group with the same code path
// as a cube. Scaling would distort its children, so `size` is not declared.

customElements.define(
	"scene-group",
	component(
		function* () {
			yield function* view(props) {
				const {
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
								rotateX(var(--block-rotate-x)) rotateY(var(--block-rotate-y))
								rotateZ(var(--block-rotate-z));
						}

						/* A flattening box here would collapse the children's preserve-3d. */
						slot {
							display: contents;
						}
					</style>
					<slot></slot>
				`;
			};
		},
		{ props: carrierProps },
	),
);
