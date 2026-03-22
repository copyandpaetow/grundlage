import { html, render } from "../../../lib/src";

const normalizeAngle = (raw: string) => ((parseFloat(raw) % 360) + 360) % 360;

const calculateHiddenFaces = (element: Element) => {
	const pan = normalizeAngle(element.getAttribute("pan") ?? "0deg");
	const tilt = normalizeAngle(element.getAttribute("tilt") ?? "0deg");

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

customElements.define(
	"cube-scene",
	render(function* (element) {
		yield () => html`
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
						--camera-perspective: ${element.getAttribute("perspective") ||
				"200000px"};
						--camera-truck: ${element.getAttribute("truck") || "0px"};
						--camera-pedestal: ${element.getAttribute("pedestal") || "0px"};
						--camera-dolly: ${element.getAttribute("dolly") || "0px"};

						--camera-roll: ${element.getAttribute("roll") || "0deg"};
						--camera-pan: ${element.getAttribute("pan") || "0deg"};
						--camera-tilt: ${element.getAttribute("tilt") || "0deg"};

						${calculateHiddenFaces(element)};
						${styles};
					}
				}
			</style>
			<section>
				<slot></slot>
			</section>
		`;
	}),
);
