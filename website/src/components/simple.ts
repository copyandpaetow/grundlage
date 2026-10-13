import { component, html } from "../../../lib/src";

customElements.define(
	"simple-component",
	component(function* ({ host: element }) {
		let seconds = parseInt(element.getAttribute("start") ?? "0");
		const interval = setInterval(() => {
			seconds++;
			element.update();
		}, 1000);

		yield () => html`<p>${seconds} seconds</p>`;

		return () => {
			clearInterval(interval);
		};
	}),
);
