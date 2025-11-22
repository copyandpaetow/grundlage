import { render } from "../../../lib/src";
import { css } from "../../../lib/src/rendering/parser-css";
import { html } from "../../../lib/src/rendering/parser-html";
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

 ${list}

 .card {
    display: grid;
		gap: 1rem
 }

`;

export const propsComponent = render("props-component", (props: TestProps) => {
	const { setCount, count } = useState("count", 0);
	const { direction, setDirection } = useState("direction", 1);
	const { once, setOnce } = useState("once", false);

	// setTimeout(() => {
	// 	setCount(count + direction);
	// 	if (count >= 75) {
	// 		setDirection(-1);
	// 	}
	// 	if (count <= 1) {
	// 		setDirection(1);
	// 	}
	// }, 10);

	// if (!once) {
	// 	setTimeout(() => {
	// 		setCount(count + 33);
	// 		setOnce(true);
	// 	}, 100);
	// }

	return html`
		<section class="card">
			<h2>props</h2>
			<ul>
				${style}
				<li class="class1 ${list} class3">complex attribute</li>
			</ul>
		</section>
	`;
});

/*
		<section class="card">
			<h2>props</h2>
			<ul>
				<li data-${"test"}="${123}">${props.prop1}</li>
				<li><${props.tag} data-test="${123}" static-tag="class" disabled>dynamic ${
		props.tag
	} tag here</${props.tag}></li>
				<li>${count}</li>
				<li style="width: ${Math.min(
					count,
					75
				)}%; background-color: red; text-wrap-mode: nowrap;">spread attributes</li>
				${nestedHtml}
			</ul>
		</section>

*/
