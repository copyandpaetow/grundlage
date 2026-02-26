import { render, html } from "../../../lib/src";

type SceneProps = {
	perspective?: string;
	truck?: string;
	pedestal?: string;
	dolly?: string;
	roll?: string;
	pan?: string;
	tilt?: string;
};

/*
todos:
- from the rotation values we need to calculate which faces are showing
- we pass that down as css variables


*/

render("cube-scene", function* (props: SceneProps) {
	yield html`
		<style>
			--perspective: var(${props.perspective || "200000px"});
			--truck: var(${props.truck || "0px"});
			--pedestal: var(${props.pedestal || "0px"});
			--dolly: var(${props.dolly || "0px"});

			--roll: var(${props.roll || "0deg"});
			--pan: var(${props.pan || "0deg"});
			--tilt: var(${props.tilt || "0deg"});

			display: block;
		</style>
		<section>
			<slot></slot>
		</section>
	`;
});
