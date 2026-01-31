import { render } from "../../../lib/src";
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

// export const Component = render(
// 	"props-component",
// 	function* (initialProps, ctx) {
// 		let count = 0;
// 		let base = 100;
// 		let direction = 1;
// 		let percentage = (count / base) * 100;
// 		let safeGuard = 100;

// 		const updateCount = () => {
// 			safeGuard--;
// 			count = count + 1 * direction;
// 			percentage = (count / base) * 100;
// 			ctx.update();
// 			if (count > base) {
// 				direction = -1;
// 			} else if (count <= 0) {
// 				direction = 1;
// 			}
// 			if (safeGuard) {
// 				requestAnimationFrame(updateCount);
// 			}
// 		};
// 		requestAnimationFrame(updateCount);

// 		console.log(initialProps, ctx);

// 		yield () => html`
// 			<style>
// 				:host {
// 					display: block;
// 				}

// 				div {
// 					height: 2rem;
// 					background: blue;
// 					width: var(--width);
// 				}
// 			</style>
// 			<h1>progress: ${Math.floor(percentage)}%</h1>
// 			${html`<div style="--width: ${Math.floor(percentage)}%"></div>`}
// 		`;
// 	},
// );

// export const Component = render(
// 	"props-component",
// 	function* (initialProps, ctx) {
// 		let seconds = 0;
// 		const interval = setInterval(() => {
// 			seconds++;
// 			ctx.update();
// 		}, 1000);

// 		console.log(initialProps, ctx);

// 		yield () => html`<p>${seconds} seconds</p>`;

// 		return () => {
// 			clearInterval(interval);
// 		};
// 	}
// );

// export const Component = render(
// 	"props-component",
// 	function* (initialProps, ctx) {
// 		let headingLevel = 1;

// 		const updateHeadingLevel = () => {
// 			headingLevel++;
// 			ctx.update();
// 		};

// 		console.log(initialProps, ctx);

// 		yield () =>
// 			html`
// 			<h${headingLevel} onclick=${updateHeadingLevel} data-${"test"}="${123}"> headingLevel: ${headingLevel} </h${headingLevel}>
// 			<${"input"} id="123" type=${"text"} />
// 			`;
// 	},
// );

//
