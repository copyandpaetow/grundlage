import { html, component } from "../../../../lib/src";
import {
	blockTransformFromProps,
	bodySizeVariables,
	geometryProps,
	placementStyles,
	placementVariables,
} from "../scene-shared";

const rampStyles = html`
	<style>
		:host {
			--slope-length: calc(var(--unit) * sqrt(2));
			/* Read by the selection cage and culling to bound the ramp */
			--block-extent-x: calc(var(--unit) / 2 * var(--size-x));
			--block-extent-y: calc(var(--unit) / 2 * var(--size-y));
			--block-extent-z: calc(var(--unit) / 2 * var(--size-z));
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

		.bottom,
		.back {
			width: var(--unit);
			height: var(--unit);
			margin: calc(var(--unit) / -2) 0 0 calc(var(--unit) / -2);
		}
		.bottom {
			transform: rotateX(-90deg) translateZ(calc(var(--unit) / 2));
			background: #c08a4f;
		}
		.back {
			transform: rotateY(180deg) translateZ(calc(var(--unit) / 2));
			background: #a8763f;
		}

		/* The cap passes through the block centre, so its corners land on the
		   front-bottom and back-top edges with no push along its normal. */
		.slope {
			width: var(--unit);
			height: var(--slope-length);
			margin: calc(var(--slope-length) / -2) 0 0 calc(var(--unit) / -2);
			transform: rotateX(45deg);
			background: #e0a85f;
		}

		/* Full unit quads clipped to the prism profile; the right angle sits at the
		   back-bottom corner. */
		.right,
		.left {
			width: var(--unit);
			height: var(--unit);
			margin: calc(var(--unit) / -2) 0 0 calc(var(--unit) / -2);
			background: #b3814a;
		}
		.right {
			transform: rotateY(90deg) translateZ(calc(var(--unit) / 2));
			clip-path: polygon(0% 100%, 100% 100%, 100% 0%);
		}
		.left {
			transform: rotateY(-90deg) translateZ(calc(var(--unit) / 2));
			clip-path: polygon(0% 0%, 0% 100%, 100% 100%);
		}
	</style>
`;

customElements.define(
	"scene-ramp",
	component(
		function* () {
			yield function* view(props) {
				const transform = blockTransformFromProps(props);
				yield html`
					${placementStyles} ${rampStyles} ${placementVariables(transform)}
					<div class="body" style=${bodySizeVariables(transform.size)}>
						<div class="face bottom"></div>
						<div class="face back"></div>
						<div class="face slope"></div>
						<div class="face right"></div>
						<div class="face left"></div>
					</div>
				`;
			};
		},
		{ props: geometryProps },
	),
);
