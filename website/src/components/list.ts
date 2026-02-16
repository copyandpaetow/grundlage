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

export const Component = render("list-component", function* (_, ctx) {
	let entries = [10, 20, 30];

	const shuffleEntries = () => {
		entries = entries
			.map((value) => ({ value, sort: Math.random() }))
			.sort((a, b) => a.sort - b.sort)
			.map(({ value }) => value);
		ctx.update();
	};

	const addEntry = () => {
		entries.push(entries.reduce((a, b) => a + b));
		ctx.update();
	};

	const deleteEntry = () => {
		const index = Math.floor(Math.random() * entries.length);
		entries.splice(index, 1);

		ctx.update();
	};

	const replaceEntry = () => {
		const index = Math.floor(Math.random() * entries.length);
		entries.splice(index, 1, entries[index] * -1);
		console.log(index, entries);
		ctx.update();
	};

	yield () => html`
		<menu>
			<button onclick="${addEntry}">add</button>
			<button onclick="${deleteEntry}">delete</button>
			<button onclick="${shuffleEntries}">shuffle</button>
			<button onclick="${replaceEntry}">replace</button>
		</menu>

		<ul>
			${entries.map((data) => html`<li>${data}</li>`)}
		</ul>
	`;
});
