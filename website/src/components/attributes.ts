import { html, render } from "../../../lib/src";
import { type ComponentConstructor } from "../../../lib/src/types";

let attrs = ["disabled", "hidden"];

const component = render(function* (element) {
	let attr = "data-name";

	const updateAttr = () => {
		attr = "data-type";
		element.update();
	};

	yield () => html`
		<button ${attrs}>click</button>
		<p>attributes are</p>
		<ul>
			${attrs.map((item) => html` <li>${item}</li>`)}
		</ul>
		<div ${attr}="hello">test dynamic attributes</div>
		<button onclick="${updateAttr}">update attribute</button>
	`;
}) as ComponentConstructor;

customElements.define("attribute-component", component);

declare global {
	interface HTMLElementTagNameMap {
		"attribute-component": InstanceType<typeof component>;
	}
}
