import { describe, expect, test } from "vitest";
import { html, component } from "../../../index";

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

	//a value-hole style takes the css-plan path: the static sheet holds var(--name)
	//and the values live as custom properties on the host's inline style
	const varNameOf = (style: HTMLStyleElement): string =>
		style.textContent!.match(/var\((--[^)]+)\)/)![1];

	// the browser-as-dom project runs this file under happy-dom, whose
	// getComputedStyle returns specified values instead of resolving them, so
	// computed-style assertions skip there and the chromium project carries them
	const detectComputedColorResolution = () => {
		const probe = document.createElement("div");
		probe.style.color = "red";
		document.body.appendChild(probe);
		const resolved = getComputedStyle(probe).color === "rgb(255, 0, 0)";
		probe.remove();
		return resolved;
	};
	const resolvesComputedColors = detectComputedColorResolution();

	test("renders dynamic content inside a style element", async () => {
		const tag = uniqueTag();
		let color = "red";

		const MyElement = component(function* () {
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

		const styles = element.shadowRoot!.querySelectorAll("style");
		expect(styles).toHaveLength(1);
		const name = varNameOf(styles[0] as HTMLStyleElement);
		expect(normalizeWhitespace(styles[0].textContent)).toBe(
			`p { color:var(${name}); }`,
		);
		expect(element.style.getPropertyValue(name).trim()).toBe("red");

		cleanup(element);
	});

	test.skipIf(!resolvesComputedColors)(
		"the var() chain resolves through the shadow boundary",
		async () => {
			const tag = uniqueTag();
			let color = "red";

			const MyElement = component(function* () {
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

			const paragraph = element.shadowRoot!.querySelector("p")!;
			expect(getComputedStyle(paragraph).color).toBe("rgb(255, 0, 0)");

			color = "blue";
			await element.update();
			await sleep();

			expect(getComputedStyle(paragraph).color).toBe("rgb(0, 0, 255)");

			cleanup(element);
		},
	);

	test("updates dynamic content inside a style element", async () => {
		const tag = uniqueTag();
		let color = "red";

		const MyElement = component(function* () {
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

		const style = element.shadowRoot!.querySelector("style")!;
		const name = varNameOf(style as HTMLStyleElement);
		const sheetTextNode = style.firstChild!;
		expect(element.style.getPropertyValue(name).trim()).toBe("red");

		color = "blue";
		await element.update();
		await sleep();

		expect(style.firstChild).toBe(sheetTextNode);
		expect(element.style.getPropertyValue(name).trim()).toBe("blue");

		cleanup(element);
	});

	test("renders dynamic content inside a textarea element", async () => {
		const tag = uniqueTag();
		let content = "initial text";

		const MyElement = component(function* () {
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

		const MyElement = component(function* () {
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

		const style = element.shadowRoot!.querySelector("style")!;
		const names = [...style.textContent!.matchAll(/var\((--[^)]+)\)/g)].map(
			(match) => match[1],
		);
		expect(names).toHaveLength(2);
		expect(element.style.getPropertyValue(names[0]).trim()).toBe("red");
		expect(element.style.getPropertyValue(names[1]).trim()).toBe("16px");

		color = "green";
		size = "20px";
		await element.update();
		await sleep();

		expect(element.style.getPropertyValue(names[0]).trim()).toBe("green");
		expect(element.style.getPropertyValue(names[1]).trim()).toBe("20px");

		cleanup(element);
	});

	test("does not parse HTML inside raw content elements", async () => {
		const tag = uniqueTag();
		const injection = "<script>alert('xss')</script>";

		const MyElement = component(function* () {
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

		const MyElement = component(function* () {
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

		const MyElement = component(function* () {
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

		const style = element.shadowRoot!.querySelector("style")!;
		const name = varNameOf(style as HTMLStyleElement);
		expect(element.style.getPropertyValue(name).trim()).toBe("16px");

		size = 24;
		await element.update();
		await sleep();

		expect(element.style.getPropertyValue(name).trim()).toBe("24px");

		cleanup(element);
	});

	test("a nested-template style does not re-trigger the host attribute observer", async () => {
		const tag = uniqueTag();
		const color = "red";
		let renderCount = 0;

		const MyElement = component(function* () {
			yield () => {
				renderCount++;
				return html`<div>
					${html`<style>
							p {
								color: ${color};
							}
						</style>
						<p>text</p>`}
				</div>`;
			};
		});

		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		//the host-prop write lands on the host's style attribute; a leaked observer
		//record would re-fire update() and grow the count without bound
		await sleep(50);

		expect(renderCount).toBe(1);
		const name = varNameOf(element.shadowRoot!.querySelector("style")!);
		expect(element.style.getPropertyValue(name).trim()).toBe("red");

		cleanup(element);
	});

	test("one styled helper rendered twice in a component keeps both colors", async () => {
		const tag = uniqueTag();
		const badge = (color: string) =>
			html`<style>
					.b {
						color: ${color};
					}
				</style>
				<span class="b">x</span>`;

		const MyElement = component(function* () {
			yield () =>
				html`<div>${badge("red")}</div>
					<div>${badge("blue")}</div>`;
		});

		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		//same template, same host: the second mount takes instance-suffixed names, so
		//the two instances drive disjoint custom properties instead of colliding
		const styles = element.shadowRoot!.querySelectorAll("style");
		expect(styles).toHaveLength(2);
		const firstName = varNameOf(styles[0] as HTMLStyleElement);
		const secondName = varNameOf(styles[1] as HTMLStyleElement);
		expect(firstName).not.toBe(secondName);
		expect(element.style.getPropertyValue(firstName).trim()).toBe("red");
		expect(element.style.getPropertyValue(secondName).trim()).toBe("blue");

		cleanup(element);
	});

	test("a root host style binding falls back every style under the host — nested included", async () => {
		const tag = uniqueTag();
		let color = "red";

		const MyElement = component(function* () {
			yield () =>
				html`<template style="outline: none"
					><div>
						${html`<style>
								p {
									color: ${color};
								}
							</style>
							<p>text</p>`}
					</div></template
				>`;
		});

		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		//the host style attribute is written wholesale and would wipe custom
		//properties, so the nested style keeps the composed-text path
		const style = element.shadowRoot!.querySelector("style")!;
		expect(style.textContent).not.toContain("var(");
		expect(normalizeWhitespace(style.textContent)).toBe("p { color: red; }");
		expect(element.getAttribute("style")).toBe("outline: none");

		color = "blue";
		await element.update();
		await sleep();

		expect(normalizeWhitespace(style.textContent)).toBe("p { color: blue; }");
		expect(element.getAttribute("style")).toBe("outline: none");

		cleanup(element);
	});

	test.skipIf(!resolvesComputedColors)(
		"a css-wide keyword hole computes as unset, not the keyword",
		async () => {
			const tag = uniqueTag();
			const backgroundValue = "inherit";

			const MyElement = component(function* () {
				yield () =>
					html`<style>
							p {
								background-color: ${backgroundValue};
							}
						</style>
						<p>text</p>`;
			});

			customElements.define(tag, MyElement);
			const element = mount(tag) as InstanceType<typeof MyElement>;
			element.style.backgroundColor = "rgb(0, 128, 0)";
			await sleep();

			//documented narrowing: the keyword goes invalid-at-computed-value-time
			//inside the custom property, so the declaration behaves as unset (initial
			//here), not as a real `background-color: inherit` (which would be green)
			const paragraph = element.shadowRoot!.querySelector("p")!;
			expect(getComputedStyle(paragraph).backgroundColor).toBe(
				"rgba(0, 0, 0, 0)",
			);

			cleanup(element);
		},
	);

	test("nested template hole populates .content as markup, not light children", async () => {
		const tag = uniqueTag();
		let label = "first";

		const MyElement = component(function* () {
			yield () =>
				html`<div>
					<template><p>${label}</p></template>
				</div>`;
		});

		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		const template =
			element.shadowRoot!.querySelector<HTMLTemplateElement>("template")!;
		// Markup must live in .content — the render/serialize surface — not in
		// light children, which never render and never serialize.
		expect(template.childNodes.length).toBe(0);
		expect(
			normalizeWhitespace(template.content.querySelector("p")!.textContent),
		).toBe("first");

		// The template serializes from .content, so a round-trip must survive.
		expect(template.outerHTML).toContain("<p>first</p>");

		label = "second";
		await element.update();
		await sleep();

		expect(
			normalizeWhitespace(template.content.querySelector("p")!.textContent),
		).toBe("second");
		expect(template.childNodes.length).toBe(0);

		cleanup(element);
	});
});
