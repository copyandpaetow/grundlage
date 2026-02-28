import { render, html } from "../../../lib/src";

export type BlockProps = {
	x: string;
	y: string;
	z: string;
	width: string;
	height: string;
	depth: string;
};

export const blockStyles = /*css*/ `
 transform-style: preserve-3d;
  & :where(*) {
    transform-style: preserve-3d;
  }

  .face {
    inset: 0;
    position: absolute;
    border: var(--block-border);
    background: var(--block-background);
  }

  .front {
    height: var(--cube-height);
    width: var(--cube-width);
    display: var(--cube-render-front, block);
  }

  .back {
    display: var(--cube-render-back, block);
    transform: rotateY(90.01deg) translateX(var(--cube-depth))
      rotateY(-90.01deg);
    background: green;  
  }

  .right {
    display: var(--cube-render-right, block);
    width: var(--cube-depth);
    transform: translateX(-50%) rotateY(90.01deg) translateX(50%);
    left: 100%;
    background: orange;
  }

  .left {
    display: var(--cube-render-left, block);
    width: var(--cube-depth);
    transform: translateX(-50%) rotateY(90.01deg) translateX(50%);
    background: blue;
  }

  .top{
    display: var(--cube-render-top, block);
    height: var(--cube-depth);
    transform: translateY(-50%) rotateX(90.01deg) translateY(-50%);
    background: white;
  }

  .bottom{
    display: var(--cube-render-bottom, block);
    height: var(--cube-depth);
    transform: translateY(-50%) rotateX(90.01deg) translateY(-50%);
    top: 100%;
    background: pink;
  }


  `;

render("cube-block", function* () {
	yield html`
		<style>
			:host {
			  --cube-height: calc(var(--height) * var(--height-size));
			  --cube-width: calc(var(--width) * var(--width-size));
			  --cube-depth: calc(var(--depth) * var(--depth-size));

			     --translate-z: calc((var(--z) + var(--depth) - var(--depth-units)) * var(--depth-size));
			     --translate-y:calc((var(--height-units) - var(--y) - var(--height)) * var(--height-size));
			     --translate-x: calc(var(--x)* var(--width-size));


			  position: absolute;
			  /* left: calc(var(--x)* var(--width-size)); */
			  /* top: calc((var(--height-units) - var(--y) - var(--height)) * var(--height-size)); */
			 /* transform: translateX(var(--translate-x)) translateY(var(--translate-y)) translateZ(var(--translate-z)) ; */
			    transform: translate3d(var(--translate-x), var(--translate-y), var(--translate-z)) ;

			      height: var(--cube-height);
			      width: var(--cube-width);
			      display: block;

			      --block-background: red;
			      --block-border: blue;


			      ${blockStyles}
			}
		</style>

		<div class="face front">
			<slot name="front"></slot>
		</div>
		<div class="face top">
			<slot name="top"></slot>
		</div>
		<div class="face right">
			<slot name="right"></slot>
		</div>
		<div class="face back">
			<slot name="back"></slot>
		</div>
		<div class="face bottom">
			<slot name="bottom"></slot>
		</div>
		<div class="face left">
			<slot name="left"></slot>
		</div>
	`;
});
