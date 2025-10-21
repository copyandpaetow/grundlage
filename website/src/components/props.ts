import { render } from "../../../lib/src";
import { css } from "../../../lib/src/css/css";
import { html } from "../../../lib/src/html/html";
import { useState } from "../../../lib/src/state/state";

export interface TestProps {
	prop1: unknown;
	tag: unknown;
}

const list = css.rule`
	border: 1px solid black;

	li {
		list-style: none;
	}
`;

const style = css.stylesheet`
	* {
   margin: 0
 }

 .card {
    display: grid;
		gap: 1rem
 }

`;

export const propsComponent = render("props-component", (props: TestProps) => {
	const { setCount, count } = useState("count", 0);
	const { direction, setDirection } = useState("direction", 1);

	// setTimeout(() => {
	// 	setCount(count + direction);
	// 	if (count >= 75) {
	// 		setDirection(-1);
	// 	}
	// 	if (count <= 1) {
	// 		setDirection(1);
	// 	}
	// }, 10);

	const nestedHtml = html`<li>${123}</li>`;

	return html`
		<section class="card">
			<h2>props</h2>
			<ul>
				<li data-${"test"}="${123}">${props.prop1}</li>
				<li><${props.tag}>dynamic ${props.tag} tag here</${props.tag}></li>
				<li>${count}</li>
				<li style="width: ${Math.min(
					count,
					75
				)}%; background-color: red; text-wrap-mode: nowrap;">spread attributes</li>
				${nestedHtml}
			</ul>
		</section>
	`;
});
