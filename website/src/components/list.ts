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

type ListProps = {
	length: string;
};

export const Component = render(
	"list-component",
	function* (props: ListProps, ctx) {
		let entries = Array.from(
			{ length: parseInt(props.length || "10") },
			(_, index) => index * 10,
		);

		const shuffleEntries = () => {
			entries = entries
				.map((value) => ({ value, sort: Math.random() }))
				.sort((a, b) => a.sort - b.sort)
				.map(({ value }) => value);
			//	console.log(entries);
			ctx.update();
		};

		const addEntry = () => {
			entries.push(entries.reduce((a, b) => a + b));
			//	console.log(entries);
			ctx.update();
		};

		const deleteEntry = () => {
			const index = Math.floor(Math.random() * entries.length);
			entries.splice(index, 1);
			//console.log(entries);
			ctx.update();
		};

		const replaceEntry = () => {
			const index = Math.floor(Math.random() * entries.length);
			entries.splice(index, 1, entries[index] * -1);
			//console.log(index, entries);
			ctx.update();
		};

		const swap = () => {
			const index1 = Math.floor(Math.random() * entries.length);
			const index2 = Math.floor(Math.random() * entries.length);
			[entries[index1], entries[index2]] = [entries[index2], entries[index1]];
			//console.log(index, entries);
			ctx.update();
		};

		yield () => html`
			<menu>
				<button onclick="${addEntry}">add</button>
				<button onclick="${deleteEntry}">delete</button>
				<button onclick="${shuffleEntries}">shuffle</button>
				<button onclick="${replaceEntry}">replace</button>
				<button onclick="${swap}">swap 2</button>
			</menu>

			<ul>
				${entries.map((data) => html`<li data-key=${data}>${data}</li>`)}
			</ul>
		`;
	},
);
