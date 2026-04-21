import { describe, test, expect } from "vitest";
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
});
