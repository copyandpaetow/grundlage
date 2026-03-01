import { render, html } from "../../../lib/src";
import { BaseComponent } from "../../../lib/src/types";
import { type BlockProps, cubeStyles, cubeFaceStyles } from "./cube-block";

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
		element.getAttribute(axisToDimension[state.axis]) ?? "0",
	);

	if (elementAxis === null) {
		element.style.setProperty(`--${state.axis}`, String(state.index));
		state.index += elementDimension;
	} else if (elementAxis === "start") {
		element.style.setProperty(`--${state.axis}`, "0");
	} else if (elementAxis === "center") {
		const mid = parseFloat(state.units ?? "0") / 2;
		const childMid = elementDimension / 2;
		element.style.setProperty(`--${state.axis}`, String(mid - childMid));
	} else if (elementAxis === "end") {
		element.style.setProperty(
			`--${state.axis}`,
			String(parseFloat(state.units ?? "0") - elementDimension),
		);
	} else {
		if (isNaN(parseFloat(elementAxis))) {
			console.error(
				`element axis ${state.axis} is not a valid value, defaulting to 0`,
			);
			element.style.setProperty(`--${state.axis}`, "0");
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
	const xUnits = props["units-width"] ?? props.units ?? props.width ?? "1";
	const yUnits = props["units-height"] ?? props.units ?? props.height ?? "1";
	const zUnits = props["units-depth"] ?? props.units ?? props.depth ?? "1";

	const xState: DimensionState = {
		size: props["size-width"] ?? props.size ?? `${100 / parseFloat(xUnits)}cqw`,
		units: xUnits,
		index: 0,
		axis: "x",
	};

	const yState: DimensionState = {
		size:
			props["size-height"] ?? props.size ?? `${100 / parseFloat(yUnits)}cqw`,
		units: yUnits,
		index: 0,
		axis: "y",
	};

	const zState: DimensionState = {
		size: props["size-depth"] ?? props.size ?? `${100 / parseFloat(zUnits)}cqw`,
		units: zUnits,
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
				${cubeStyles}

				.grid {
					display: block;
					position: relative;
					height: var(--cube-height);
					width: var(--cube-width);

					--height-units: ${yState.units};
					--depth-units: ${zState.units};
					--width-units: ${xState.units};
					--height-size: ${yState.size};
					--depth-size: ${zState.size};
					--width-size: ${xState.size};

					${cubeFaceStyles}
				}
			}
		</style>
		<div class="grid">
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
			<slot></slot>
		</div>
	`;
});
