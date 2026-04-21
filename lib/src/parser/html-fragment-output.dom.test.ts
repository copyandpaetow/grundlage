import { describe, expect, test } from "vitest";
import { html } from "./html";
import { AttributeBinding, BINDING_TYPES } from "./types";

describe("html parser — fragment output: static attributes beside dynamic", () => {
	test("static attribute before dynamic attribute is preserved in fragment", () => {
		const value = "red";
		const template = html`<div id="fixed" class="${value}"></div>`;
		const div = template.parsedHTML.fragment.querySelector("div")!;
		expect(div.getAttribute("id")).toBe("fixed");
	});

	test("static attribute after dynamic attribute is preserved in fragment", () => {
		const value = "red";
		const template = html`<div class="${value}" id="fixed"></div>`;
		const div = template.parsedHTML.fragment.querySelector("div")!;
		expect(div.getAttribute("id")).toBe("fixed");
	});

	test("static attributes on both sides of dynamic are preserved", () => {
		const value = "red";
		const template = html`<div id="before" class="${value}" role="main"></div>`;
		const div = template.parsedHTML.fragment.querySelector("div")!;
		expect(div.getAttribute("id")).toBe("before");
		expect(div.getAttribute("role")).toBe("main");
	});

	test("dynamic attribute is absent from the static fragment", () => {
		//the dynamic attribute gets stripped from the tag entirely — it lives as a sibling marker
		//and is filled in at render time, not at parse time
		const value = "red";
		const template = html`<div class="${value}"></div>`;
		const div = template.parsedHTML.fragment.querySelector("div")!;
		expect(div.getAttribute("class")).toBeNull();
	});
});

describe("html parser — fragment output: attribute marker placement", () => {
	test("attribute binding marker is a sibling before its element", () => {
		//raw-content and attribute markers both sit as preceding siblings because their host
		//element cannot hold a placeholder child — the renderer finds the element via nextSibling
		const value = "red";
		const template = html`<div class="${value}">hello</div>`;
		const fragment = template.parsedHTML.fragment;
		const firstChild = fragment.firstChild;
		expect(firstChild?.nodeType).toBe(Node.COMMENT_NODE);
		expect((firstChild as Comment).data).toContain("^.^");
	});

	test("two dynamic attributes on same element produce two sibling markers", () => {
		const cls = "red";
		const id = "main";
		const template = html`<div class="${cls}" id="${id}"></div>`;
		const fragment = template.parsedHTML.fragment;
		const comments = Array.from(fragment.childNodes).filter(
			(node) => node.nodeType === Node.COMMENT_NODE,
		);
		expect(comments).toHaveLength(2);
	});
});

describe("html parser — fragment output: special characters in quoted attribute values", () => {
	test("static quoted attribute value may contain '>'", () => {
		const template = html`<div title="a > b">content</div>`;
		const div = template.parsedHTML.fragment.querySelector("div")!;
		expect(div.getAttribute("title")).toBe("a > b");
		expect(div.textContent).toBe("content");
	});

	test("static quoted attribute value may contain '<'", () => {
		const template = html`<div title="a < b">content</div>`;
		const div = template.parsedHTML.fragment.querySelector("div")!;
		expect(div.getAttribute("title")).toBe("a < b");
	});

	test("static quoted attribute value may contain '='", () => {
		const template = html`<a href="?x=1&y=2">link</a>`;
		const anchor = template.parsedHTML.fragment.querySelector("a")!;
		expect(anchor.getAttribute("href")).toBe("?x=1&y=2");
	});

	test("single-quoted static value may contain a double quote", () => {
		const template = html`<div title='he said "hi"'>text</div>`;
		const div = template.parsedHTML.fragment.querySelector("div")!;
		expect(div.getAttribute("title")).toBe('he said "hi"');
	});

	test("dynamic attribute value with static prefix containing '>'", () => {
		const value = "x";
		const template = html`<div title="prefix>${value}">text</div>`;
		expect(template.parsedHTML.bindings).toHaveLength(1);
		const binding = template.parsedHTML.bindings[0] as AttributeBinding;
		expect(binding.type).toBe(BINDING_TYPES.ATTR);
		expect(binding.keys).toEqual(["title"]);
	});
});

describe("html parser — fragment output: complex structure", () => {
	test("nested elements with mixed static and dynamic attributes", () => {
		const cls = "body";
		const text = "hello";
		const template = html` <section id="root">
			<p class="${cls}">${text}</p>
		</section>`;
		const section = template.parsedHTML.fragment.querySelector("section")!;
		expect(section.getAttribute("id")).toBe("root");
		const p = section.querySelector("p")!;
		expect(p).not.toBeNull();
	});

	test("sibling elements each with their own dynamic attribute", () => {
		const a = "one";
		const b = "two";
		const template = html`<p class="${a}">one</p>
			<p class="${b}">two</p>`;
		const paragraphs = template.parsedHTML.fragment.querySelectorAll("p");
		expect(paragraphs).toHaveLength(2);
		expect(paragraphs[0].textContent).toBe("one");
		expect(paragraphs[1].textContent).toBe("two");
	});
});
