import { render, html } from "../../../lib/src";
import { BaseComponent } from "../../../lib/src/types";
import { type BlockProps, blockStyles } from "./cube-block";

type GridProps = BlockProps & {
	size?: string;
	"size-width"?: string;
	"size-height"?: string;
	"size-depth"?: string;
	units?: string;
	"units-width"?: string;
	"units-height"?: string;
	"units-depth"?: string;
};

/*
todos:
- query for all inner blocks and get their dimension. From that we can calculate the 3d grid
- this needs to be done whenever there is a change in their attributes



*/

render("cube-grid", function* (props: GridProps, self: BaseComponent) {
	const width = props["size-width"] ?? props.size ?? "1";
	const widthUnits = props["units-width"] ?? props.units ?? "1rem";

	const height = props["size-height"] ?? props.size ?? "1";
	const heightUnits = props["units-height"] ?? props.units ?? "1rem";

	const depth = props["size-height"] ?? props.size ?? "1";
	const depthsUnits = props["units-height"] ?? props.units ?? "1rem";

	let xIndex = 0;
	let yIndex = 0;
	let zIndex = 0;

	for (const child of self.children) {
		if (!child.tagName.startsWith("CUBE")) {
			continue;
		}
		const x = child.getAttribute("x");
		const y = child.getAttribute("y");
		const z = child.getAttribute("z");
		const childWidth = child.getAttribute("width");
		const childHeight = child.getAttribute("height");
		const childDepth = child.getAttribute("depth");

		if (childWidth === null) {
			child.setAttribute("width", "1");
		}
		if (childHeight === null) {
			child.setAttribute("height", "1");
		}
		if (childDepth === null) {
			child.setAttribute("depth", "1");
		}

		if (x === null) {
			child.setAttribute("x", String(xIndex));
			xIndex += parseInt(childWidth ?? "1");
		}
		if (y === null) {
			child.setAttribute("y", String(yIndex));
			yIndex += parseInt(childHeight ?? "1");
		}
		if (z === null) {
			child.setAttribute("z", String(zIndex));
			zIndex += parseInt(childDepth ?? "1");
		}

		//handle center/auto positionings here
	}

	yield html`
		<style>
			 :host {
			 --height-unit: ${height};
			 --depth-unit: ${depth};
			 --width-unit: ${width};

			 position: relative;
			  display: block;
			  height: calc(${height} * ${heightUnits}) ;
			  width: calc(${width} * ${widthUnits}) ;

			${blockStyles}
			 }
		</style>
		<div>
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
			<slot></slot>
			<cube-block></cube-block>
		</div>
	`;
});
