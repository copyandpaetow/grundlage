import { describe, expect, test } from "vitest";
import { getParsedTemplate } from "../html";
import { buildFragment } from "../../rendering/build-fragment";
import { AttributeStaticBinding, BINDING } from "../types";

const parse = (strings: TemplateStringsArray, ..._values: Array<unknown>) =>
	getParsedTemplate(strings);

describe("html parser — fragment output: static attributes beside dynamic", () => {
	test("static attribute before dynamic attribute is preserved in fragment", () => {
		const value = "red";
		const parsed = parse`<div id="fixed" class="${value}"></div>`;
		const div = buildFragment(parsed.htmlWithMarkers).querySelector("div")!;
		expect(div.getAttribute("id")).toBe("fixed");
	});

	test("static attribute after dynamic attribute is preserved in fragment", () => {
		const value = "red";
		const parsed = parse`<div class="${value}" id="fixed"></div>`;
		const div = buildFragment(parsed.htmlWithMarkers).querySelector("div")!;
		expect(div.getAttribute("id")).toBe("fixed");
	});

	test("static attributes on both sides of dynamic are preserved", () => {
		const value = "red";
		const parsed = parse`<div id="before" class="${value}" role="main"></div>`;
		const div = buildFragment(parsed.htmlWithMarkers).querySelector("div")!;
		expect(div.getAttribute("id")).toBe("before");
		expect(div.getAttribute("role")).toBe("main");
	});

	test("dynamic attribute is absent from the static fragment", () => {
		const value = "red";
		const parsed = parse`<div class="${value}"></div>`;
		const div = buildFragment(parsed.htmlWithMarkers).querySelector("div")!;
		expect(div.getAttribute("class")).toBeNull();
	});
});

describe("html parser — fragment output: attribute marker placement", () => {
	test("attribute binding marker is a sibling before its element", () => {
		const value = "red";
		const parsed = parse`<div class="${value}">hello</div>`;
		const fragment = buildFragment(parsed.htmlWithMarkers);
		const firstChild = fragment.firstChild;
		expect(firstChild?.nodeType).toBe(Node.COMMENT_NODE);
		expect((firstChild as Comment).data).toContain("^.^");
	});

	test("two dynamic attributes on same element produce two sibling markers", () => {
		const cls = "red";
		const id = "main";
		const parsed = parse`<div class="${cls}" id="${id}"></div>`;
		const fragment = buildFragment(parsed.htmlWithMarkers);
		const comments = Array.from(fragment.childNodes).filter(
			(node) => node.nodeType === Node.COMMENT_NODE,
		);
		expect(comments).toHaveLength(2);
	});
});

describe("html parser — fragment output: special characters in quoted attribute values", () => {
	test("static quoted attribute value may contain '>'", () => {
		const parsed = parse`<div title="a > b">content</div>`;
		const div = buildFragment(parsed.htmlWithMarkers).querySelector("div")!;
		expect(div.getAttribute("title")).toBe("a > b");
		expect(div.textContent).toBe("content");
	});

	test("static quoted attribute value may contain '<'", () => {
		const parsed = parse`<div title="a < b">content</div>`;
		const div = buildFragment(parsed.htmlWithMarkers).querySelector("div")!;
		expect(div.getAttribute("title")).toBe("a < b");
	});

	test("static quoted attribute value may contain '='", () => {
		const parsed = parse`<a href="?x=1&y=2">link</a>`;
		const anchor = buildFragment(parsed.htmlWithMarkers).querySelector("a")!;
		expect(anchor.getAttribute("href")).toBe("?x=1&y=2");
	});

	test("single-quoted static value may contain a double quote", () => {
		const parsed = parse`<div title='he said "hi"'>text</div>`;
		const div = buildFragment(parsed.htmlWithMarkers).querySelector("div")!;
		expect(div.getAttribute("title")).toBe('he said "hi"');
	});

	test("dynamic attribute value with static prefix containing '>'", () => {
		const value = "x";
		const parsed = parse`<div title="prefix>${value}">text</div>`;
		expect(parsed.bindings).toHaveLength(1);
		const binding = parsed.bindings[0] as AttributeStaticBinding;
		expect(binding.type).toBe(BINDING.ATTRIBUTE);
		expect(binding.nameParts).toEqual(["title"]);
	});
});

describe("html parser — fragment output: complex structure", () => {
	test("nested elements with mixed static and dynamic attributes", () => {
		const cls = "body";
		const text = "hello";
		const parsed = parse` <section id="root">
			<p class="${cls}">${text}</p>
		</section>`;
		const section = buildFragment(parsed.htmlWithMarkers).querySelector(
			"section",
		)!;
		expect(section.getAttribute("id")).toBe("root");
		const p = section.querySelector("p")!;
		expect(p).not.toBeNull();
	});

	test("sibling elements each with their own dynamic attribute", () => {
		const a = "one";
		const b = "two";
		const parsed = parse`<p class="${a}">one</p>
			<p class="${b}">two</p>`;
		const paragraphs = buildFragment(parsed.htmlWithMarkers).querySelectorAll(
			"p",
		);
		expect(paragraphs).toHaveLength(2);
		expect(paragraphs[0].textContent).toBe("one");
		expect(paragraphs[1].textContent).toBe("two");
	});

	test("row template preserves <tr> and <td> elements in the fragment", () => {
		const identifier = 1;
		const label = "row";
		const parsed = parse`<tr data-key="${identifier}" class="${""}">
			<td>${identifier}</td>
			<td>${label}</td>
		</tr>`;
		const row = buildFragment(parsed.htmlWithMarkers).querySelector("tr");
		expect(row).not.toBeNull();
		expect(row!.querySelectorAll("td")).toHaveLength(2);
	});
});
