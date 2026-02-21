import { render, html } from "../../../lib/src";

type Props = { start: string };

export const Component = render(
	"simple-component",
	function* (initialProps: Props, ctx) {
		let seconds = parseInt(initialProps.start ?? "0");
		const interval = setInterval(() => {
			seconds++;
			ctx.update();
		}, 1000);

		yield () => html`<p>${seconds} seconds</p>`;

		return () => {
			clearInterval(interval);
		};
	},
);
