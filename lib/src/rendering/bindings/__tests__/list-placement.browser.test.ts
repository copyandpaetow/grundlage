import { describe, expect, test } from "vitest";
import { html, component } from "../../../index";

//every row's text is distinct, so the content-hash pass matches each row to its previous self and
//the rows re-inserted during an update are exactly the rows placement moved
describe("list placement moves the fewest rows", () => {
	let tagId = 0;
	const rowCount = 20;
	const inOrder = Array.from({ length: rowCount }, (_, index) => index);
	const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

	const define = (template: () => unknown) => {
		const tag = `test-list-placement-${tagId++}-${Date.now()}`;
		customElements.define(
			tag,
			component(function* () {
				yield template;
			}),
		);
		const element = document.createElement(tag);
		document.body.appendChild(element);
		return element as HTMLElement & { update: () => Promise<void> };
	};

	const mountRows = (order: () => Array<number | string>) =>
		define(
			() =>
				html`<ul>
					${order().map((row) => html`<li>row ${row}</li>`)}
				</ul>`,
		);

	const listItems = (element: HTMLElement) =>
		Array.from(element.shadowRoot!.querySelectorAll("li"));

	const countRowsReinsertedDuring = async (
		element: HTMLElement,
		change: () => Promise<void>,
	): Promise<number> => {
		const rowsBefore = new Set<Node>(listItems(element));
		const reinsertedRows = new Set<Node>();
		const collect = (records: Array<MutationRecord>) => {
			for (const record of records)
				for (const node of record.addedNodes)
					if (rowsBefore.has(node)) reinsertedRows.add(node);
		};
		const observer = new MutationObserver(collect);
		observer.observe(element.shadowRoot!, { childList: true, subtree: true });
		await change();
		collect(observer.takeRecords());
		observer.disconnect();
		return reinsertedRows.size;
	};

	const swapped = (first: number, second: number) => {
		const order = inOrder.slice();
		[order[first], order[second]] = [order[second], order[first]];
		return order;
	};

	test.each([
		{
			reorder: "swapping the second and the second-to-last row",
			reordered: swapped(1, rowCount - 2),
			fewestMoves: 2,
		},
		{
			reorder: "swapping the first and the last row",
			reordered: swapped(0, rowCount - 1),
			fewestMoves: 2,
		},
		{
			reorder: "moving the first row to the end",
			reordered: [...inOrder.slice(1), 0],
			fewestMoves: 1,
		},
		{
			reorder: "rotating by three",
			reordered: [...inOrder.slice(3), 0, 1, 2],
			fewestMoves: 3,
		},
		{
			reorder: "moving the last row to the front",
			reordered: [rowCount - 1, ...inOrder.slice(0, -1)],
			fewestMoves: 1,
		},
		{
			reorder: "reversing",
			reordered: inOrder.toReversed(),
			fewestMoves: rowCount - 1,
		},
	])(
		"$reorder moves $fewestMoves rows and keeps every node",
		async ({ reordered, fewestMoves }) => {
			let order = inOrder;
			const element = mountRows(() => order);
			await settle();
			const before = listItems(element);

			const moved = await countRowsReinsertedDuring(element, () => {
				order = reordered;
				return element.update();
			});

			expect(listItems(element).map((item) => before.indexOf(item))).toEqual(
				reordered,
			);
			expect(moved).toBe(fewestMoves);
			element.remove();
		},
	);

	test.each([
		{ change: "appending a row", changed: [...inOrder, "new"] },
		{ change: "prepending a row", changed: ["new", ...inOrder] },
		{
			change: "removing a middle row",
			changed: inOrder.filter((row) => row !== 10),
		},
	])("$change moves nothing", async ({ changed }) => {
		let order: Array<number | string> = inOrder;
		const element = mountRows(() => order);
		await settle();

		const moved = await countRowsReinsertedDuring(element, () => {
			order = changed;
			return element.update();
		});

		expect(listItems(element).map((item) => item.textContent)).toEqual(
			changed.map((row) => `row ${row}`),
		);
		expect(moved).toBe(0);
		element.remove();
	});

	test("a mounted row is not part of the order, so only the displaced row moves", async () => {
		let order: Array<number | string> = inOrder;
		const element = mountRows(() => order);
		await settle();
		const before = listItems(element);

		const moved = await countRowsReinsertedDuring(element, () => {
			order = ["new", ...inOrder.slice(1), 0];
			return element.update();
		});

		expect(listItems(element).map((item) => before.indexOf(item))).toEqual([
			-1,
			...inOrder.slice(1),
			0,
		]);
		expect(listItems(element)[0].textContent).toBe("row new");
		expect(moved).toBe(1);
		element.remove();
	});

	test("a removal does not count as displacement, so a swap beside it still moves two rows", async () => {
		let order = inOrder;
		const element = mountRows(() => order);
		await settle();
		const before = listItems(element);
		const reordered = swapped(1, rowCount - 2).filter((row) => row !== 10);

		const moved = await countRowsReinsertedDuring(element, () => {
			order = reordered;
			return element.update();
		});

		expect(listItems(element).map((item) => before.indexOf(item))).toEqual(
			reordered,
		);
		expect(moved).toBe(2);
		element.remove();
	});

	test("keyed rows matched across a content change move the fewest rows too", async () => {
		type Row = { id: number; text: string };
		let rows: Array<Row> = inOrder.map((id) => ({ id, text: `first ${id}` }));
		const element = define(
			() =>
				html`<ul>
					${rows.map(
						(row) =>
							html`<!--${row.id}-->
								<li>${row.text}</li>`,
					)}
				</ul>`,
		);
		await settle();
		const before = listItems(element);
		const reordered = swapped(0, rowCount - 1);

		const moved = await countRowsReinsertedDuring(element, () => {
			rows = reordered.map((id) => ({ id, text: `second ${id}` }));
			return element.update();
		});

		expect(listItems(element).map((item) => before.indexOf(item))).toEqual(
			reordered,
		);
		expect(listItems(element).map((item) => item.textContent)).toEqual(
			reordered.map((id) => `second ${id}`),
		);
		expect(moved).toBe(2);
		element.remove();
	});

	test("moving a row in front of rows that all look alike moves only that row", async () => {
		const lookAlikeRows = inOrder.slice(1).map(() => "alike");
		let order: Array<number | string> = [...lookAlikeRows, "unique"];
		const element = mountRows(() => order);
		await settle();
		const before = listItems(element);

		const moved = await countRowsReinsertedDuring(element, () => {
			order = ["unique", ...lookAlikeRows];
			return element.update();
		});

		expect(listItems(element)).toEqual([before.at(-1), ...before.slice(0, -1)]);
		expect(moved).toBe(1);
		element.remove();
	});

	test("rows whose content all changed are patched where they stand, even when the old content repeated", async () => {
		let order: Array<number | string> = inOrder.map((row) =>
			row % 2 === 0 ? "even" : "odd",
		);
		const element = mountRows(() => order);
		await settle();
		const before = listItems(element);

		const moved = await countRowsReinsertedDuring(element, () => {
			order = inOrder;
			return element.update();
		});

		expect(listItems(element)).toEqual(before);
		expect(listItems(element).map((item) => item.textContent)).toEqual(
			inOrder.map((row) => `row ${row}`),
		);
		expect(moved).toBe(0);
		element.remove();
	});

	test("a shuffle of many repeated rows moves every row with its own content, including hashes that probe past a used-up one", async () => {
		let randomState = 1;
		const nextRandom = () =>
			(randomState = (Math.imul(randomState, 1103515245) + 12345) >>> 0);
		//a row's hash is a constant plus its number, so consecutive numbers never collide in the
		//table; random ones do. 800 distinct values fill the 2048-entry table to 39%
		const distinctValues = Array.from({ length: 800 }, nextRandom);
		const repeatedRows = Array.from(
			{ length: 1000 },
			(_, index) => distinctValues[index % 800],
		);
		const shuffled = repeatedRows.slice();
		for (let index = shuffled.length - 1; index > 0; index--) {
			const other = nextRandom() % (index + 1);
			[shuffled[index], shuffled[other]] = [shuffled[other], shuffled[index]];
		}
		let order: Array<number> = repeatedRows;
		const element = mountRows(() => order);
		await settle();
		const textBefore = new Map(
			listItems(element).map((item) => [item, item.textContent]),
		);

		order = shuffled;
		await element.update();

		const rowsAfter = listItems(element);
		expect(rowsAfter.map((item) => item.textContent)).toEqual(
			shuffled.map((row) => `row ${row}`),
		);
		const rowsPatchedOrMounted = rowsAfter.filter(
			(item) => textBefore.get(item) !== item.textContent,
		);
		expect(rowsPatchedOrMounted).toEqual([]);
		element.remove();
	});

	test("a row that keeps its place keeps focus while rows around it move", async () => {
		let order = inOrder;
		const element = define(
			() =>
				html`<ul>
					${order.map((row) => html`<li>row ${row}<input /></li>`)}
				</ul>`,
		);
		await settle();
		const focusedInput = listItems(element)[10].querySelector("input")!;
		focusedInput.focus();
		expect(element.shadowRoot!.activeElement).toBe(focusedInput);

		order = swapped(1, rowCount - 2);
		await element.update();

		expect(element.shadowRoot!.activeElement).toBe(focusedInput);
		element.remove();
	});
});
