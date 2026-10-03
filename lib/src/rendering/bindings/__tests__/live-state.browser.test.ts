import { describe, expect, test, vi } from "vitest";
import { html, component } from "../../../index";

const sleep = (duration = 0) =>
	new Promise((resolve) => setTimeout(resolve, duration));

describe("live state: value, checked, indeterminate, selected", () => {
	let tagId = 0;
	const uniqueTag = () => `test-live-state-${tagId++}-${Date.now()}`;

	const mount = (tag: string): HTMLElement => {
		const element = document.createElement(tag);
		document.body.appendChild(element);
		return element;
	};

	const inputOf = (element: HTMLElement): HTMLInputElement => {
		const input = element.shadowRoot?.querySelector("input");
		if (!(input instanceof HTMLInputElement)) throw new Error("no input");
		return input;
	};

	test("the first render sets the default, later renders drive what is shown", async () => {
		const tag = uniqueTag();
		let text = "initial";
		customElements.define(
			tag,
			component(function* () {
				yield () => html`<input value=${text} />`;
			}),
		);
		const element = mount(tag);
		await sleep();
		const input = inputOf(element);
		expect(input.getAttribute("value")).toBe("initial");
		expect(input.value).toBe("initial");

		text = "next";
		await (element as unknown as { update(): Promise<void> }).update();

		expect(input.value).toBe("next");
		expect(input.defaultValue).toBe("initial");
		element.remove();
	});

	test("a state change after the user typed replaces what the user typed", async () => {
		const tag = uniqueTag();
		let text = "initial";
		customElements.define(
			tag,
			component(function* () {
				yield () => html`<input value=${text} />`;
			}),
		);
		const element = mount(tag);
		await sleep();
		const input = inputOf(element);
		input.value = "typed by the user";

		text = "from state";
		await (element as unknown as { update(): Promise<void> }).update();

		expect(input.value).toBe("from state");
		element.remove();
	});

	test("an unchanged value does not overwrite what the user typed", async () => {
		const tag = uniqueTag();
		let unrelated = 0;
		customElements.define(
			tag,
			component(function* () {
				yield () =>
					html`<input value=${"initial"} />
						<p>${unrelated}</p>`;
			}),
		);
		const element = mount(tag);
		await sleep();
		const input = inputOf(element);
		input.value = "typed by the user";

		unrelated = 1;
		await (element as unknown as { update(): Promise<void> }).update();

		expect(input.value).toBe("typed by the user");
		element.remove();
	});

	test("absence empties what is shown and keeps the default", async () => {
		const tag = uniqueTag();
		let text: string | null = "initial";
		customElements.define(
			tag,
			component(function* () {
				yield () => html`<input value=${text} />`;
			}),
		);
		const element = mount(tag);
		await sleep();
		const input = inputOf(element);

		text = null;
		await (element as unknown as { update(): Promise<void> }).update();

		expect(input.value).toBe("");
		expect(input.getAttribute("value")).toBe("initial");
		element.remove();
	});

	test("form reset returns to the first rendered value", async () => {
		const tag = uniqueTag();
		let text = "initial";
		customElements.define(
			tag,
			component(function* () {
				yield () => html`<form><input value=${text} /></form>`;
			}),
		);
		const element = mount(tag);
		await sleep();
		const input = inputOf(element);

		text = "next";
		await (element as unknown as { update(): Promise<void> }).update();
		element.shadowRoot?.querySelector("form")?.reset();

		expect(input.value).toBe("initial");
		element.remove();
	});

	test("false unchecks a checkbox the user checked, and the default stays", async () => {
		const tag = uniqueTag();
		let isChecked = true;
		customElements.define(
			tag,
			component(function* () {
				yield () => html`<input type="checkbox" checked=${isChecked} />`;
			}),
		);
		const element = mount(tag);
		await sleep();
		const input = inputOf(element);
		expect(input.checked).toBe(true);

		isChecked = false;
		await (element as unknown as { update(): Promise<void> }).update();
		expect(input.checked).toBe(false);
		expect(input.defaultChecked).toBe(true);

		input.checked = false;
		isChecked = true;
		await (element as unknown as { update(): Promise<void> }).update();
		expect(input.checked).toBe(true);
		element.remove();
	});

	test("a spread drives what is shown after its first write", async () => {
		const tag = uniqueTag();
		let attributes: Record<string, unknown> = { value: "initial" };
		customElements.define(
			tag,
			component(function* () {
				yield () => html`<input ${attributes} />`;
			}),
		);
		const element = mount(tag);
		await sleep();
		const input = inputOf(element);
		input.value = "typed by the user";

		attributes = { value: "next" };
		await (element as unknown as { update(): Promise<void> }).update();

		expect(input.value).toBe("next");
		expect(input.getAttribute("value")).toBe("initial");
		element.remove();
	});

	test("a custom element's value stays an attribute on every render", async () => {
		const tag = uniqueTag();
		const childTag = `${uniqueTag()}-child`;
		customElements.define(childTag, class extends HTMLElement {});
		let text = "initial";
		customElements.define(
			tag,
			component(function* () {
				yield () => html`<${childTag} value=${text}></${childTag}>`;
			}),
		);
		const element = mount(tag);
		await sleep();

		text = "next";
		await (element as unknown as { update(): Promise<void> }).update();

		const child = element.shadowRoot?.querySelector(childTag);
		expect(child?.getAttribute("value")).toBe("next");
		element.remove();
	});

	test("a textarea's first render sets its text, the default it reads its value from", async () => {
		const tag = uniqueTag();
		let text = "initial";
		customElements.define(
			tag,
			component(function* () {
				yield () => html`<form><textarea value=${text}></textarea></form>`;
			}),
		);
		const element = mount(tag);
		await sleep();
		const textarea = element.shadowRoot?.querySelector("textarea");
		if (!(textarea instanceof HTMLTextAreaElement))
			throw new Error("no textarea");
		expect(textarea.value).toBe("initial");
		expect(textarea.hasAttribute("value")).toBe(false);

		text = "next";
		await (element as unknown as { update(): Promise<void> }).update();
		expect(textarea.value).toBe("next");
		expect(textarea.defaultValue).toBe("initial");

		element.shadowRoot?.querySelector("form")?.reset();
		expect(textarea.value).toBe("initial");
		element.remove();
	});

	test("a spread's first write sets a textarea's text", async () => {
		const tag = uniqueTag();
		customElements.define(
			tag,
			component(function* () {
				yield () => html`<textarea ${{ value: "initial" }}></textarea>`;
			}),
		);
		const element = mount(tag);
		await sleep();
		const textarea = element.shadowRoot?.querySelector("textarea");
		expect(textarea?.value).toBe("initial");
		element.remove();
	});

	test("selected on the options picks the first selection and follows later renders", async () => {
		const tag = uniqueTag();
		let chosen = "b";
		customElements.define(
			tag,
			component(function* () {
				yield () =>
					html`<select>
						${["a", "b", "c"].map(
							(option) =>
								html`<option value=${option} selected=${option === chosen}>
									${option}
								</option>`,
						)}
					</select>`;
			}),
		);
		const element = mount(tag);
		await sleep();
		const select = element.shadowRoot?.querySelector("select");
		if (!(select instanceof HTMLSelectElement)) throw new Error("no select");
		expect(select.value).toBe("b");

		select.options[0].selected = true;
		chosen = "c";
		await (element as unknown as { update(): Promise<void> }).update();
		expect(select.value).toBe("c");
		element.remove();
	});

	test("value on a select warns with the remedy", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const tag = uniqueTag();
		customElements.define(
			tag,
			component(function* () {
				yield () =>
					html`<select value=${"a"}>
						<option>a</option>
					</select>`;
			}),
		);
		const element = mount(tag);
		await sleep();

		expect(warn).toHaveBeenCalledWith(
			expect.stringContaining("<option selected="),
		);
		warn.mockRestore();
		element.remove();
	});
});
