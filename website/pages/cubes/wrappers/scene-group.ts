import { html, component } from "../../../../lib/src";
import {
	blockTransformFromProps,
	carrierProps,
	placementStyles,
	placementVariables,
} from "../scene-shared";

// The geometries' authoring contract minus `size`, which would distort the children, so
// the editor drags a group with a cube's code path

const groupStyles = html`
	<style>
		/* A flattening box here would collapse the children's preserve-3d. */
		slot {
			display: contents;
		}
	</style>
`;

customElements.define(
	"scene-group",
	component(
		function* () {
			yield function* view(props) {
				yield html`
					${placementStyles} ${groupStyles}
					${placementVariables(blockTransformFromProps(props))}
					<slot></slot>
				`;
			};
		},
		{ props: carrierProps },
	),
);
