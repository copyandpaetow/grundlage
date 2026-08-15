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

	//a value-hole style takes the css-plan path: mount bakes literal values into the
	//text, later updates go through the element's own CSSStyleSheet — never the text
	const ruleDeclarationOf = (style: HTMLStyleElement): CSSStyleDeclaration =>
		(style.sheet!.cssRules[0] as CSSStyleRule).style;

	//the browser-as-dom project runs this file under happy-dom, whose
	//getComputedStyle returns specified values instead of resolving them, so
	//computed-style assertions skip there and the chromium project carries them
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
		expect(normalizeWhitespace(styles[0].textContent)).toBe(
			"p { color: red; }",
		);
		expect(element.getAttribute("style")).toBeNull();

		cleanup(element);
	});

	test.skipIf(!resolvesComputedColors)(
		"a sheet update reaches the rendered pixels",
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
		const sheetTextNode = style.firstChild!;
		expect(normalizeWhitespace(style.textContent)).toBe("p { color: red; }");

		color = "blue";
		await element.update();
		await sleep();

		//the text keeps the mount values — the update lands on the sheet object
		expect(style.firstChild).toBe(sheetTextNode);
		expect(normalizeWhitespace(style.textContent)).toBe("p { color: red; }");
		expect(
			ruleDeclarationOf(style as HTMLStyleElement).getPropertyValue("color"),
		).toBe("blue");
		expect(element.getAttribute("style")).toBeNull();

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
		const declaration = ruleDeclarationOf(style as HTMLStyleElement);
		expect(declaration.getPropertyValue("color")).toBe("red");
		expect(declaration.getPropertyValue("font-size")).toBe("16px");

		color = "green";
		size = "20px";
		await element.update();
		await sleep();

		expect(declaration.getPropertyValue("color")).toBe("green");
		expect(declaration.getPropertyValue("font-size")).toBe("20px");

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
		const declaration = ruleDeclarationOf(style as HTMLStyleElement);
		expect(declaration.getPropertyValue("font-size")).toBe("16px");

		size = 24;
		await element.update();
		await sleep();

		expect(declaration.getPropertyValue("font-size")).toBe("24px");

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
		//the css path never writes the host, so nothing may re-fire the attribute
		//observer and grow the render count without bound
		await sleep(50);

		expect(renderCount).toBe(1);
		expect(element.getAttribute("style")).toBeNull();
		const style = element.shadowRoot!.querySelector("style")!;
		expect(normalizeWhitespace(style.textContent)).toBe("p { color: red; }");

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

		//same template, same host: each instance owns its own <style> and sheet, so
		//duplicates carry independent values by construction
		const styles = element.shadowRoot!.querySelectorAll("style");
		expect(styles).toHaveLength(2);
		expect(
			ruleDeclarationOf(styles[0] as HTMLStyleElement).getPropertyValue(
				"color",
			),
		).toBe("red");
		expect(
			ruleDeclarationOf(styles[1] as HTMLStyleElement).getPropertyValue(
				"color",
			),
		).toBe("blue");
		expect(element.getAttribute("style")).toBeNull();

		cleanup(element);
	});

	test("a root host style binding leaves the css fast path enabled", async () => {
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

		//values live on the instance's own sheet, so a host style attribute has
		//nothing to wipe — it coexists with the fast path
		const style = element.shadowRoot!.querySelector("style")!;
		expect(normalizeWhitespace(style.textContent)).toBe("p { color: red; }");
		expect(element.getAttribute("style")).toBe("outline: none");

		color = "blue";
		await element.update();
		await sleep();

		expect(normalizeWhitespace(style.textContent)).toBe("p { color: red; }");
		expect(
			ruleDeclarationOf(style as HTMLStyleElement).getPropertyValue("color"),
		).toBe("blue");
		expect(element.getAttribute("style")).toBe("outline: none");

		cleanup(element);
	});

	test.skipIf(!resolvesComputedColors)(
		"a css-wide keyword hole takes its normal effect",
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

			//the keyword is baked into the sheet as a literal declaration value, so the
			//paragraph gets `background-color: inherit` and inherits the host's green
			const paragraph = element.shadowRoot!.querySelector("p")!;
			expect(getComputedStyle(paragraph).backgroundColor).toBe(
				"rgb(0, 128, 0)",
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
		//markup must live in .content — the render/serialize surface — not in
		//light children, which never render and never serialize
		expect(template.childNodes.length).toBe(0);
		expect(
			normalizeWhitespace(template.content.querySelector("p")!.textContent),
		).toBe("first");

		//the template serializes from .content, so a round-trip must survive
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

	test("swapping away from a styled template leaves nothing behind", async () => {
		//values live on the instance's own sheet, which leaves with the instance's
		//nodes — a structural swap must strand nothing on the host
		const tag = uniqueTag();
		let showStyled = true;
		const color = "red";

		const MyElement = component(function* () {
			yield () =>
				showStyled
					? html`<style>
								p {
									color: ${color};
								}
							</style>
							<p>x</p>`
					: html`<div>plain</div>`;
		});

		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		const style = element.shadowRoot!.querySelector(
			"style",
		) as HTMLStyleElement;
		expect(normalizeWhitespace(style.textContent!)).toBe("p { color: red; }");

		showStyled = false;
		await element.update();
		await sleep();

		expect(element.shadowRoot!.querySelector("style")).toBeNull();
		expect(element.getAttribute("style")).toBeNull();

		cleanup(element);
	});

	test("a styled host keeps its live sheet value across a move", async () => {
		//moving the host disconnects+reconnects it, re-firing connectedCallback; the
		//<style> reparses from stale mount text, so the move refresh must restore the
		//value written to the sheet since mount — the color update is in a prior pass
		//so nothing re-sets it after the move
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

		const style = element.shadowRoot!.querySelector(
			"style",
		) as HTMLStyleElement;

		color = "blue";
		await element.update();
		await sleep();
		expect(ruleDeclarationOf(style).getPropertyValue("color")).toBe("blue");

		//a synchronous remove + append into a new parent re-fires connectedCallback
		//without a teardown; the sheet the browser mints is fresh from stale text
		const container = document.createElement("div");
		document.body.appendChild(container);
		container.appendChild(element);
		await sleep();

		expect(normalizeWhitespace(style.textContent!)).toBe("p { color: red; }");
		expect(ruleDeclarationOf(style).getPropertyValue("color")).toBe("blue");

		container.remove();
	});

	test("a styled list row keeps its live sheet value across a reorder", async () => {
		//a row move reinserts its <style>, minting a fresh sheet from stale text; the
		//reorder pass leaves the color unchanged, so no setProperty runs after the
		//move — only refreshStyleSheetsAfterMove can carry the live value across
		const tag = uniqueTag();
		type Row = { id: string; color: string };
		let items: Array<Row> = [
			{ id: "a", color: "red" },
			{ id: "b", color: "green" },
		];

		const MyElement = component(function* () {
			yield () =>
				html`<ul>
					${items.map(
						(row) =>
							html`<li key="${row.id}">
								<style>
									p {
										color: ${row.color};
									}
								</style>
								<p>${row.id}</p>
							</li>`,
					)}
				</ul>`;
		});

		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		const styleOf = (id: string) =>
			Array.from(element.shadowRoot!.querySelectorAll("li"))
				.find((li) => li.querySelector("p")!.textContent!.trim() === id)!
				.querySelector("style") as HTMLStyleElement;

		//update colors via the live sheet (setProperty), not the text
		items = [
			{ id: "a", color: "blue" },
			{ id: "b", color: "orange" },
		];
		await element.update();
		await sleep();
		expect(ruleDeclarationOf(styleOf("a")).getPropertyValue("color")).toBe(
			"blue",
		);

		//reorder only — colors unchanged, so the hash gate skips setProperty and the
		//moved row's fresh sheet is healed purely by the move refresh
		items = [
			{ id: "b", color: "orange" },
			{ id: "a", color: "blue" },
		];
		await element.update();
		await sleep();

		expect(ruleDeclarationOf(styleOf("a")).getPropertyValue("color")).toBe(
			"blue",
		);
		expect(ruleDeclarationOf(styleOf("b")).getPropertyValue("color")).toBe(
			"orange",
		);

		cleanup(element);
	});
});
