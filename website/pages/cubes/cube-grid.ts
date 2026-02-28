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
- we need a different auto-filling strat. If the next element (if fixed) would overlap the current one, we need to move it after

*/

const axisToDimension = {
	x: "width",
	y: "height",
	z: "depth",
} as const;

type DimensionState = {
	size: string;
	units: string;
	index: number;
	axis: "x" | "y" | "z";
};

const normalizeChildPositions = (
	state: DimensionState,
	element: BaseComponent,
) => {
	const elementAxis = element.getAttribute(state.axis);
	const elementDimension = parseFloat(
		element.getAttribute(axisToDimension[state.axis]) ?? "1",
	);

	if (elementAxis === null) {
		element.style.setProperty(`--${state.axis}`, String(state.index));
		state.index += elementDimension;
	} else if (elementAxis === "start") {
		element.style.setProperty(`--${state.axis}`, "0");
	} else if (elementAxis === "center") {
		const mid = parseFloat(state.units ?? "1") / 2;
		const childMid = elementDimension / 2;
		element.style.setProperty(`--${state.axis}`, String(mid - childMid));
	} else if (elementAxis === "end") {
		element.style.setProperty(
			`--${state.axis}`,
			String(parseFloat(state.units ?? "1") - elementDimension),
		);
	} else {
		if (isNaN(parseFloat(elementAxis))) {
			console.error(
				`element axis ${state.axis} is not a valid value, defaulting to 1`,
			);
			element.style.setProperty(`--${state.axis}`, "1");
		} else {
			element.style.setProperty(`--${state.axis}`, elementAxis);
		}
	}
	element.style.setProperty(
		`--${axisToDimension[state.axis]}`,
		String(elementDimension),
	);
};

render("cube-grid", function* (props: GridProps, self: BaseComponent) {
	const xState: DimensionState = {
		size: props["size-width"] ?? props.size ?? "1",
		units: props["units-width"] ?? props.units ?? "1em",
		index: 0,
		axis: "x",
	};

	const yState: DimensionState = {
		size: props["size-height"] ?? props.size ?? "1",
		units: props["units-height"] ?? props.units ?? "1em",
		index: 0,
		axis: "y",
	};

	const zState: DimensionState = {
		size: props["size-depth"] ?? props.size ?? "1",
		units: props["units-depth"] ?? props.units ?? "1em",
		index: 0,
		axis: "z",
	};

	for (const child of self.children) {
		if (!child.tagName.startsWith("CUBE")) {
			continue;
		}
		normalizeChildPositions(xState, child as BaseComponent);
		normalizeChildPositions(yState, child as BaseComponent);
		normalizeChildPositions(zState, child as BaseComponent);
	}

	yield html`
		<style>
					:host {
				--height-units: ${yState.units};
					 --depth-units: ${zState.units};
					 --width-units: ${xState.units};
			--height-size: ${yState.size};
					 --depth-size: ${zState.size};
					 --width-size: ${xState.size};

				      position: relative;
					       display: block;
					       height: calc(${yState.size} * ${yState.units}) ;
					       width: calc(${xState.size} * ${xState.units}) ;

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
