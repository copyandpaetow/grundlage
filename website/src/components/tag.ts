import { html, props, component } from "../../../lib/src";

customElements.define(
	"tag-component",
	component(function* (element) {
		let { headingLevel } = props(element, { headingLevel: Number });
		let previous = headingLevel;

		const updateHeadingLevel = () => {
			previous = headingLevel;
			headingLevel++;
			element.update();
		};

		yield () =>
			html`
                <!-- ${headingLevel} and ${previous}  -->
                <h${headingLevel} onclick=${updateHeadingLevel}> headingLevel: ${headingLevel}</h${headingLevel}>
            `;
	}),
);
