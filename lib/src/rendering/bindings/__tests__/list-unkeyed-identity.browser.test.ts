import { describe, expect, test } from "vitest";
import { html, component } from "../../../index";

//identical row content is the case where the content-hash pass has nothing to tell rows apart and
//there is no key to fall back on, so only position can keep a row's DOM with its index
describe("unkeyed lists of identical rows", () => {
	let tagId = 0;

	const mount = (texts: () => Array<string>) => {
		const tag = `test-unkeyed-identity-${tagId++}-${Date.now()}`;
		customElements.define(
			tag,
			component(function* () {
				yield () =>
					html`<ul>
						${texts().map((text) => html`<li>${text}<input /></li>`)}
					</ul>`;
			}),
		);
		const element = document.createElement(tag);
		document.body.appendChild(element);
		return element as HTMLElement & { update: () => Promise<void> };
	};

	const listItems = (element: HTMLElement) =>
		Array.from(element.shadowRoot!.querySelectorAll("li"));

	const inputValues = (element: HTMLElement) =>
		Array.from(element.shadowRoot!.querySelectorAll("input")).map(
			(input) => input.value,
		);

	test("editing the first row leaves the other rows' nodes untouched", async () => {
		let texts = ["same", "same", "same"];
		const element = mount(() => texts);
		await new Promise((resolve) => setTimeout(resolve, 0));

		const before = listItems(element);
		before[2].querySelector("input")!.value = "typed into the last row";

		texts = ["changed", "same", "same"];
		await element.update();

		const after = listItems(element);
		expect(after.map((item) => before.indexOf(item))).toEqual([0, 1, 2]);
		expect(inputValues(element)).toEqual(["", "", "typed into the last row"]);
		element.remove();
	});

	test("editing the last row leaves the other rows' nodes untouched", async () => {
		let texts = ["same", "same", "same"];
		const element = mount(() => texts);
		await new Promise((resolve) => setTimeout(resolve, 0));

		const before = listItems(element);
		before[0].querySelector("input")!.value = "typed into the first row";

		texts = ["same", "same", "changed"];
		await element.update();

		const after = listItems(element);
		expect(after.map((item) => before.indexOf(item))).toEqual([0, 1, 2]);
		expect(inputValues(element)).toEqual(["typed into the first row", "", ""]);
		element.remove();
	});

	test("shrinking a list of identical rows drops the last one", async () => {
		let texts = ["same", "same", "same"];
		const element = mount(() => texts);
		await new Promise((resolve) => setTimeout(resolve, 0));

		const before = listItems(element);
		before[0].querySelector("input")!.value = "first";

		texts = ["same", "same"];
		await element.update();

		const after = listItems(element);
		expect(after.map((item) => before.indexOf(item))).toEqual([0, 1]);
		expect(inputValues(element)).toEqual(["first", ""]);
		element.remove();
	});

	test("removing a middle row keeps the rows around it in place", async () => {
		let texts = ["a", "b", "c"];
		const element = mount(() => texts);
		await new Promise((resolve) => setTimeout(resolve, 0));

		const before = listItems(element);
		before[0].querySelector("input")!.value = "belongs to a";
		before[2].querySelector("input")!.value = "belongs to c";

		texts = ["a", "c"];
		await element.update();

		const after = listItems(element);
		expect(after.map((item) => before.indexOf(item))).toEqual([0, 2]);
		expect(inputValues(element)).toEqual(["belongs to a", "belongs to c"]);
		element.remove();
	});

	test("a reorder still moves rows rather than rewriting them", async () => {
		let texts = ["a", "b", "c"];
		const element = mount(() => texts);
		await new Promise((resolve) => setTimeout(resolve, 0));

		const before = listItems(element);
		before[0].querySelector("input")!.value = "belongs to a";

		texts = ["c", "b", "a"];
		await element.update();

		const after = listItems(element);
		expect(after.map((item) => before.indexOf(item))).toEqual([2, 1, 0]);
		expect(inputValues(element)).toEqual(["", "", "belongs to a"]);
		element.remove();
	});
});
