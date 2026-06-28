import { describe, expect, test } from "vitest";
import { html, render } from "../../index";

const normalizeWhitespace = (string: string) =>
	string.replace(/\s+/g, " ").trim();

const sleep = (duration = 0) =>
	new Promise((resolve) => setTimeout(resolve, duration));

describe("raw content updates", () => {
	let tagId = 0;
	const uniqueTag = () => `test-raw-${tagId++}-${Date.now()}`;

	const mount = (tag: string): HTMLElement => {
		const element = document.createElement(tag);
		document.body.appendChild(element);
		return element;
	};

	const cleanup = (element: HTMLElement) => {
		element.remove();
	};

	test("renders dynamic content inside a style element", async () => {
		const tag = uniqueTag();
		let color = "red";

		const MyElement = render(function* () {
			yield () =>
				html`<style>
						p {
							color: ${color};
						}
					</style>
					<p>text</p>`;
		});

		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		const style = element.shadowRoot?.querySelector("style")!;
		expect(normalizeWhitespace(style.textContent)).toBe("p { color: red; }");

		cleanup(element);
	});

	test("updates dynamic content inside a style element", async () => {
		const tag = uniqueTag();
		let color = "red";

		const MyElement = render(function* () {
			yield () =>
				html`<style>
						p {
							color: ${color};
						}
					</style>
					<p>text</p>`;
		});

		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		const style = element.shadowRoot?.querySelector("style")!;
		expect(normalizeWhitespace(style.textContent)).toBe("p { color: red; }");

		color = "blue";
		await element.update();
		await sleep();

		expect(normalizeWhitespace(style.textContent)).toBe("p { color: blue; }");

		cleanup(element);
	});

	test("renders dynamic content inside a textarea element", async () => {
		const tag = uniqueTag();
		let content = "initial text";

		const MyElement = render(function* () {
			yield () => html`<textarea>${content}</textarea>`;
		});

		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		const textarea = element.shadowRoot?.querySelector("textarea")!;
		expect(normalizeWhitespace(textarea.textContent)).toBe("initial text");

		content = "updated text";
		await element.update();
		await sleep();

		expect(normalizeWhitespace(textarea.textContent)).toBe("updated text");

		cleanup(element);
	});

	test("renders multiple dynamic expressions in a style element", async () => {
		const tag = uniqueTag();
		let color = "red";
		let size = "16px";

		const MyElement = render(function* () {
			yield () =>
				html`<style>
						p {
							color: ${color};
							font-size: ${size};
						}
					</style>
					<p>text</p>`;
		});

		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		const style = element.shadowRoot?.querySelector("style")!;
		expect(normalizeWhitespace(style.textContent)).toBe(
			"p { color: red; font-size: 16px; }",
		);

		color = "green";
		size = "20px";
		await element.update();
		await sleep();

		expect(normalizeWhitespace(style.textContent)).toBe(
			"p { color: green; font-size: 20px; }",
		);

		cleanup(element);
	});

	test("does not parse HTML inside raw content elements", async () => {
		const tag = uniqueTag();
		const injection = "<script>alert('xss')</script>";

		const MyElement = render(function* () {
			yield () =>
				html`<style>
					${injection}
				</style>`;
		});

		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		const style = element.shadowRoot?.querySelector("style")!;
		expect(normalizeWhitespace(style.textContent)).toBe(
			"<script>alert('xss')</script>",
		);
		expect(element.shadowRoot?.querySelector("script")).toBeNull();

		cleanup(element);
	});

	test("does not update when raw content value is unchanged", async () => {
		const tag = uniqueTag();
		const css = "p { color: red; }";

		const MyElement = render(function* () {
			yield () =>
				html`<style>
						${css}
					</style>
					<p>text</p>`;
		});

		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		const style = element.shadowRoot?.querySelector("style")!;
		const originalText = style.textContent;

		await element.update();
		await sleep();

		expect(style.textContent).toBe(originalText);

		cleanup(element);
	});

	test("handles numeric values in raw content", async () => {
		const tag = uniqueTag();
		let size = 16;

		const MyElement = render(function* () {
			yield () =>
				html`<style>
					p {
						font-size: ${size}px;
					}
				</style>`;
		});

		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		const style = element.shadowRoot?.querySelector("style")!;
		expect(normalizeWhitespace(style.textContent)).toBe(
			"p { font-size: 16px; }",
		);

		size = 24;
		await element.update();
		await sleep();

		expect(normalizeWhitespace(style.textContent)).toBe(
			"p { font-size: 24px; }",
		);

		cleanup(element);
	});
});
