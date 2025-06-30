import { render } from "../../../lib/src";
import { Signal } from "../../../lib/src/context/signal";
import { html } from "../../../lib/src/template/html";

export interface TestProps {
	stringSignal: Signal<string>;
	externalSignal: Signal<number>;
	array: Array<number>;
	nestedObj: Record<string, string>;
}

export const propsComponent = render("props-component", (props: TestProps) => {
	console.log(props);

	return html`
		<section class="card">
			<h2>attributes</h2>
			<ul>
				<li test=${null}>null</li>
				<li .test=${2}>property</li>
				<li>3</li>
				<li>4</li>
			</ul>
			<h2>props</h2>
			<ul>
				<li>${props.stringSignal}</li>
				<li>${props.externalSignal}</li>
				<li>${props.array}</li>
				<li>${props.nestedObj}</li>
			</ul>
		</section>
	`;
});
