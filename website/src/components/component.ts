import { render } from "../../../lib/src";
import { css } from "../../../lib/src/rendering/parser-css";
import { html } from "../../../lib/src/rendering/parser-html";

const list = css`
	border: 1px solid black;

	li {
		list-style: none;
	}
`;

const style = css`
	* {
		margin: 0;
	}

	${list}

	.card {
		display: grid;
		gap: 1rem;
	}
`;

export const propsComponent = render("props-component", () => {
	const margin = 5;
	const padding = 10;

	return html`
		<section class="card">
			<h2>props</h2>
			<ul>
				<style>
					* {
						margin: ${margin}px;
						padding: ${padding}px;
					}
				</style>
				${style}
				<li class="class1 ${list} class3">complex attribute</li>
			</ul>
		</section>
	`;
});
