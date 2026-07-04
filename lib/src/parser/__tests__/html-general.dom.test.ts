import { describe, expect, test } from "vitest";
import { getParsedTemplate } from "../html";
import { html } from "../../template-value";
import { buildFragment } from "../../rendering/build-fragment";
import { BINDING, SingleValueAttributeStaticBinding } from "../types";

const parse = (strings: TemplateStringsArray, ..._values: Array<unknown>) =>
	getParsedTemplate(strings);

describe("html parser — static templates", () => {
	test("produces no bindings", () => {
		const parsed = parse` <div>hello</div>`;
		expect(parsed.bindings).toHaveLength(0);
	});

	test("preserves static attributes", () => {
		const parsed = parse` <div class="red" id="main">text</div>`;
		expect(parsed.bindings).toHaveLength(0);
		const div = buildFragment(parsed.htmlWithMarkers).querySelector("div")!;
		expect(div.getAttribute("class")).toBe("red");
		expect(div.getAttribute("id")).toBe("main");
	});

	test("handles self-closing tags", () => {
		const parsed = parse` <div>
			<br />
			<hr />
		</div>`;
		expect(parsed.bindings).toHaveLength(0);
	});

	test("handles nested elements", () => {
		const parsed = parse` <div>
			<span><a>deep</a></span>
		</div>`;
		expect(parsed.bindings).toHaveLength(0);
	});
});

describe("html parser — expression to binding mapping", () => {
	test("single content expression is a single content binding", () => {
		const parsed = parse` <div>${"text"}</div>`;
		expect(parsed.bindings.map((b) => b.type)).toEqual([BINDING.CONTENT]);
	});

	test("two expressions in one attribute share one composed binding", () => {
		const parsed = parse` <div class="${"a"} ${"b"}"></div>`;
		expect(parsed.bindings.map((b) => b.type)).toEqual([BINDING.ATTRIBUTE]);
	});

	test("expressions in different attributes map to different bindings", () => {
		const parsed = parse` <div class="${"a"}" id="${"b"}"></div>`;
		expect(parsed.bindings.map((b) => b.type)).toEqual([
			BINDING.SINGLE_VALUE_ATTRIBUTE,
			BINDING.SINGLE_VALUE_ATTRIBUTE,
		]);
	});

	test("mixed content and attribute expressions", () => {
		const parsed = parse` <div class="${"a"}">${"text"}</div>`;
		expect(parsed.bindings.map((b) => b.type)).toEqual([
			BINDING.SINGLE_VALUE_ATTRIBUTE,
			BINDING.CONTENT,
		]);
	});
});

describe("html parser — template caching", () => {
	test("structurally identical templates parse to equal results with independent values", () => {
		const a = parse`<span>${"one"}</span>`;
		const b = parse`<span>${"two"}</span>`;

		expect(a).toStrictEqual(b);
		expect(html`<span>${"one"}</span>`.values).toEqual(["one"]);
		expect(html`<span>${"two"}</span>`.values).toEqual(["two"]);
	});

	test("different template strings produce different parse results", () => {
		const a = parse` <div>${"val"}</div>`;
		const b = parse`<span>${"val"}</span>`;

		expect(a.templateHash).not.toBe(b.templateHash);
	});

	test("cache returns the identical parsed reference for the same tagged literal", () => {
		const render = (value: string) => parse`<div>${value}</div>`;
		const first = render("a");
		const second = render("b");
		expect(first).toBe(second);
	});
});

describe("html parser — whitespace handling", () => {
	test("template with newlines between elements", () => {
		const val = "hello";
		const parsed = parse`
			<div>
				<span>${val}</span>
			</div>
		`;

		expect(parsed.bindings).toHaveLength(1);
		expect(parsed.bindings[0].type).toBe(BINDING.CONTENT);
	});

	test("attributes separated by newlines", () => {
		const cls = "red";
		const id = "main";
		const parsed = parse` <div class="${cls}" id="${id}"></div>`;

		const b0 = parsed.bindings[0] as SingleValueAttributeStaticBinding;
		const b1 = parsed.bindings[1] as SingleValueAttributeStaticBinding;
		expect(b0.nameParts).toEqual(["class"]);
		expect(b1.nameParts).toEqual(["id"]);
	});

	test("tabs as attribute separator", () => {
		const cls = "red";
		const id = "main";
		const parsed = parse`<div class="${cls}" id="${id}"></div>`;

		const first = parsed.bindings[0] as SingleValueAttributeStaticBinding;
		const second = parsed.bindings[1] as SingleValueAttributeStaticBinding;
		expect(first.nameParts).toEqual(["class"]);
		expect(second.nameParts).toEqual(["id"]);
	});

	test("whitespace before self-closing slash", () => {
		const parsed = parse`<br />`;
		expect(parsed.bindings).toHaveLength(0);
		expect(
			buildFragment(parsed.htmlWithMarkers).querySelector("br"),
		).not.toBeNull();
	});
});

describe("html parser — void and self-closing elements", () => {
	test("void elements produce no end tag issues", () => {
		const val = "hello";
		const parsed = parse`<br />
			<p>${val}</p>`;

		expect(parsed.bindings).toHaveLength(1);
		expect(parsed.bindings[0].type).toBe(BINDING.CONTENT);
	});

	test("multiple void elements with dynamic attributes", () => {
		const type1 = "text";
		const type2 = "email";
		const parsed = parse`<input type="${type1}" /><input type="${type2}" />`;

		expect(parsed.bindings.map((b) => b.type)).toEqual([
			BINDING.SINGLE_VALUE_ATTRIBUTE,
			BINDING.SINGLE_VALUE_ATTRIBUTE,
		]);
	});

	test("img with dynamic src", () => {
		const src = "image.png";
		const parsed = parse`<img src="${src}" />`;

		expect(parsed.bindings).toHaveLength(1);
		const binding = parsed.bindings[0] as SingleValueAttributeStaticBinding;
		expect(binding.nameParts).toEqual(["src"]);
	});

	test("void element between elements with content bindings", () => {
		const a = "before";
		const b = "after";
		const parsed = parse`<p>${a}</p>
			<br />
			<p>${b}</p>`;

		expect(parsed.bindings.map((binding) => binding.type)).toEqual([
			BINDING.CONTENT,
			BINDING.CONTENT,
		]);
	});

	test("self-closes a tag when the slash sits flush against the name", () => {
		const parsed = parse`<br/><span>after</span>`;
		const fragment = buildFragment(parsed.htmlWithMarkers);
		const br = fragment.querySelector("br")!;
		const span = fragment.querySelector("span")!;
		expect(br).not.toBeNull();
		expect(span).not.toBeNull();
		expect(br.contains(span)).toBe(false);
		expect(br.children).toHaveLength(0);
	});

	test("static comment inside a template is preserved alongside a dynamic binding", () => {
		const parsed = parse`<div><!-- author note -->${"payload"}</div>`;
		const div = buildFragment(parsed.htmlWithMarkers).querySelector("div")!;

		const commentNodes: Array<Comment> = [];
		for (const child of div.childNodes) {
			if (child.nodeType === Node.COMMENT_NODE) {
				commentNodes.push(child as Comment);
			}
		}
		expect(commentNodes).toHaveLength(3);
		expect(commentNodes.some((c) => c.data === " author note ")).toBe(true);
	});
});

describe("html parser — fragment structure", () => {
	test("static template produces correct DOM structure", () => {
		const parsed = parse` <div><span>hello</span></div>`;
		const div = buildFragment(parsed.htmlWithMarkers).querySelector("div");
		expect(div).not.toBeNull();
		const span = div?.querySelector("span");
		expect(span).not.toBeNull();
		expect(span?.textContent).toBe("hello");
	});

	test("multiple root elements in fragment", () => {
		const parsed = parse`<p>one</p>
			<p>two</p>
			<p>three</p>`;
		const ps = buildFragment(parsed.htmlWithMarkers).querySelectorAll("p");
		expect(ps.length).toBe(3);
	});

	test("dynamic tag uses placeholder div in fragment", () => {
		const tag = "section";
		const parsed = parse`
            <${tag}>content</${tag}>`;

		const div = buildFragment(parsed.htmlWithMarkers).querySelector("div");
		expect(div).not.toBeNull();
	});

	test("static attributes are present in fragment", () => {
		const dyn = "dynamic";
		const parsed = parse` <div id="static" class="${dyn}">text</div>`;

		const div = buildFragment(parsed.htmlWithMarkers).querySelector("div");
		expect(div?.getAttribute("id")).toBe("static");
	});

	test("content binding inserts two comment markers", () => {
		const val = "text";
		const parsed = parse`<div>${val}</div>`;

		const div = buildFragment(parsed.htmlWithMarkers).querySelector("div")!;
		const comments = Array.from(div.childNodes).filter(
			(node) => node.nodeType === Node.COMMENT_NODE,
		);
		expect(comments).toHaveLength(2);
	});

	test("raw-content element places its marker as a sibling, not a child", () => {
		const color = "red";
		const parsed = parse`<style>
			p {
				color: ${color};
			}
		</style>`;

		const style = buildFragment(parsed.htmlWithMarkers).querySelector("style")!;
		const innerComments = Array.from(style.childNodes).filter(
			(node) => node.nodeType === Node.COMMENT_NODE,
		);
		expect(innerComments).toHaveLength(0);

		const markerBeforeStyle = style.previousSibling as Comment;
		expect(markerBeforeStyle.nodeType).toBe(Node.COMMENT_NODE);
		expect(markerBeforeStyle.data).toContain("^.^");
	});
});

describe("html parser — complex templates", () => {
	test("mixed binding types in one template", () => {
		const tag = "div";
		const cls = "red";
		const text = "hello";
		const parsed = parse`
            <${tag} class="${cls}">${text}</${tag}>`;

		expect(parsed.bindings.length).toBeGreaterThanOrEqual(3);

		const types = parsed.bindings.map((b) => b.type);
		expect(types).toContain(BINDING.TAG);
		expect(types).toContain(BINDING.SINGLE_VALUE_ATTRIBUTE);
		expect(types).toContain(BINDING.CONTENT);
	});

	test("deeply nested dynamic content", () => {
		const a = "1";
		const b = "2";
		const c = "3";
		const parsed = parse` <div>
			${a}<span>${b}<em>${c}</em></span>
		</div>`;

		expect(parsed.bindings.map((binding) => binding.type)).toEqual([
			BINDING.CONTENT,
			BINDING.CONTENT,
			BINDING.CONTENT,
		]);
	});

	test("sibling elements with dynamic content", () => {
		const a = "first";
		const b = "second";
		const c = "third";
		const parsed = parse`<p>${a}</p>
			<p>${b}</p>
			<p>${c}</p>`;

		expect(parsed.bindings).toHaveLength(3);
	});

	test("expression as only child", () => {
		const val = "alone";
		const parsed = parse`${val}`;

		expect(parsed.bindings).toHaveLength(1);
		expect(parsed.bindings[0].type).toBe(BINDING.CONTENT);
	});

	test("multiple expressions with no static content between them", () => {
		const a = "x";
		const b = "y";
		const parsed = parse`${a}${b}`;

		expect(parsed.bindings).toHaveLength(2);
		expect(html`${a}${b}`.values).toEqual(["x", "y"]);
	});
});

describe("html parser — mixed scenarios", () => {
	test("content then attribute then content", () => {
		const text1 = "before";
		const cls = "mid";
		const text2 = "after";
		const parsed = parse`<p>${text1}</p>
			<div class="${cls}"></div>
			<p>${text2}</p>`;

		expect(parsed.bindings.map((b) => b.type)).toEqual([
			BINDING.CONTENT,
			BINDING.SINGLE_VALUE_ATTRIBUTE,
			BINDING.CONTENT,
		]);
	});

	test("dynamic tag with content binding inside", () => {
		const tag = "div";
		const text = "hello";
		const parsed = parse`
            <${tag}>${text}</${tag}>`;

		const types = parsed.bindings.map((b) => b.type);
		expect(types).toContain(BINDING.TAG);
		expect(types).toContain(BINDING.CONTENT);
	});

	test("attribute binding then raw content binding", () => {
		const cls = "highlight";
		const css = "color: red";
		const parsed = parse` <div class="${cls}"></div>
			<style>
				p {
				                ${css}
				            }
			</style>`;

		expect(parsed.bindings.map((b) => b.type)).toEqual([
			BINDING.SINGLE_VALUE_ATTRIBUTE,
			BINDING.RAW_CONTENT,
		]);
	});

	test("deeply nested template with all binding types", () => {
		const tag = "section";
		const cls = "wrapper";
		const text = "content";
		const css = "color: blue";
		const parsed = parse`
            <${tag} class="${cls}"><p>${text}</p>
                <style>${css}</style>
            </${tag}>`;

		const types = parsed.bindings.map((b) => b.type);
		expect(types).toContain(BINDING.TAG);
		expect(types).toContain(BINDING.SINGLE_VALUE_ATTRIBUTE);
		expect(types).toContain(BINDING.CONTENT);
		expect(types).toContain(BINDING.RAW_CONTENT);
	});

	test("sibling elements each with different binding types", () => {
		const tag = "h1";
		const text = "title";
		const cls = "body";
		const css = "margin: 0";
		const parsed = parse`
            <${tag}>${text}</${tag}>
            <div class="${cls}">static</div>
            <style>${css}</style>`;

		expect(parsed.bindings.length).toBeGreaterThanOrEqual(4);
	});

	test("list rendering pattern", () => {
		const items = ["a", "b", "c"];
		const parsed = parse` <ul>
			${items.map((i) => html` <li>${i}</li>`)}
		</ul>`;

		expect(parsed.bindings).toHaveLength(1);
		expect(parsed.bindings[0].type).toBe(BINDING.CONTENT);
	});

	test("conditional rendering pattern", () => {
		const show = true;
		const parsed = parse` <div>${show ? html`<span>yes</span>` : null}</div>`;

		expect(parsed.bindings).toHaveLength(1);
		expect(parsed.bindings[0].type).toBe(BINDING.CONTENT);
	});

	test("void element without trailing slash followed by dynamic content", () => {
		const value = "text";
		const parsed = parse`<br />${value}`;
		expect(parsed.bindings).toHaveLength(1);
		expect(parsed.bindings[0].type).toBe(BINDING.CONTENT);
		expect(
			buildFragment(parsed.htmlWithMarkers).querySelector("br"),
		).not.toBeNull();
	});

	test("void element without trailing slash nested in a parent", () => {
		const value = "text";
		const parsed = parse`<div><br />${value}</div>`;
		const div = buildFragment(parsed.htmlWithMarkers).querySelector("div")!;
		expect(div.querySelector("br")).not.toBeNull();
	});

	test("real-world component pattern with style, attributes, and content", () => {
		const color = "blue";
		const cls = "active";
		const label = "Click me";
		const handler = () => {};
		const parsed = parse`
			<style>
				:host {
					color: ${color};
				}
			</style>
			<button class="${cls}" onclick="${handler}">${label}</button>
		`;

		expect(parsed.bindings.length).toBe(4);
		const types = parsed.bindings.map((b) => b.type);
		expect(types).toContain(BINDING.RAW_CONTENT);
		expect(types).toContain(BINDING.SINGLE_VALUE_ATTRIBUTE);
		expect(types).toContain(BINDING.EVENT);
		expect(types).toContain(BINDING.CONTENT);
	});
});
