import { html, component } from "../../../../lib/src";
import {
	blockTransformFromProps,
	carrierProps,
	HALF_UNIT,
	placementStyles,
	placementVariables,
} from "../scene-shared";
import { blocksBoundsPx, type Bounds, isBlock } from "../scene-geometry";

// Apart from the gizmo, so one and many selected blocks are alike: each is one more child.
// Each render paints twice, because the blocks assign only once the slot exists; the second
// paint is a patch with the measured box. The editor owns every content change, so it
// re-renders the cage instead of the cage observing its subtree.

// Screen px the cage stands proud of the box: flush, it z-fights the faces and vanishes.
const SELECT_MARGIN = 6;

const slottedBlocks = (element: HTMLElement): Element[] => {
	const slot = element.shadowRoot?.querySelector("slot");
	return (slot?.assignedElements() ?? []).filter(isBlock);
};

customElements.define(
	"scene-select",
	component(
		function* () {
			yield function* view(props) {
				const placement = placementVariables(blockTransformFromProps(props));

				// Null while the slot is still going up, and on a cage holding nothing; both
				// hide the box rather than draw a zero one.
				const cage = (bounds: Bounds | null) => {
					const centerX = bounds ? bounds.center[0] : 0;
					const centerY = bounds ? bounds.center[1] : 0;
					const centerZ = bounds ? bounds.center[2] : 0;
					const halfX = bounds ? bounds.half[0] + SELECT_MARGIN : HALF_UNIT;
					const halfY = bounds ? bounds.half[1] + SELECT_MARGIN : HALF_UNIT;
					const halfZ = bounds ? bounds.half[2] + SELECT_MARGIN : HALF_UNIT;

					return html`
						${placementStyles} ${placement}
						<style>
							:host {
								pointer-events: none;

								--box-display: ${bounds === null ? "none" : "block"};
								--center-x: ${centerX}px;
								--center-y: ${centerY}px;
								--center-z: ${centerZ}px;
								--half-x: ${halfX}px;
								--half-y: ${halfY}px;
								--half-z: ${halfZ}px;
							}

							/* No rotation of its own, so it never swings behind a turned block */
							.box {
								display: var(--box-display);
								position: absolute;
								top: 50%;
								left: 50%;
								transform-style: preserve-3d;
								pointer-events: none;
								transform: translate3d(
									var(--center-x),
									var(--center-y),
									var(--center-z)
								);
							}

							.edge {
								position: absolute;
								top: 50%;
								left: 50%;
								box-sizing: border-box;
								border: 2px dashed rgba(120, 220, 255, 0.95);
								background: rgba(120, 220, 255, 0.08);
							}
							.front,
							.back {
								width: calc(2 * var(--half-x));
								height: calc(2 * var(--half-y));
								margin: calc(-1 * var(--half-y)) 0 0 calc(-1 * var(--half-x));
							}
							.front {
								transform: translateZ(var(--half-z));
							}
							.back {
								transform: translateZ(calc(-1 * var(--half-z)));
							}
							.right,
							.left {
								width: calc(2 * var(--half-z));
								height: calc(2 * var(--half-y));
								margin: calc(-1 * var(--half-y)) 0 0 calc(-1 * var(--half-z));
							}
							.right {
								transform: rotateY(90deg) translateZ(var(--half-x));
							}
							.left {
								transform: rotateY(-90deg) translateZ(var(--half-x));
							}
							.top,
							.bottom {
								width: calc(2 * var(--half-x));
								height: calc(2 * var(--half-z));
								margin: calc(-1 * var(--half-z)) 0 0 calc(-1 * var(--half-x));
							}
							.top {
								transform: rotateX(90deg) translateZ(var(--half-y));
							}
							.bottom {
								transform: rotateX(-90deg) translateZ(var(--half-y));
							}

							/* A flattening box here would collapse the blocks' preserve-3d. */
							slot {
								display: contents;
							}
						</style>
						<div class="box">
							<div class="edge front"></div>
							<div class="edge back"></div>
							<div class="edge right"></div>
							<div class="edge left"></div>
							<div class="edge top"></div>
							<div class="edge bottom"></div>
						</div>
						<slot></slot>
					`;
				};

				yield cage(null);
				yield cage(blocksBoundsPx(slottedBlocks(props.host)));
			};
		},
		{ props: carrierProps },
	),
);
