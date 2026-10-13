import { afterEach, describe, expect, test, vi } from "vitest";
import { html, component, ComponentErrorEvent } from "../../index";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const MATHML_NAMESPACE = "http://www.w3.org/1998/Math/MathML";
const HTML_NAMESPACE = "http://www.w3.org/1999/xhtml";

//happy-dom parses <math> children as html, so the MathML namespace is only observable in a browser
const isRealBrowser =
	typeof (window as { happyDOM?: unknown }).happyDOM === "undefined";

const sleep = (duration = 0) =>
	new Promise((resolve) => setTimeout(resolve, duration));

let tagId = 0;
const uniqueTag = () => `test-foreign-${tagId++}-${Date.now()}`;

const mount = async (renderTemplate: () => unknown) => {
	const tag = uniqueTag();
	customElements.define(
		tag,
		component(function* () {
			yield renderTemplate;
		}),
	);
	const element = document.createElement(tag);
	const errors: Array<unknown> = [];
	element.addEventListener("grundlage-error", (event) => {
		errors.push((event as ComponentErrorEvent).error);
		event.preventDefault();
	});
	document.body.appendChild(element);
	await sleep();
	element.remove();
	return { shadowRoot: element.shadowRoot!, errors };
};

describe("svg and mathml namespaces", () => {
	test("a nested template inside <svg> mounts svg elements", async () => {
		const { shadowRoot } = await mount(
			() => html`<svg>${html`<circle r="3"></circle>`}</svg>`,
		);

		expect(shadowRoot.querySelector("circle")?.namespaceURI).toBe(
			SVG_NAMESPACE,
		);
	});

	test("list rows inside <svg> mount svg elements", async () => {
		const { shadowRoot } = await mount(
			() =>
				html`<svg>
					${[1, 2].map((radius) => html`<circle r=${radius}></circle>`)}
				</svg>`,
		);

		const circles = [...shadowRoot.querySelectorAll("circle")];
		expect(circles).toHaveLength(2);
		for (const circle of circles)
			expect(circle.namespaceURI).toBe(SVG_NAMESPACE);
	});

	test.skipIf(!isRealBrowser)(
		"a nested template inside <math> mounts mathml elements",
		async () => {
			const { shadowRoot } = await mount(
				() => html`<math>${html`<mi>x</mi>`}</math>`,
			);

			expect(shadowRoot.querySelector("mi")?.namespaceURI).toBe(
				MATHML_NAMESPACE,
			);
		},
	);

	test("a nested template inside <foreignObject> mounts html elements", async () => {
		const { shadowRoot } = await mount(
			() =>
				html`<svg><foreignObject>${html`<p>text</p>`}</foreignObject></svg>`,
		);

		expect(shadowRoot.querySelector("p")?.namespaceURI).toBe(HTML_NAMESPACE);
	});

	test("a dynamic tag inside <svg> keeps the svg namespace and the name's case", async () => {
		const tag = "linearGradient";
		const { shadowRoot } = await mount(
			() => html`<svg><${tag} id="gradient"></${tag}></svg>`,
		);

		const gradient = shadowRoot.getElementById("gradient");
		expect(gradient?.namespaceURI).toBe(SVG_NAMESPACE);
		expect(gradient?.localName).toBe("linearGradient");
	});

	test("a hole inside CDATA ends the component with a remedy", async () => {
		const value = "x";
		const { errors } = await mount(
			() => html`<svg><text><![CDATA[a < b ${value}]]></text></svg>`,
		);

		expect(errors).toHaveLength(1);
		expect(String(errors[0])).toMatch(/Move the hole outside of it/);
	});

	test("a dynamic tag that becomes <svg> outside of svg ends the component with a remedy", async () => {
		const tag = "svg";
		const { errors } = await mount(
			() => html`<div><${tag}><circle r="1"></circle></${tag}></div>`,
		);

		expect(errors).toHaveLength(1);
		expect(String(errors[0])).toMatch(/cannot become <svg>/);
	});

	test("a dynamic tag that becomes <svg> inside svg renders", async () => {
		const tag = "svg";
		const { shadowRoot, errors } = await mount(
			() => html`<svg><${tag} id="inner"></${tag}></svg>`,
		);

		expect(errors).toEqual([]);
		expect(shadowRoot.getElementById("inner")?.namespaceURI).toBe(
			SVG_NAMESPACE,
		);
	});
});

describe("self-closing end after an unquoted value", () => {
	test("a hole value followed by /> ends the element and keeps the slash out of the value", async () => {
		const width = 2;
		//prettier-ignore
		const { shadowRoot } = await mount(() => html`<svg><rect width=${width}/><circle r="1"></circle></svg>`);

		const rect = shadowRoot.querySelector("rect")!;
		expect(rect.getAttribute("width")).toBe("2");
		expect(rect.children).toHaveLength(0);
		expect(rect.nextElementSibling?.localName).toBe("circle");
	});

	test("a static unquoted value followed by /> ends the element", async () => {
		const radius = 1;
		//prettier-ignore
		const { shadowRoot } = await mount(() => html`<svg><rect width=2/><circle r=${radius}></circle></svg>`);

		const rect = shadowRoot.querySelector("rect")!;
		expect(rect.getAttribute("width")).toBe("2");
		expect(rect.nextElementSibling?.localName).toBe("circle");
	});

	test("a slash inside an unquoted value stays part of it", async () => {
		const base = "/docs";
		const { shadowRoot } = await mount(
			() => html`<a href=${base}/intro>link</a>`,
		);

		expect(shadowRoot.querySelector("a")?.getAttribute("href")).toBe(
			"/docs/intro",
		);
	});
});

describe("block tags inside <p>", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	const paragraphWarnings = (warn: ReturnType<typeof vi.spyOn>) =>
		warn.mock.calls.filter(([message]: Array<unknown>) =>
			String(message).includes("closes the <p> before it"),
		);

	test("a dynamic block tag inside <p> warns", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const level = 2;
		await mount(() => html`<p>before<h${level}>heading</h${level}></p>`);

		expect(paragraphWarnings(warn)).toHaveLength(1);
	});

	test("a dynamic inline tag inside <p> does not warn", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const tag = "span";
		await mount(() => html`<p>before<${tag}>inline</${tag}></p>`);

		expect(paragraphWarnings(warn)).toHaveLength(0);
	});

	test("a nested template with a block element inside <p> warns", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		await mount(() => html`<p>${html`<div>block</div>`}</p>`);

		expect(paragraphWarnings(warn)).toHaveLength(1);
	});

	test("a <button> between the <p> and the block tag ends the paragraph's scope", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const tag = "div";
		await mount(() => html`<p><button><${tag}>x</${tag}></button></p>`);

		expect(paragraphWarnings(warn)).toHaveLength(0);
	});
});
