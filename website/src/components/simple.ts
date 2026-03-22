import { render, html } from "../../../lib/src";

customElements.define(
	"simple-component",
	render(function* (element) {
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
