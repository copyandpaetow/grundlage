import { html, component } from "../../../../lib/src";
import {
	blockTransformFromProps,
	bodySizeVariables,
	geometryProps,
	placementStyles,
	placementVariables,
} from "../scene-shared";

//Authored as a flat surface, so the baked depth is a fraction of the unit that `depth`
//still scales. Slim edge faces keep the slab solid at grazing angles.

const wallStyles = html`
	<style>
		:host {
			--thickness: calc(var(--unit) * 0.06);
			/* Scaled half-extents: a wall bounds as a slab, not a cube. */
			--block-extent-x: calc(var(--unit) / 2 * var(--size-x));
			--block-extent-y: calc(var(--unit) / 2 * var(--size-y));
			--block-extent-z: calc(var(--thickness) / 2 * var(--size-z));
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
			/* Per face: opacity on a preserve-3d ancestor would flatten the block */
			opacity: var(--block-opacity, 1);
		}

		.front,
		.back {
			width: var(--unit);
			height: var(--unit);
			margin: calc(var(--unit) / -2) 0 0 calc(var(--unit) / -2);
			background: #8a93a6;
		}
		.front {
			transform: translateZ(calc(var(--thickness) / 2));
		}
		.back {
			transform: rotateY(180deg) translateZ(calc(var(--thickness) / 2));
		}

		.left,
		.right {
			width: var(--thickness);
			height: var(--unit);
			margin: calc(var(--unit) / -2) 0 0 calc(var(--thickness) / -2);
			background: #6c748a;
		}
		.right {
			transform: rotateY(90deg) translateZ(calc(var(--unit) / 2));
		}
		.left {
			transform: rotateY(-90deg) translateZ(calc(var(--unit) / 2));
		}
		.top,
		.bottom {
			width: var(--unit);
			height: var(--thickness);
			margin: calc(var(--thickness) / -2) 0 0 calc(var(--unit) / -2);
			background: #767f94;
		}
		.top {
			transform: rotateX(90deg) translateZ(calc(var(--unit) / 2));
		}
		.bottom {
			transform: rotateX(-90deg) translateZ(calc(var(--unit) / 2));
		}
	</style>
`;

customElements.define(
	"scene-wall",
	component(
		function* () {
			yield function* view(props) {
				const transform = blockTransformFromProps(props);
				yield html`
					${placementStyles} ${wallStyles} ${placementVariables(transform)}
					<div class="body" style=${bodySizeVariables(transform.size)}>
						<div class="face front"></div>
						<div class="face back"></div>
						<div class="face right"></div>
						<div class="face left"></div>
						<div class="face top"></div>
						<div class="face bottom"></div>
					</div>
				`;
			};
		},
		{ props: geometryProps },
	),
);
