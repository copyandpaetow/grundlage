import { render, html } from "../../../lib/src";

export const Component = render(
	"heading-component",
	function* (initialProps: { heading: string }, ctx) {
		let headingLevel = parseInt(initialProps.heading ?? "2");

		const updateHeadingLevel = () => {
			headingLevel++;
			ctx.update();
		};

		yield () =>
			html`
			<h${headingLevel} onclick=${updateHeadingLevel}> headingLevel: ${headingLevel} </h${headingLevel}>
			`;
	},
);
