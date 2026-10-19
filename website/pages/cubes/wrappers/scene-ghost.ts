import { html, component } from "../../../../lib/src";
import {
	blockTransformFromProps,
	ghostProps,
	UNIT_SIZE,
} from "../scene-shared";

// <scene-ghost> — the placement preview. It wraps the geometry being placed and carries
// the snapped preview position, so the slotted child shows the real shape at the real
// spot, translucent and inert. On drop the editor lifts the child out and discards the
// ghost. Editor-only: never serialized.
//
// `opacity` on this wrapper would create a group that FLATTENS the child's preserve-3d,
// collapsing the ghost to a 2D silhouette. Instead we hand the child an inherited
// --block-opacity, which its faces apply one plane at a time.

customElements.define(
	"scene-ghost",
	component(
		function* () {
			yield function* view(props) {
				const {
					position: [positionX, positionY, positionZ],
				} = blockTransformFromProps(props);

				yield html`
					<style>
						:host {
							position: absolute;
							top: 50%;
							left: 50%;
							transform-style: preserve-3d;
							/* Cascades to the previewed child, so the preview can't be clicked. */
							pointer-events: none;
							--block-opacity: 0.45;

							--block-x: ${positionX * UNIT_SIZE}px;
							--block-y: ${-positionY * UNIT_SIZE}px;
							--block-z: ${positionZ * UNIT_SIZE}px;

							transform: translate3d(
								var(--block-x),
								var(--block-y),
								var(--block-z)
							);
						}

						/* A flattening box here would collapse the child's preserve-3d. */
						slot {
							display: contents;
						}
					</style>
					<slot></slot>
				`;
			};
		},
		{ props: ghostProps },
	),
);
