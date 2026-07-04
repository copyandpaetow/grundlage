import { describe, expect, test } from "vitest";
import { getParsedTemplate } from "../html";
import { buildFragment } from "../../rendering/build-fragment";
import {
	BINDING,
	SingleValueAttributeStaticBinding,
	StaticBinding,
	TagStaticBinding,
} from "../types";

const parse = (strings: TemplateStringsArray, ..._values: Array<unknown>) =>
	getParsedTemplate(strings);

const tagBindings = (bindings: Array<StaticBinding>) =>
	bindings.filter((b) => b.type === BINDING.TAG);

describe("html parser — tag bindings", () => {
	test("dynamic tag name", () => {
		const tag = "div";
		const parsed = parse`
			<${tag}>content</${tag}>`;

		expect(parsed.bindings).toHaveLength(1);
		const binding = parsed.bindings[0] as TagStaticBinding;
		expect(binding.type).toBe(BINDING.TAG);
		expect(binding.parts).toEqual([0]);
	});

	test("dynamic tag with attributes tracks related bindings", () => {
		const tag = "div";
		const cls = "red";
		const parsed = parse`
			<${tag} class="${cls}">content</${tag}>`;

		const tagBinding = parsed.bindings[0] as TagStaticBinding;
		expect(tagBinding.type).toBe(BINDING.TAG);
		expect(tagBinding.relatedBindingIndices.length).toBeGreaterThan(0);
	});

	test("dynamic open and close collapse to a single tag binding", () => {
		const tag = "div";
		const parsed = parse`
			<${tag}>content</${tag}>`;

		expect(parsed.bindings).toHaveLength(1);
		expect(parsed.bindings[0].type).toBe(BINDING.TAG);
	});

	test("a content hole between open and close is its own binding after the tag", () => {
		const tag = "div";
		const value = "x";
		const parsed = parse`
			<${tag}>${value}</${tag}>`;

		expect(parsed.bindings.map((b) => b.type)).toEqual([
			BINDING.TAG,
			BINDING.CONTENT,
		]);
		expect((parsed.bindings[0] as TagStaticBinding).parts).toEqual([0]);
	});

	test("nested dynamic tags each produce their own tag binding", () => {
		const outer = "div";
		const inner = "span";
		const value = "x";
		const parsed = parse`
			<${outer}><${inner}>${value}</${inner}></${outer}>`;

		expect(parsed.bindings.map((b) => b.type)).toEqual([
			BINDING.TAG,
			BINDING.TAG,
			BINDING.CONTENT,
		]);
	});

	test("dynamic self-closing tag", () => {
		const tag = "br";
		const parsed = parse` <${tag} />`;

		expect(parsed.bindings).toHaveLength(1);
		expect(parsed.bindings[0].type).toBe(BINDING.TAG);
	});

	test("dynamic tag with dynamic attribute", () => {
		const tag = "div";
		const cls = "red";
		const parsed = parse`
			<${tag} class="${cls}">text</${tag}>`;

		const tagBinding = parsed.bindings[0] as TagStaticBinding;
		expect(tagBinding.type).toBe(BINDING.TAG);
		expect(tagBinding.relatedBindingIndices).toEqual([1]);

		const attrBinding = parsed.bindings[1] as SingleValueAttributeStaticBinding;
		expect(attrBinding.type).toBe(BINDING.SINGLE_VALUE_ATTRIBUTE);
		expect(attrBinding.nameParts).toEqual(["class"]);
	});

	test("dynamic tag with multiple dynamic attributes", () => {
		const tag = "div";
		const cls = "red";
		const id = "main";
		const parsed = parse`
			<${tag} class="${cls}" id="${id}">text</${tag}>`;

		const tagBinding = parsed.bindings[0] as TagStaticBinding;
		expect(tagBinding.type).toBe(BINDING.TAG);
		expect(tagBinding.relatedBindingIndices).toEqual([1, 2]);
	});

	test("dynamic tag with boolean (spread) attribute", () => {
		const tag = "button";
		const attr = "disabled";
		const parsed = parse`
			<${tag} ${attr}>click</${tag}>`;

		const tagBinding = parsed.bindings[0] as TagStaticBinding;
		expect(tagBinding.type).toBe(BINDING.TAG);
		expect(tagBinding.relatedBindingIndices).toEqual([1]);
		expect(parsed.bindings[1].type).toBe(BINDING.DYNAMIC_ATTRIBUTE);
	});

	test("nested dynamic tags", () => {
		const outer = "div";
		const inner = "span";
		const parsed = parse`
			<${outer}>
				<${inner}>text</${inner}>
			</${outer}>`;

		expect(tagBindings(parsed.bindings)).toHaveLength(2);
	});

	test("dynamic tag with no content", () => {
		const tag = "div";
		const parsed = parse`
			<${tag}></${tag}>`;

		expect(parsed.bindings).toHaveLength(1);
		expect(parsed.bindings[0].type).toBe(BINDING.TAG);
	});

	test("dynamic tag with static attributes preserved", () => {
		const tag = "div";
		const parsed = parse`
			<${tag} class="static" id="fixed">text</${tag}>`;

		expect(parsed.bindings).toHaveLength(1);
		expect(parsed.bindings[0].type).toBe(BINDING.TAG);
	});

	test("dynamic open paired with static close throws", () => {
		const tag = "div";
		expect(() => parse`<${tag}>content</div>`).toThrow(/Asymmetric tag/);
	});

	test("static open paired with dynamic close throws", () => {
		const tag = "div";
		expect(() => parse`<div>content</${tag}>`).toThrow(/Asymmetric tag/);
	});

	test("dynamic close with no matching dynamic open throws", () => {
		const tag = "div";
		expect(() => parse`</${tag}>`).toThrow(/Asymmetric tag/);
	});

	test("nested dynamic + static stays balanced", () => {
		const outer = "section";
		const parsed = parse`<${outer}><div>text</div></${outer}>`;

		expect(tagBindings(parsed.bindings)).toHaveLength(1);
	});

	test("static self-closing tag with space produces sibling, not parent", () => {
		const parsed = parse`<div />
			<span>after</span>`;
		const fragment = buildFragment(parsed.htmlWithMarkers);
		const div = fragment.querySelector("div")!;
		const span = fragment.querySelector("span")!;
		expect(div).not.toBeNull();
		expect(span).not.toBeNull();
		expect(div.contains(span)).toBe(false);
		expect(div.children).toHaveLength(0);
	});

	test("static self-closing tag without space produces sibling, not parent", () => {
		const parsed = parse`<div/>
			<span>after</span>`;
		const fragment = buildFragment(parsed.htmlWithMarkers);
		const div = fragment.querySelector("div")!;
		const span = fragment.querySelector("span")!;
		expect(div).not.toBeNull();
		expect(span).not.toBeNull();
		expect(div.contains(span)).toBe(false);
		expect(div.children).toHaveLength(0);
	});

	test("static self-closing tag does not include slash in tag name", () => {
		const parsed = parse`<div />`;
		const fragment = buildFragment(parsed.htmlWithMarkers);
		const div = fragment.querySelector("div")!;
		expect(div).not.toBeNull();
		expect(div.tagName).toBe("DIV");
	});

	test("static self-closing tag with attributes preserves them", () => {
		const parsed = parse`<div id="alone" class="solo" />
			<span>after</span>`;
		const fragment = buildFragment(parsed.htmlWithMarkers);
		const div = fragment.querySelector("div")!;
		expect(div.getAttribute("id")).toBe("alone");
		expect(div.getAttribute("class")).toBe("solo");
		expect(div.children).toHaveLength(0);
	});

	test("static self-closing tag with dynamic attribute keeps related-attribute wiring", () => {
		const cls = "red";
		const parsed = parse`<div class="${cls}" />
			<span>after</span>`;
		const fragment = buildFragment(parsed.htmlWithMarkers);
		const div = fragment.querySelector("div")!;
		const span = fragment.querySelector("span")!;
		expect(div.contains(span)).toBe(false);

		const attrBinding = parsed.bindings[0] as SingleValueAttributeStaticBinding;
		expect(attrBinding.type).toBe(BINDING.SINGLE_VALUE_ATTRIBUTE);
		expect(attrBinding.nameParts).toEqual(["class"]);
	});

	test("dynamic self-closing tag produces a placeholder element with no children", () => {
		const tag = "br";
		const parsed = parse`<${tag} /><span>after</span>`;
		const fragment = buildFragment(parsed.htmlWithMarkers);
		const placeholder = fragment.querySelector("div")!;
		const span = fragment.querySelector("span")!;
		expect(placeholder).not.toBeNull();
		expect(span).not.toBeNull();
		expect(placeholder.contains(span)).toBe(false);
		expect(placeholder.children).toHaveLength(0);
	});

	test("self-closing dynamic tag does not leak into the open-tag stack", () => {
		const first = "br";
		const second = "div";
		const parsed = parse`<${first} /><${second}>x</${second}>`;

		expect(tagBindings(parsed.bindings)).toHaveLength(2);
		expect(parsed.bindings.map((b) => b.type)).toEqual([
			BINDING.TAG,
			BINDING.TAG,
		]);
	});
});
