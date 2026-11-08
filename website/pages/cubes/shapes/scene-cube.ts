import { html, component } from "../../../../lib/src";
import {
	blockTransformFromProps,
	bodySizeVariables,
	geometryProps,
	placementStyles,
	placementVariables,
} from "../scene-shared";

//Size is scale3d on the .body alone, never a layout property, so child blocks keep the
//world grid

const cubeStyles = html`
	<style>
		:host {
			/* Read by the selection cage and culling to bound the cube */
			--block-extent-x: calc(var(--unit) / 2 * var(--size-x));
			--block-extent-y: calc(var(--unit) / 2 * var(--size-y));
			--block-extent-z: calc(var(--unit) / 2 * var(--size-z));
		}

		/* A flattening box here would collapse the children's preserve-3d. */
		slot {
			display: contents;
		}

		.face {
			position: absolute;
			top: 50%;
			left: 50%;
			width: var(--unit);
			height: var(--unit);
			margin: calc(var(--unit) / -2) 0 0 calc(var(--unit) / -2);
			box-sizing: border-box;
			border: 1px solid rgba(0, 0, 0, 0.35);
			display: grid;
			place-items: center;
			font:
				600 14px/1 system-ui,
				sans-serif;
			color: rgba(0, 0, 0, 0.7);
			/* Covers the frame before scene-culling writes hidden-faces, and every face under
			   a drag carrier, which scene-culling leaves whole. */
			backface-visibility: hidden;
			/* The world sheet is pointer-events:none; faces opt back in. */
			pointer-events: auto;
			/* Per face: opacity on a preserve-3d ancestor would flatten the block */
			opacity: var(--block-opacity, 1);
		}

		:host([outside-view]) .body,
		:host([occluded]) .body {
			display: none;
		}

		:host([hidden-faces~="front"]) .front,
		:host([hidden-faces~="back"]) .back,
		:host([hidden-faces~="right"]) .right,
		:host([hidden-faces~="left"]) .left,
		:host([hidden-faces~="top"]) .top,
		:host([hidden-faces~="bottom"]) .bottom {
			display: none;
		}

		.front {
			transform: translateZ(calc(var(--unit) / 2));
			background: #f6c945;
		}
		.back {
			transform: rotateY(180deg) translateZ(calc(var(--unit) / 2));
			background: #e8923b;
		}
		.right {
			transform: rotateY(90deg) translateZ(calc(var(--unit) / 2));
			background: #4fa6e0;
		}
		.left {
			transform: rotateY(-90deg) translateZ(calc(var(--unit) / 2));
			background: #5fc2a8;
		}
		.top {
			transform: rotateX(90deg) translateZ(calc(var(--unit) / 2));
			background: #b98cd6;
		}
		.bottom {
			transform: rotateX(-90deg) translateZ(calc(var(--unit) / 2));
			background: #d96c8a;
		}
	</style>
`;

customElements.define(
	"scene-cube",
	component(
		function* () {
			yield function* view(props) {
				const transform = blockTransformFromProps(props);
				yield html`
					${placementStyles} ${cubeStyles} ${placementVariables(transform)}
					<div class="body" style=${bodySizeVariables(transform.size)}>
						<div class="face front">front</div>
						<div class="face back">back</div>
						<div class="face right">right</div>
						<div class="face left">left</div>
						<div class="face top">top</div>
						<div class="face bottom">bottom</div>
					</div>
					<slot></slot>
				`;
			};
		},
		{ props: geometryProps },
	),
);
