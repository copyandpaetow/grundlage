import { render } from "../../../lib/src";
import { css } from "../../../lib/src/css/css";
import { html } from "../../../lib/src/html";

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

	return html`
		${style}
		<section class="card">
			<h2>props</h2>
			<for-each list=${[10, 20, 30, 40]}
					<div>${(num) => num}</div>
			</for-each>
			<ul class=${list}>
				<li data-${"test"}="${123}">${props.prop1}</li>
				<li><${props.tag}>dynamic tag here</${props.tag}></li>
				<li>${[1, 2, 3]}</li>
				<li ${{ key1: 1, key2: 2 }}>spread attributes</li>
			</ul>
		</section>
	`;
});
