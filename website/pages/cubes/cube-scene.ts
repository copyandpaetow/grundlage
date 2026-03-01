import { html, render } from "../../../lib/src";

type SceneProps = {
	perspective?: string;
	truck?: string;
	pedestal?: string;
	dolly?: string;
	roll?: string;
	pan?: string;
	tilt?: string;
};

const normalizeAngle = (raw: string) => ((parseFloat(raw) % 360) + 360) % 360;

const calculateHiddenFaces = (props: SceneProps) => {
	const pan = normalizeAngle(props.pan ?? "0deg");
	const tilt = normalizeAngle(props.tilt ?? "0deg");

	console.log({ pan, tilt });

	const facingBack = pan > 90 && pan < 270;
	const flippedOver = tilt > 90 && tilt < 270;

	let style = "";

	style +=
		pan > 180 ? "\n--cube-render-left: none;" : "\n--cube-render-right: none;";
	style +=
		tilt < 180 ? "\n--cube-render-bottom: none;" : "\n--cube-render-top: none;";
	style +=
		facingBack === flippedOver
			? "\n--cube-render-back: none;"
			: "\n--cube-render-front: none;";
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
			position: relative;
   
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
			:host {
				display: block;
				contain: layout;
				container-type: size;
				container-name: scene;
				aspect-ratio: 1;

				::slotted(*) {
						height: 100cqh;
						width: 100cqw;
					}

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
			}
		</style>
		<section>
			<slot></slot>
		</section>
	`;
});
