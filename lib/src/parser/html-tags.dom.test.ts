import { describe, expect, test } from "vitest";
import { html } from "./html";
import { AttributeBinding, BINDING_TYPES, TagBinding } from "./types";

describe("html parser — tag bindings", () => {
	test("dynamic tag name", () => {
		const tag = "div";
		const template = html`
			<${tag}>content</${tag}>`;

		expect(template.parsedHTML.bindings).toHaveLength(1);
		const binding = template.parsedHTML.bindings[0] as TagBinding;
		expect(binding.type).toBe(BINDING_TYPES.TAG);
	});

	test("dynamic tag with attributes tracks related bindings", () => {
		const tag = "div";
		const cls = "red";
		const template = html`
			<${tag} class="${cls}">content</${tag}>`;

		const tagBinding = template.parsedHTML.bindings[0] as TagBinding;
		expect(tagBinding.type).toBe(BINDING_TYPES.TAG);
		expect(tagBinding.relatedAttributes.length).toBeGreaterThan(0);
	});

	test("dynamic tag end tag maps to same binding as open tag", () => {
		const tag = "div";
		const template = html`
			<${tag}>content</${tag}>`;

		// Open and close tag expressions should map to the same binding
		expect(template.parsedHTML.expressionToBinding).toEqual([0, 0]);
	});

	test("dynamic self-closing tag", () => {
		const tag = "br";
		const template = html` <${tag} />`;

		expect(template.parsedHTML.bindings).toHaveLength(1);
		const binding = template.parsedHTML.bindings[0] as TagBinding;
		expect(binding.type).toBe(BINDING_TYPES.TAG);
	});

	test("dynamic tag with dynamic attribute", () => {
		const tag = "div";
		const cls = "red";
		const template = html`
			<${tag} class="${cls}">text</${tag}>`;

		const tagBinding = template.parsedHTML.bindings[0] as TagBinding;
		expect(tagBinding.type).toBe(BINDING_TYPES.TAG);
		expect(tagBinding.relatedAttributes).toHaveLength(1);

		const attrBinding = template.parsedHTML.bindings[1] as AttributeBinding;
		expect(attrBinding.type).toBe(BINDING_TYPES.ATTR);
		expect(attrBinding.keys).toEqual(["class"]);
	});

	test("dynamic tag with multiple dynamic attributes", () => {
		const tag = "div";
		const cls = "red";
		const id = "main";
		const template = html`
			<${tag} class="${cls}" id="${id}">text</${tag}>`;

		const tagBinding = template.parsedHTML.bindings[0] as TagBinding;
		expect(tagBinding.type).toBe(BINDING_TYPES.TAG);
		expect(tagBinding.relatedAttributes).toHaveLength(2);
	});

	test("dynamic tag with boolean attribute", () => {
		const tag = "button";
		const attr = "disabled";
		const template = html`
			<${tag} ${attr}>click</${tag}>`;

		const tagBinding = template.parsedHTML.bindings[0] as TagBinding;
		expect(tagBinding.type).toBe(BINDING_TYPES.TAG);
		expect(tagBinding.relatedAttributes).toHaveLength(1);
	});

	test("nested dynamic tags", () => {
		const outer = "div";
		const inner = "span";
		const template = html`
			<${outer}>
				<${inner}>text</${inner}>
			</${outer}>`;

		const bindings = template.parsedHTML.bindings;
		expect(bindings.filter((b) => b.type === BINDING_TYPES.TAG)).toHaveLength(
			2,
		);
	});

	test("dynamic tag with no content", () => {
		const tag = "div";
		const template = html`
			<${tag}></${tag}>`;

		expect(template.parsedHTML.bindings).toHaveLength(1);
		const binding = template.parsedHTML.bindings[0] as TagBinding;
		expect(binding.type).toBe(BINDING_TYPES.TAG);
	});

	test("dynamic tag with static attributes preserved", () => {
		const tag = "div";
		const template = html`
			<${tag} class="static" id="fixed">text</${tag}>`;

		// Only 1 binding (the tag), static attributes are not bindings
		expect(template.parsedHTML.bindings).toHaveLength(1);
		expect(template.parsedHTML.bindings[0].type).toBe(BINDING_TYPES.TAG);
	});

	test("dynamic open paired with static close throws", () => {
		const tag = "div";
		expect(() => html`<${tag}>content</div>`).toThrow(/Asymmetric tag/);
	});

	test("static open paired with dynamic close throws", () => {
		const tag = "div";
		expect(() => html`<div>content</${tag}>`).toThrow(/Asymmetric tag/);
	});

	test("dynamic close with no matching dynamic open throws", () => {
		const tag = "div";
		expect(() => html`</${tag}>`).toThrow(/Asymmetric tag/);
	});

	test("nested dynamic + static stays balanced", () => {
		const outer = "section";
		const template = html`<${outer}><div>text</div></${outer}>`;

		const tagBindings = template.parsedHTML.bindings.filter(
			(b) => b.type === BINDING_TYPES.TAG,
		);
		expect(tagBindings).toHaveLength(1);
	});

	test("static self-closing tag with space produces sibling, not parent", () => {
		const template = html`<div />
			<span>after</span>`;
		const fragment = template.parsedHTML.fragment;
		const div = fragment.querySelector("div")!;
		const span = fragment.querySelector("span")!;
		expect(div).not.toBeNull();
		expect(span).not.toBeNull();
		expect(div.contains(span)).toBe(false);
		expect(div.children).toHaveLength(0);
	});

	test("static self-closing tag without space produces sibling, not parent", () => {
		const template = html`<div />
			<span>after</span>`;
		const fragment = template.parsedHTML.fragment;
		const div = fragment.querySelector("div")!;
		const span = fragment.querySelector("span")!;
		expect(div).not.toBeNull();
		expect(span).not.toBeNull();
		expect(div.contains(span)).toBe(false);
		expect(div.children).toHaveLength(0);
	});

	test("static self-closing tag does not include slash in tag name", () => {
		const template = html`<div />`;
		const fragment = template.parsedHTML.fragment;
		const div = fragment.querySelector("div")!;
		expect(div).not.toBeNull();
		expect(div.tagName).toBe("DIV");
	});

	test("static self-closing tag with attributes preserves them", () => {
		const template = html`<div id="alone" class="solo" />
			<span>after</span>`;
		const fragment = template.parsedHTML.fragment;
		const div = fragment.querySelector("div")!;
		expect(div.getAttribute("id")).toBe("alone");
		expect(div.getAttribute("class")).toBe("solo");
		expect(div.children).toHaveLength(0);
	});

	test("static self-closing tag with dynamic attribute keeps related-attribute wiring", () => {
		const cls = "red";
		const template = html`<div class="${cls}" />
			<span>after</span>`;
		const fragment = template.parsedHTML.fragment;
		const div = fragment.querySelector("div")!;
		const span = fragment.querySelector("span")!;
		expect(div.contains(span)).toBe(false);

		const attrBinding = template.parsedHTML.bindings[0] as AttributeBinding;
		expect(attrBinding.type).toBe(BINDING_TYPES.ATTR);
		expect(attrBinding.keys).toEqual(["class"]);
	});

	test("dynamic self-closing tag produces a placeholder element with no children", () => {
		const tag = "br";
		const template = html`<${tag} /><span>after</span>`;
		const fragment = template.parsedHTML.fragment;
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
		// If self-close didn't pop, the second close would resolve to `first` and
		// the templates would be silently mis-paired.
		const template = html`<${first} /><${second}>x</${second}>`;

		const tagBindings = template.parsedHTML.bindings.filter(
			(b) => b.type === BINDING_TYPES.TAG,
		);
		expect(tagBindings).toHaveLength(2);
		// Second tag's close maps back to its own binding, not the first's.
		expect(template.parsedHTML.expressionToBinding).toEqual([0, 1, 1]);
	});
});
