import { html, render } from "../../../lib/src";

export const Component = render("raf-animation", function* (_, ctx) {
	let count = 0;
	let base = 100;
	let direction = 1;
	let percentage = (count / base) * 100;
	let safeGuard = 1000;

	const updateCount = () => {
		safeGuard--;
		count = count + 1 * direction;
		percentage = (count / base) * 100;
		ctx.update();
		if (count > base) {
			direction = -1;
		} else if (count <= 0) {
			direction = 1;
		}
		if (safeGuard) {
			requestAnimationFrame(updateCount);
		}
	};
	requestAnimationFrame(updateCount);

	yield () => html`
		<style>
			:host {
				display: block;
			}

			div {
				height: 2rem;
				background: blue;
				width: var(--width);
			}
		</style>
		<h1>progress: ${Math.floor(percentage)}%</h1>
		${html`<div style="--width: ${Math.floor(percentage)}%"></div>`}
	`;
});
