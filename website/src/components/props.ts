import { render } from "../../../lib/src";
import { html } from "../../../lib/src/template/html";

export interface TestProps {
	prop1: unknown;
	prop2: unknown;
}

export const propsComponent = render("props-component", (props: TestProps) => {
	console.log(props);

	return html`
		<section class="card">
			<h2>props</h2>
			<ul>
				<li data-${"test"}="${123}">${props.prop1}</li>
				<li><${props.tag}>dynamic tag here</${props.tag}></li>
				<li>${[1, 2, 3]}</li>
				<li ${{ key1: 1, key2: 2 }}>spread attributes</li>
			</ul>
		</section>
	`;
});
