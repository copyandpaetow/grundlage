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

const calculateHiddenFaces = (props: SceneProps) => {
	let style = "";

	if (parseInt(props.roll || "0deg") > 0) {
		style += "\n --cube-render-top: none;";
	} else {
		style += "\n --cube-render-bottom: none;";
	}

	if (parseInt(props.pan || "0deg") > 0) {
		style += "\n --cube-render-right: none;";
	} else {
		style += "\n --cube-render-left: none;";
	}

	return style;
};

const styles = /*css*/ `
    transform: perspective(var(--camera-perspective)) translateZ(var(--camera-perspective))
      translateX(calc(var(--camera-truck) * -1))
      translateY(var(--camera-pedestal))
      translateZ(calc(var(--camera-dolly) * -1)) rotateX(var(--camera-roll))
      rotateY(var(--camera-pan)) rotateZ(var(--camera-tilt))
      translateZ(calc(var(--camera-perspective) * -1));

      display: block;
      contain: layout;
       transform-style: preserve-3d;

      & :where(*) {
        transform-style: preserve-3d;
      }

    & :where(*:not(button, label, a, input, summary)) {
      outline: 1px solid transparent;
    }
`;

render("cube-scene", function* () {
	yield (props: SceneProps) => html`
		<style>
			section {
			     --camera-perspective: ${props.perspective || "200000px"};
			     --camera-truck: ${props.truck || "0px"};
			     --camera-pedestal: ${props.pedestal || "0px"};
			     --camera-dolly: ${props.dolly || "0px"};

			     --camera-roll: ${props.roll || "0deg"};
			     --camera-pan: ${props.pan || "0deg"};
			     --camera-tilt: ${props.tilt || "0deg"};

			     ${calculateHiddenFaces(props)}
			  ${styles}

			  }
		</style>
		<section>
			<slot></slot>
		</section>
	`;
});
