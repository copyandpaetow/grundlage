import { html, component } from "../../../../lib/src";
import {
	blockTransformFromProps,
	ghostProps,
	placementStyles,
	placementVariables,
} from "../scene-shared";

//`opacity` here would flatten the child's preserve-3d into a 2D silhouette, so the child
//inherits --block-opacity and its faces apply it one plane at a time

const ghostStyles = html`
	<style>
		:host {
			/* Cascades to the previewed child, so the preview can't be clicked. */
			pointer-events: none;
			--block-opacity: 0.45;
		}

		/* A flattening box here would collapse the child's preserve-3d. */
		slot {
			display: contents;
		}
	</style>
`;

customElements.define(
	"scene-ghost",
	component(
		function* () {
			yield function* view(props) {
				yield html`
					${placementStyles} ${ghostStyles}
					${placementVariables(blockTransformFromProps(props))}
					<slot></slot>
				`;
			};
		},
		{ props: ghostProps },
	),
);
