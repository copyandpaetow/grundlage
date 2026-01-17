import { render } from "../../../lib/src";
import { css } from "../../../lib/src/parser/parser-css";
import { html } from "../../../lib/src/parser/parser-html";

// const list = css`
// 	border: 1px solid black;

// 	li {
// 		list-style: none;
// 	}
// `;

// const style = css`
// 	* {
// 		margin: 0;
// 	}

// 	${list}

// 	.card {
// 		display: grid;
// 		gap: 1rem;
// 	}
// `;

export const Component = render(
	"props-component",
	function* (initialProps, ctx) {
		let seconds = 0;
		const interval = setInterval(() => {
			seconds++;
			ctx.update();
		}, 1000);

		console.log(initialProps, ctx);

		yield () => html`<p>${seconds} seconds</p>`;

		return () => {
			clearInterval(interval);
		};
	}
);
