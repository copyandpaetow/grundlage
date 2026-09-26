import { describe, expect, test } from "vitest";
import { html, component } from "../../../index";
import { getParsedTemplate } from "../../../parser/html";
import { coerceToTemplate } from "../../../template";
import { combinedPartsHash } from "../../compose";

const sleep = (duration = 0) =>
	new Promise((resolve) => setTimeout(resolve, duration));

//content values are chosen distinct so the exact-content-hash pass never claims a row;
//this isolates the key match path (reorder/insert/remove tracked by key, not content)
describe("keyed lists (dynamic-comment escape hatch)", () => {
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
		const Element = component(function* () {
			yield () =>
				html`<ul>
					${read().map(
						(row) =>
							html`<!--${row.id}-->
								<li>${row.text}</li>`,
					)}
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

	test("a row that keeps its key and changes template is rebuilt in place", async () => {
		type EditableRow = Row & { isEditing: boolean };
		let items: Array<EditableRow> = [
			{ id: "a", text: "alpha", isEditing: false },
			{ id: "b", text: "bravo", isEditing: false },
			{ id: "c", text: "charlie", isEditing: false },
		];
		const tag = uniqueTag();
		const Element = component(function* () {
			yield () =>
				html`<ul>
					${items.map((row) =>
						row.isEditing
							? html`<!--${row.id}-->
									<li><input value=${row.text} /></li>`
							: html`<!--${row.id}-->
									<li>${row.text}</li>`,
					)}
				</ul>`;
		});
		customElements.define(tag, Element);
		const element = mount(tag);
		await sleep();

		const [aNode, bNode, cNode] = rows(element);

		items = items.map((row) =>
			row.id === "b" ? { ...row, isEditing: true } : row,
		);
		await update(element);
		await sleep();

		const editing = rows(element);
		expect(editing.length).toBe(3);
		expect([editing[0], editing[2]]).toEqual([aNode, cNode]);
		expect(editing[1]).not.toBe(bNode);
		expect(editing[1].querySelector("input")?.value).toBe("bravo");

		items = items.map((row) => ({ ...row, isEditing: false }));
		await update(element);
		await sleep();

		const settled = rows(element);
		expect(settled.length).toBe(3);
		expect(settled[1].querySelector("input")).toBe(null);
		expect(texts(settled)).toEqual(["alpha", "bravo", "charlie"]);

		cleanup(element);
	});

	describe("a key keeps its row whatever it hashes to", () => {
		const viewRow = (id: number) =>
			html`<!--${id}-->
				<li>view ${id}</li>`;
		const editRow = (id: number) =>
			html`<!--${id}-->
				<li><input value=${id} /></li>`;
		const keyHashOf = (row: unknown) => {
			const value = coerceToTemplate(row);
			return combinedPartsHash(
				getParsedTemplate(value.__templateStrings).keyValueParts!,
				value.values,
			);
		};
		//an integer key enters the key hash as a plain addend, so negating the hash of key 0 lands on 0
		const keyHashingToZero = -keyHashOf(viewRow(0)) | 0;

		const endMarkerOfRow = (item: Element): Node => {
			let current = item.nextSibling;
			while (current !== null && current.nodeType !== Node.COMMENT_NODE)
				current = current.nextSibling;
			return current!;
		};

		test("the zero key hashes to 0 in both row templates", () => {
			expect(keyHashOf(viewRow(keyHashingToZero))).toBe(0);
			expect(keyHashOf(editRow(keyHashingToZero))).toBe(0);
		});

		test.each([
			{ key: "an ordinary key", id: 7 },
			{ key: "the zero key", id: keyHashingToZero },
		])(
			"$key is rebuilt inside its own row when the row changes template",
			async ({ id }) => {
				let editedId: number | null = null;
				const tag = uniqueTag();
				customElements.define(
					tag,
					component(function* () {
						yield () =>
							html`<ul>
								${[1, id, 2].map((rowId) =>
									rowId === editedId ? editRow(rowId) : viewRow(rowId),
								)}
							</ul>`;
					}),
				);
				const element = mount(tag);
				await sleep();
				const [, viewItem] = rows(element);
				const endMarker = endMarkerOfRow(viewItem);

				editedId = id;
				await update(element);

				const [, editItem] = rows(element);
				expect(editItem).not.toBe(viewItem);
				expect(editItem.querySelector("input")?.value).toBe(String(id));
				expect(endMarkerOfRow(editItem)).toBe(endMarker);
				cleanup(element);
			},
		);
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
