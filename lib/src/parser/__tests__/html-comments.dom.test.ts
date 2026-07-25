import { describe, test, expect } from "vitest";
import { getParsedTemplate } from "../html";
import { buildFragment } from "../../rendering/dom";
import { BINDING } from "../constants";
import { CommentStaticBinding } from "../types";

const parse = (strings: TemplateStringsArray, ..._values: Array<unknown>) =>
	getParsedTemplate(strings);

const literalParts = (binding: CommentStaticBinding) =>
	binding.parts.filter((part): part is string => typeof part === "string");

describe("html parser — comment bindings", () => {
	test("the first dynamic comment is the list key, not a binding", () => {
		const identifier = "row-1";
		const parsed = parse`<!-- ${identifier} -->`;

		expect(parsed.bindings).toHaveLength(0);
		expect(parsed.keyValueParts).toEqual([" ", 0, " "]);
	});

	test("a key comment is stripped — it leaves no node in the markup", () => {
		const identifier = "row-1";
		const parsed = parse`<!-- ${identifier} --><li>row</li>`;

		expect(parsed.htmlWithMarkers).toBe("<li>row</li>");
	});

	test("the literal text around a key expression does not change the key", () => {
		const identifier = "row-1";
		const bare = parse`<!--${identifier}-->`;
		const prose = parse`<!-- id: ${identifier} -->`;

		expect(bare.keyValueParts).toEqual([0]);
		expect(prose.keyValueParts).toEqual([" id: ", 0, " "]);
		expect(bare.htmlWithMarkers).toBe(prose.htmlWithMarkers);
	});

	test("a dynamic comment after the key stays a comment binding", () => {
		const identifier = "row-1";
		const msg = "debug info";
		const parsed = parse`<!--${identifier}--><!-- ${msg} -->`;

		expect(parsed.keyValueParts).toEqual([0]);
		expect(parsed.bindings).toHaveLength(1);
		expect(parsed.bindings[0].type).toBe(BINDING.COMMENT);
	});

	test("comment with no expressions is not a binding", () => {
		const parsed = parse`<!-- static comment -->`;

		expect(parsed.bindings).toHaveLength(0);
	});

	test("comment between elements with bindings", () => {
		const a = "first";
		const b = "second";
		const parsed = parse`<p>${a}</p>
			<!-- separator -->
			<p>${b}</p>`;

		expect(parsed.bindings.map((binding) => binding.type)).toEqual([
			BINDING.CONTENT,
			BINDING.CONTENT,
		]);
	});

	test("multiple expressions in one comment share one key", () => {
		const a = "x";
		const b = "y";
		const parsed = parse`<!-- ${a} and ${b} -->`;

		expect(parsed.bindings).toHaveLength(0);
		expect(
			parsed.keyValueParts!.filter((part) => typeof part === "number"),
		).toEqual([0, 1]);
	});

	test("comment binding parts do not include delimiters", () => {
		const identifier = "row-1";
		const msg = "debug";
		const parsed = parse`<!--${identifier}--><!-- ${msg} -->`;

		const binding = parsed.bindings[0] as CommentStaticBinding;
		for (const part of literalParts(binding)) {
			expect(part).not.toContain("<!--");
			expect(part).not.toContain("-->");
		}
	});

	test("multi-expression comment binding parts do not include delimiters", () => {
		const identifier = "row-1";
		const a = "x";
		const b = "y";
		const parsed = parse`<!--${identifier}--><!-- ${a} and ${b} -->`;

		const binding = parsed.bindings[0] as CommentStaticBinding;
		for (const part of literalParts(binding)) {
			expect(part).not.toContain("<!--");
			expect(part).not.toContain("-->");
		}
	});

	test("static comment is preserved in fragment", () => {
		const parsed = parse`<div>text</div>
			<!-- static -->`;

		const walker = document.createTreeWalker(
			buildFragment(parsed.htmlWithMarkers),
			NodeFilter.SHOW_COMMENT,
		);
		const comments: Array<Comment> = [];
		let node;
		while ((node = walker.nextNode())) {
			comments.push(node as Comment);
		}
		const staticComment = comments.find((c) => c.data.includes("static"));
		expect(staticComment).not.toBeUndefined();
	});

	test("static comment containing HTML-like text does not affect parsing", () => {
		const parsed = parse`<div>before</div>
			<!-- <fake-tag class="x"> -->
			<p>after</p>`;
		expect(parsed.bindings).toHaveLength(0);
		expect(
			buildFragment(parsed.htmlWithMarkers).querySelector("div"),
		).not.toBeNull();
		expect(
			buildFragment(parsed.htmlWithMarkers).querySelector("p"),
		).not.toBeNull();
		expect(
			buildFragment(parsed.htmlWithMarkers).querySelector("fake-tag"),
		).toBeNull();
	});

	test("a single-hole comment after the key stays a comment — whitespace does not flip its semantics", () => {
		const identifier = "row-1";
		const msg = "x";
		const tight = parse`<!--${identifier}--><!--${msg}-->`;
		expect(tight.bindings).toHaveLength(1);
		expect(tight.bindings[0].type).toBe(BINDING.COMMENT);

		const spaced = parse`<!--${identifier}--><!-- ${msg} -->`;
		expect(spaced.bindings[0].type).toBe(BINDING.COMMENT);
	});
});
