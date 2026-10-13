import { html, component } from "../../../lib/src";

customElements.define(
	"tag-component",
	component(
		function* ({ host, headingLevel }) {
			//a seed: the generator runs once, and the local is what the click advances
			let level = headingLevel;
			let previous = level;

			const updateHeadingLevel = () => {
				previous = level;
				level++;
				host.update();
			};

			yield () =>
				html`
                <!-- ${level} and ${previous}  -->
                <h${level} onclick=${updateHeadingLevel}> headingLevel: ${level}</h${level}>
            `;
		},
		{ props: { headingLevel: [Number, 1] } },
	),
);
