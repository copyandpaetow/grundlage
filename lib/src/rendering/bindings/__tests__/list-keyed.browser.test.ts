import { describe, expect, test } from "vitest";
import { html, render } from "../../../index";

const sleep = (duration = 0) =>
	new Promise((resolve) => setTimeout(resolve, duration));

//content values are chosen distinct so the exact-content-hash pass never claims a row;
//this isolates the key= match path (reorder/insert/remove tracked by key, not content)
describe("keyed lists (key= escape hatch)", () => {
	let tagId = 0;
	const uniqueTag = () => `test-keyed-${tagId++}-${Date.now()}`;

	const mount = (tag: string): HTMLElement => {
		const element = document.createElement(tag);
		document.body.appendChild(element);
		return element;
	};

	const cleanup = (element: HTMLElement) => element.remove();

	type Row = { id: string; text: string };

	const define = (read: () => Array<Row>) => {
		const tag = uniqueTag();
		const Element = render(function* () {
			yield () =>
				html`<ul>
					${read().map((row) => html`<li key="${row.id}">${row.text}</li>`)}
				</ul>`;
		});
		customElements.define(tag, Element);
		return tag;
	};

	const update = (element: HTMLElement) =>
		(element as HTMLElement & { update: () => Promise<void> }).update();

	const rows = (element: HTMLElement) =>
		Array.from(element.shadowRoot!.querySelectorAll("li"));

	const texts = (list: Array<Element>) =>
		list.map((li) => li.textContent?.trim());

	test("a key preserves a row's node across a reorder that also changes its content", async () => {
		let items: Array<Row> = [
			{ id: "a", text: "alpha" },
			{ id: "b", text: "bravo" },
			{ id: "c", text: "charlie" },
		];
		const element = mount(define(() => items));
		await sleep();

		const [aNode, bNode, cNode] = rows(element);

		items = [
			{ id: "c", text: "Charlie-2" },
			{ id: "a", text: "Alpha-2" },
			{ id: "b", text: "Bravo-2" },
		];
		await update(element);
		await sleep();

		const reordered = rows(element);
		expect(reordered).toEqual([cNode, aNode, bNode]);
		expect(texts(reordered)).toEqual(["Charlie-2", "Alpha-2", "Bravo-2"]);

		cleanup(element);
	});

	test("inserting a new key keeps existing keyed nodes even as their content changes", async () => {
		let items: Array<Row> = [
			{ id: "a", text: "alpha" },
			{ id: "b", text: "bravo" },
		];
		const element = mount(define(() => items));
		await sleep();

		const [aNode, bNode] = rows(element);

		items = [
			{ id: "a", text: "Alpha-2" },
			{ id: "z", text: "zulu" },
			{ id: "b", text: "Bravo-2" },
		];
		await update(element);
		await sleep();

		const after = rows(element);
		expect(after[0]).toBe(aNode);
		expect(after[2]).toBe(bNode);
		expect(after[1]).not.toBe(aNode);
		expect(after[1]).not.toBe(bNode);
		expect(texts(after)).toEqual(["Alpha-2", "zulu", "Bravo-2"]);

		cleanup(element);
	});

	test("removing a key drops only that node; survivors keep identity through content changes", async () => {
		let items: Array<Row> = [
			{ id: "a", text: "alpha" },
			{ id: "b", text: "bravo" },
			{ id: "c", text: "charlie" },
		];
		const element = mount(define(() => items));
		await sleep();

		const [aNode, , cNode] = rows(element);

		items = [
			{ id: "a", text: "Alpha-2" },
			{ id: "c", text: "Charlie-2" },
		];
		await update(element);
		await sleep();

		const after = rows(element);
		expect(after).toEqual([aNode, cNode]);
		expect(texts(after)).toEqual(["Alpha-2", "Charlie-2"]);

		cleanup(element);
	});
});
