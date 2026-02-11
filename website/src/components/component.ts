import { render, html } from "../../../lib/src";

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
		console.log(initialProps, ctx);
		let entries = [10, 20, 30];

		const add = () => {
			entries.push(entries.reduce((a, b) => a + b));
			entries = entries
				.map((value) => ({ value, sort: Math.random() }))
				.sort((a, b) => a.sort - b.sort)
				.map(({ value }) => value);
			console.log(entries);
			ctx.update();
		};

		yield () => html`
			<ul>
				${entries.map((data) => html`<li>${data}</li>`)}
			</ul>

			<${"button"} onclick="${add}">length: ${entries.length}</${"button"}>
		`;
	},
);
