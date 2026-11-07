import { describe, expect, test, vi } from "vitest";
import { component, html, prop } from "../index";
import { BaseComponent } from "../types";

let tagIndex = 0;
const uniqueTag = () => `template-content-${tagIndex++}`;
const nextTask = () => new Promise((resolve) => setTimeout(resolve, 0));

//the view's errors land in `errors`, so a paint that throws leaves the last good one in place
const mountView = async (view: () => unknown) => {
	const tag = uniqueTag();
	const errors: Array<unknown> = [];
	customElements.define(
		tag,
		component(function* () {
			yield function* paint() {
				try {
					yield view() as ReturnType<typeof html>;
				} catch (error) {
					errors.push(error);
				}
			};
		}),
	);
	const host = document.createElement(tag) as BaseComponent;
	document.body.append(host);
	await nextTask();
	return { host, errors };
};

const templateOf = (host: BaseComponent) =>
	host.shadowRoot!.querySelector("template")!;

describe("holes inside a nested <template> fill its content like any other hole", () => {
	test("a text value stays text", async () => {
		const value = "<img src=x onerror=alert(1)>";
		const { host } = await mountView(
			() =>
				html`<div>
					<template><p>${value}</p></template>
				</div>`,
		);
		const content = templateOf(host).content;
		expect(content.querySelector("img")).toBeNull();
		expect(content.querySelector("p")!.textContent).toBe(value);
		host.remove();
	});

	test("an attribute value stays inside its attribute", async () => {
		const value = 'x" onerror="alert(1)';
		const unquoted = "x onerror=alert(1)";
		const { host } = await mountView(
			() =>
				html`<div>
					<template><img src="${value}" /><img src=${unquoted} /></template>
				</div>`,
		);
		const [quotedImage, unquotedImage] =
			templateOf(host).content.querySelectorAll("img");
		expect(quotedImage.getAttribute("src")).toBe(value);
		expect(unquotedImage.getAttribute("src")).toBe(unquoted);
		expect(quotedImage.hasAttribute("onerror")).toBe(false);
		expect(unquotedImage.hasAttribute("onerror")).toBe(false);
		host.remove();
	});

	test("the content holds no library markers", async () => {
		const items = ["a", "b"];
		const { host } = await mountView(
			() =>
				html`<div>
					<template
						><ul class=${"list"}>
							${items.map((item) => html`<li>${item}</li>`)}
						</ul>
						${html`<p>${"nested"}</p>`}</template
					>
				</div>`,
		);
		const content = templateOf(host).content;
		expect(templateOf(host).innerHTML).not.toContain("<!--");
		expect(content.querySelectorAll("li")).toHaveLength(2);
		expect(content.querySelector("p")!.textContent).toBe("nested");
		host.remove();
	});

	test("an unchanged value keeps the content's nodes", async () => {
		let count = 0;
		const { host } = await mountView(
			() =>
				html`<p>${count}</p>
					<div>
						<template><b>${"same"}</b></template>
					</div>`,
		);
		const bold = templateOf(host).content.querySelector("b");
		count = 1;
		await host.update();
		expect(host.shadowRoot!.querySelector("p")!.textContent).toBe("1");
		expect(templateOf(host).content.querySelector("b")).toBe(bold);
		host.remove();
	});

	test("a changed value rebuilds the content inside the same <template>", async () => {
		let label = "first";
		const { host } = await mountView(
			() =>
				html`<div>
					<template><b>${label}</b></template>
				</div>`,
		);
		const template = templateOf(host);
		const bold = template.content.querySelector("b");
		label = "second";
		await host.update();
		expect(templateOf(host)).toBe(template);
		expect(template.content.querySelector("b")).not.toBe(bold);
		expect(template.content.querySelector("b")!.textContent).toBe("second");
		host.remove();
	});

	test("a copy of the content carries the values", async () => {
		const { host } = await mountView(
			() =>
				html`<div>
					<template><li class=${"row"}>${"label"}</li></template>
				</div>`,
		);
		const copy = document.importNode(templateOf(host).content, true);
		const row = copy.querySelector("li")!;
		expect(row.className).toBe("row");
		expect(row.textContent).toBe("label");
		host.remove();
	});

	test("a <template> inside the content fills its own content", async () => {
		const { host } = await mountView(
			() =>
				html`<div>
					<template
						><section>
							<template><b>${"inner"}</b></template>
						</section></template
					>
				</div>`,
		);
		const inner = templateOf(host).content.querySelector("template")!;
		expect(inner.content.querySelector("b")!.textContent).toBe("inner");
		expect(templateOf(host).innerHTML).not.toContain("<!--");
		host.remove();
	});

	test("holes on the <template> and in its content both bind", async () => {
		const { host } = await mountView(
			() =>
				html`<div>
					<template id=${"row"}><p>${"text"}</p></template>
				</div>`,
		);
		const template = templateOf(host);
		expect(template.id).toBe("row");
		expect(template.content.querySelector("p")!.textContent).toBe("text");
		host.remove();
	});

	test("a dynamic comment inside the content is a comment, not a list key", async () => {
		const { host } = await mountView(
			() =>
				html`<div>
					<template
						><!--${"note"}-->
						<p>x</p></template
					>
				</div>`,
		);
		const first = templateOf(host).content.firstChild as Comment;
		expect(first.nodeType).toBe(Node.COMMENT_NODE);
		expect(first.data).toBe("note");
		host.remove();
	});

	test("a value that ends a <style> early throws inside a <template> too, on every paint", async () => {
		let color = "red";
		const { host, errors } = await mountView(
			() =>
				html`<div>
					<template
						><style>
							p {
								color: ${color};
							}
						</style></template
					>
				</div>`,
		);
		color = "red}</style><img src=x onerror=alert(1)>";
		await host.update();
		await host.update();
		expect(errors).toHaveLength(2);
		expect(String(errors[0])).toMatch(/grundlage: <style> .*"<\/style"/);
		const styleText =
			templateOf(host).content.querySelector("style")!.textContent;
		expect(styleText).toContain("color: red;");
		expect(styleText).not.toContain("<img");
		host.remove();
	});

	test("a template without holes stays as written", async () => {
		const { host } = await mountView(
			() =>
				html`<div>
					<template><p>static</p></template>
				</div>`,
		);
		expect(templateOf(host).innerHTML).toBe("<p>static</p>");
		host.remove();
	});
});

describe("a nested <template>'s content takes only what copies of it keep", () => {
	const copiesKeepOnly =
		/grundlage: a <template>'s content expects attributes and text/;

	test("a listener inside the content throws", async () => {
		const { host, errors } = await mountView(
			() =>
				html`<div>
					<template><button onClick=${() => {}}>x</button></template>
				</div>`,
		);
		expect(errors).toHaveLength(1);
		expect(String(errors[0])).toMatch(copiesKeepOnly);
		expect(String(errors[0])).toContain('the listener "onClick" on <button>');
		host.remove();
	});

	test("a value bound as a property inside the content throws", async () => {
		const { host, errors } = await mountView(
			() =>
				html`<div>
					<template><div config=${{ open: true }}></div></template>
				</div>`,
		);
		expect(errors).toHaveLength(1);
		expect(String(errors[0])).toMatch(copiesKeepOnly);
		expect(String(errors[0])).toContain('the property "config" on <div>');
		host.remove();
	});

	test("a prop that a defined element declares throws inside the content", async () => {
		const childTag = uniqueTag();
		customElements.define(
			childTag,
			component(
				function* () {
					yield html`<p>child</p>`;
				},
				{ props: { label: prop.attribute(String, "") } },
			),
		);
		const { host, errors } = await mountView(
			() =>
				html`<div><template><${childTag} label=${"x"}></${childTag}></template></div>`,
		);
		expect(errors).toHaveLength(1);
		expect(String(errors[0])).toMatch(copiesKeepOnly);
		expect(String(errors[0])).toContain(`the prop "label" on <${childTag}>`);
		host.remove();
	});

	test("a listener inside an html value inside the content throws too", async () => {
		const { host, errors } = await mountView(
			() =>
				html`<div>
					<template>${html`<button onClick=${() => {}}>x</button>`}</template>
				</div>`,
		);
		expect(errors).toHaveLength(1);
		expect(String(errors[0])).toMatch(copiesKeepOnly);
		host.remove();
	});

	test("a listener in a spread inside the content throws", async () => {
		const { host, errors } = await mountView(
			() =>
				html`<div>
					<template><button ${{ onClick: () => {} }}>x</button></template>
				</div>`,
		);
		expect(errors).toHaveLength(1);
		expect(String(errors[0])).toMatch(copiesKeepOnly);
		expect(String(errors[0])).toContain('the listener "onClick" on <button>');
		host.remove();
	});

	test("a listener in a list row inside the content throws", async () => {
		const { host, errors } = await mountView(
			() =>
				html`<div>
					<template
						><ul>
							${["a"].map((item) => html`<li onClick=${() => {}}>${item}</li>`)}
						</ul></template
					>
				</div>`,
		);
		expect(errors).toHaveLength(1);
		expect(String(errors[0])).toMatch(copiesKeepOnly);
		host.remove();
	});

	test("a listener after a <template> nested in the content throws too", async () => {
		const { host, errors } = await mountView(
			() =>
				html`<div>
					<template
						><template><p>${"inner"}</p></template
						><button onClick=${() => {}}>x</button></template
					>
				</div>`,
		);
		expect(errors).toHaveLength(1);
		expect(String(errors[0])).toMatch(copiesKeepOnly);
		host.remove();
	});

	test("after the content throws, a listener outside it binds again", async () => {
		let isInsideTemplate = true;
		const handler = vi.fn();
		const { host, errors } = await mountView(() =>
			isInsideTemplate
				? html`<div>
						<template><button onClick=${handler}>x</button></template>
					</div>`
				: html`<button onClick=${handler}>x</button>`,
		);
		isInsideTemplate = false;
		await host.update();
		host.shadowRoot!.querySelector("button")!.click();
		expect(errors).toHaveLength(1);
		expect(handler).toHaveBeenCalledTimes(1);
		host.remove();
	});

	test("a listener on the <template> element itself binds", async () => {
		const handler = vi.fn();
		const { host, errors } = await mountView(
			() =>
				html`<div>
					<template onClick=${handler}><p>${"x"}</p></template>
				</div>`,
		);
		templateOf(host).dispatchEvent(new Event("click"));
		expect(errors).toEqual([]);
		expect(handler).toHaveBeenCalledTimes(1);
		host.remove();
	});

	test("a paint that throws inside the content leaves the last content in place", async () => {
		let label = "before";
		let config: unknown = "text";
		const { host, errors } = await mountView(
			() =>
				html`<div>
					<template
						><b>${label}</b>
						<div config=${config}></div
					></template>
				</div>`,
		);
		label = "after";
		config = { open: true };
		await host.update();
		expect(errors).toHaveLength(1);
		expect(templateOf(host).content.querySelector("b")!.textContent).toBe(
			"before",
		);
		host.remove();
	});
});

describe("a nested <template> with shadowrootmode", () => {
	const noShadowRootMode =
		/grundlage: a nested <template> expects no shadowrootmode/;

	test("shadowrootmode throws, since a paint keeps a plain <template>", async () => {
		const { host, errors } = await mountView(
			() =>
				html`<div>
					<template shadowrootmode="open"><p>static</p></template>
				</div>`,
		);
		expect(errors).toHaveLength(1);
		expect(String(errors[0])).toMatch(noShadowRootMode);
		host.remove();
	});

	test("shadowRootMode with a bound value throws too", async () => {
		//prettier-ignore
		const { host, errors } = await mountView(() => html`<div><template shadowRootMode=${"open"}><p>${"x"}</p></template></div>`);
		expect(errors).toHaveLength(1);
		expect(String(errors[0])).toMatch(noShadowRootMode);
		host.remove();
	});
});

const canPrerender =
	typeof (Element.prototype as { setHTMLUnsafe?: unknown }).setHTMLUnsafe ===
	"function";

describe("a nested <template> from the server", () => {
	test.skipIf(!canPrerender)(
		"hydration keeps the server's content, and a later change rebuilds it",
		async () => {
			let label = "server";
			const body = function* () {
				yield function* view() {
					yield html`<div>
						<template><p>${label}</p></template>
					</div>`;
				};
			};
			const { host: client } = await mountView(
				() =>
					html`<div>
						<template><p>${label}</p></template>
					</div>`,
			);
			const serverMarkup = client.shadowRoot!.innerHTML;
			client.remove();

			const tag = uniqueTag();
			const holder = document.createElement("div");
			document.body.append(holder);
			(
				holder as unknown as { setHTMLUnsafe(html: string): void }
			).setHTMLUnsafe(
				`<${tag}><template shadowrootmode="open">${serverMarkup}</template></${tag}>`,
			);
			const host = holder.firstElementChild as BaseComponent;
			const serverParagraph = templateOf(host).content.querySelector("p");
			const warn = vi.spyOn(console, "warn");
			customElements.define(tag, component(body));
			await nextTask();
			expect(templateOf(host).content.querySelector("p")).toBe(serverParagraph);
			const hydrationWarnings = warn.mock.calls.filter(([message]) =>
				String(message).includes("hydration mismatch"),
			);
			expect(hydrationWarnings).toEqual([]);

			label = "client";
			await host.update();
			expect(templateOf(host).content.querySelector("p")!.textContent).toBe(
				"client",
			);
			warn.mockRestore();
			holder.remove();
		},
	);
});
