import { render, html } from "../../../lib/src";

export type BlockProps = {
	x: string;
	y: string;
	z: string;
	width: string;
	height: string;
	depth: string;
};

/*
todos:
- needs to have variable for each face that regulates the display value
- a toplevel display value also makes sense

*/

export const blockStyles = /*css*/ `
  .cube {
    --block-background: lightgrey;
    --block-border: grey;

    position: relative;
  }

  .front,
  .back {
    height: var(--cube-height);
    width: var(--cube-width);
    display: var(--_block-render-front, block);
    border: var(--block-border);
    background: var(--block-background);
  }

  .back {
      display: none
  }

  .top,
  .bottom {

    position: absolute;
    inset: 0;
    display: var(--_block-render-front, block);
    border: var(--block-border);
    background: var(--block-background);
    height: var(--cube-depth);
    transform: translateY(-50%) rotateX(90.01deg) translateY(-50%);
    top: calc(50% - 50% * var(--_block-y-direction));
    display: none;
  }

  .right,
  .left {
    position: absolute;
    inset: 0;
    display: var(--_block-render-front, block);
    border: var(--block-border);
    background: var(--block-background);
    width: var(--cube-depth);
    transform: translateX(-50%) rotateY(90.01deg) translateX(50%);
    left: calc(50% + 50% * var(--_block-x-direction));
    display: none;
  }
  `;

render("cube-block", function* () {
	yield (props: BlockProps) => {
		return html`
			<style>
				:host {
				  --cube-height: calc(${props.height} * var(--height-unit));
				  --cube-width: calc(${props.width} * var(--width-unit));
				  --cube-depth: calc(${props.depth} * var(--depth-unit));

				  position: absolute;
				  left: calc(${props.x} * var(--width-unit));
				  top: calc(${props.y || "1"} * var(--height-unit));

				    height: var(--cube-height);
				    width: var(--cube-width);
				    display: block;

				    ${blockStyles}
				}
			</style>
			<div class="cube">
				<div class="front">
					<slot name="front"></slot>
				</div>
				<div class="top">
					<slot name="top"></slot>
				</div>
				<div class="right">
					<slot name="right"></slot>
				</div>
				<div class="back">
					<slot name="back"></slot>
				</div>
				<div class="bottom">
					<slot name="bottom"></slot>
				</div>
				<div class="left">
					<slot name="left"></slot>
				</div>
			</div>
		`;
	};
});
