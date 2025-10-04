import { render, useState } from "../../../lib/src";
import { css } from "../../../lib/src/css/css";
import { html } from "../../../lib/src/html/html";

export interface TestProps {
	prop1: unknown;
	prop2: unknown;
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
	console.log(props);
	const { setCount, count } = useState("count", 0);

	// setTimeout(() => {
	// 	setCount(count + 1);
	// }, 5000);

	return html`
		<section class="card">
			<h2>props</h2>
			<ul>
				<li data-${"test"}="${123}">${props.prop1}</li>
				<li><${props.tag}>dynamic tag here</${props.tag}></li>
				<li>${count}</li>
				<li>spread attributes</li>
			</ul>
		</section>
	`;
});
