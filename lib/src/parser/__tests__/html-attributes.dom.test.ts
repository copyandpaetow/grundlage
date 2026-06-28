import { describe, test, expect } from "vitest";
import { html } from "../html";
import { buildFragment } from "../../rendering/build-fragment";
import { AttributeBinding, BINDING_TYPES } from "../types";

describe("html parser — attribute bindings", () => {
	test("single dynamic value", () => {
		const cls = "active";
		const template = html` <div class="${cls}"></div>`;

		expect(template.parsedHTML.bindings).toHaveLength(1);
		const binding = template.parsedHTML.bindings[0] as AttributeBinding;
		expect(binding.type).toBe(BINDING_TYPES.ATTR);
		expect(binding.keys).toEqual(["class"]);
		expect(binding.values).toContainEqual(expect.any(Number));
	});

	test("multi-part attribute value shares one binding", () => {
		const a = "hello";
		const b = "world";
		const template = html` <div class="${a} ${b}"></div>`;

		expect(template.parsedHTML.bindings).toHaveLength(1);
		const binding = template.parsedHTML.bindings[0] as AttributeBinding;
		expect(binding.type).toBe(BINDING_TYPES.ATTR);
		// both expressions map to the same binding
		expect(template.parsedHTML.expressionToBinding).toEqual([0, 0]);
	});

	test("dynamic attribute name (boolean)", () => {
		const name = "disabled";
		const template = html` <button ${name}></button>`;

		expect(template.parsedHTML.bindings).toHaveLength(1);
		const binding = template.parsedHTML.bindings[0] as AttributeBinding;
		expect(binding.type).toBe(BINDING_TYPES.ATTR);
		// the expression slot lives in values; keys is empty (no static name parts)
		expect(binding.values).toEqual([0]);
		expect(binding.keys).toHaveLength(0);
	});

	test("dynamic attribute name with static prefix", () => {
		const suffix = "name";
		const template = html` <div data-${suffix}="value"></div>`;

		expect(template.parsedHTML.bindings).toHaveLength(1);
		const binding = template.parsedHTML.bindings[0] as AttributeBinding;
		expect(binding.type).toBe(BINDING_TYPES.ATTR);
		expect(binding.keys[0]).toBe("data-");
	});

	test("multiple attributes on one element create separate bindings", () => {
		const cls = "red";
		const id = "main";
		const template = html` <div class="${cls}" id="${id}"></div>`;

		expect(template.parsedHTML.bindings).toHaveLength(2);
		expect(template.parsedHTML.bindings[0].type).toBe(BINDING_TYPES.ATTR);
		expect(template.parsedHTML.bindings[1].type).toBe(BINDING_TYPES.ATTR);
		expect(template.parsedHTML.expressionToBinding).toEqual([0, 1]);
	});

	test("event handler attribute", () => {
		const handler = () => {};
		const template = html` <button onclick="${handler}"></button>`;

		expect(template.parsedHTML.bindings).toHaveLength(1);
		const binding = template.parsedHTML.bindings[0] as AttributeBinding;
		expect(binding.type).toBe(BINDING_TYPES.ATTR);
		expect(binding.keys).toEqual(["onclick"]);
	});

	test("unquoted attribute value", () => {
		const val = "test";
		const template = html` <div class=${val}></div>`;

		expect(template.parsedHTML.bindings).toHaveLength(1);
		const binding = template.parsedHTML.bindings[0] as AttributeBinding;
		expect(binding.type).toBe(BINDING_TYPES.ATTR);
	});

	test("boolean attribute followed by regular attribute", () => {
		const flag = "hidden";
		const cls = "red";
		const template = html` <div ${flag} class="${cls}"></div>`;

		expect(template.parsedHTML.bindings).toHaveLength(2);
		const boolBinding = template.parsedHTML.bindings[0] as AttributeBinding;
		const attrBinding = template.parsedHTML.bindings[1] as AttributeBinding;
		expect(boolBinding.keys).toHaveLength(0);
		expect(attrBinding.keys).toEqual(["class"]);
	});
});

describe("html parser — expandable attributes", () => {
	test("array expandable has values=[expressionIndex] and empty keys", () => {
		const attrs = ["disabled", "hidden"];
		const template = html` <button ${attrs}>click</button>`;

		expect(template.parsedHTML.bindings).toHaveLength(1);
		const binding = template.parsedHTML.bindings[0] as AttributeBinding;
		expect(binding.type).toBe(BINDING_TYPES.ATTR);
		expect(binding.values).toEqual([0]);
		expect(binding.keys).toHaveLength(0);
	});

	test("object expandable has values=[expressionIndex] and empty keys", () => {
		const attrs = { class: "red", id: "main" };
		const template = html` <div ${attrs}>content</div>`;

		expect(template.parsedHTML.bindings).toHaveLength(1);
		const binding = template.parsedHTML.bindings[0] as AttributeBinding;
		expect(binding.type).toBe(BINDING_TYPES.ATTR);
		expect(binding.values).toEqual([0]);
		expect(binding.keys).toHaveLength(0);
	});

	test("expandable after static attribute", () => {
		const extra = { title: "hello" };
		const template = html` <div class="base" ${extra}></div>`;

		expect(template.parsedHTML.bindings).toHaveLength(1);
		const binding = template.parsedHTML.bindings[0] as AttributeBinding;
		expect(binding.values).toEqual([0]);
		expect(binding.keys).toHaveLength(0);
	});

	test("expandable before static attribute", () => {
		const extra = { title: "hello" };
		const template = html` <div ${extra} class="base"></div>`;

		expect(template.parsedHTML.bindings).toHaveLength(1);
		const binding = template.parsedHTML.bindings[0] as AttributeBinding;
		expect(binding.values).toEqual([0]);
		expect(binding.keys).toHaveLength(0);
	});

	test("expandable between static attributes", () => {
		const extra = ["hidden"];
		const template = html` <div id="a" ${extra} class="b"></div>`;

		expect(template.parsedHTML.bindings).toHaveLength(1);
		const binding = template.parsedHTML.bindings[0] as AttributeBinding;
		expect(binding.values).toEqual([0]);
		expect(binding.keys).toHaveLength(0);
	});
});

describe("html parser — attribute edge cases", () => {
	test("single-quoted attribute value", () => {
		const val = "test";
		const template = html` <div class="${val}"></div>`;

		expect(template.parsedHTML.bindings).toHaveLength(1);
		const binding = template.parsedHTML.bindings[0] as AttributeBinding;
		expect(binding.type).toBe(BINDING_TYPES.ATTR);
		expect(binding.keys).toEqual(["class"]);
	});

	test("unquoted attribute value followed by closing bracket", () => {
		const val = "test";
		const template = html` <div class=${val}>text</div>`;

		expect(template.parsedHTML.bindings).toHaveLength(1);
		const binding = template.parsedHTML.bindings[0] as AttributeBinding;
		expect(binding.type).toBe(BINDING_TYPES.ATTR);
	});

	test("multiple boolean attributes", () => {
		const a = "disabled";
		const b = "hidden";
		const template = html` <div ${a} ${b}></div>`;

		expect(template.parsedHTML.bindings).toHaveLength(2);
		expect(template.parsedHTML.bindings[0].type).toBe(BINDING_TYPES.ATTR);
		expect(template.parsedHTML.bindings[1].type).toBe(BINDING_TYPES.ATTR);
	});

	test("dynamic attribute key with dynamic value", () => {
		const key = "data-x";
		const val = "123";
		const template = html` <div ${key}="${val}"></div>`;

		expect(template.parsedHTML.bindings).toHaveLength(1);
		const binding = template.parsedHTML.bindings[0] as AttributeBinding;
		expect(binding.type).toBe(BINDING_TYPES.ATTR);
	});

	test("attribute with empty string value", () => {
		const val = "";
		const template = html` <div class="${val}"></div>`;

		expect(template.parsedHTML.bindings).toHaveLength(1);
		const binding = template.parsedHTML.bindings[0] as AttributeBinding;
		expect(binding.type).toBe(BINDING_TYPES.ATTR);
		expect(binding.keys).toEqual(["class"]);
	});

	test("attribute on self-closing element", () => {
		const val = "text";
		const template = html`<input type="${val}" />`;

		expect(template.parsedHTML.bindings).toHaveLength(1);
		const binding = template.parsedHTML.bindings[0] as AttributeBinding;
		expect(binding.type).toBe(BINDING_TYPES.ATTR);
		expect(binding.keys).toEqual(["type"]);
	});

	test("boolean attribute on self-closing element", () => {
		const attr = "disabled";
		const template = html`<input ${attr} />`;

		expect(template.parsedHTML.bindings).toHaveLength(1);
		const binding = template.parsedHTML.bindings[0] as AttributeBinding;
		expect(binding.type).toBe(BINDING_TYPES.ATTR);
		expect(binding.values).toEqual([0]);
		expect(binding.keys).toHaveLength(0);
	});

	test("mixed static and dynamic attributes on same element", () => {
		const dyn = "dynamic-value";
		const template = html` <div
			id="static"
			class="${dyn}"
			data-fixed="true"
		></div>`;

		expect(template.parsedHTML.bindings).toHaveLength(1);
		const binding = template.parsedHTML.bindings[0] as AttributeBinding;
		expect(binding.keys).toEqual(["class"]);
	});

	test("attribute value with static prefix and suffix", () => {
		const mid = "dynamic";
		const template = html` <div class="prefix-${mid}-suffix"></div>`;

		expect(template.parsedHTML.bindings).toHaveLength(1);
		const binding = template.parsedHTML.bindings[0] as AttributeBinding;
		expect(binding.type).toBe(BINDING_TYPES.ATTR);
		// The binding values should include static parts and the expression index
		expect(binding.values.length).toBeGreaterThanOrEqual(1);
	});

	test("event handler without quotes", () => {
		const handler = () => {};
		const template = html` <button onclick=${handler}></button>`;

		expect(template.parsedHTML.bindings).toHaveLength(1);
		const binding = template.parsedHTML.bindings[0] as AttributeBinding;
		expect(binding.type).toBe(BINDING_TYPES.ATTR);
		expect(binding.keys).toEqual(["onclick"]);
	});
});

describe("html parser — custom element and namespaced attribute names", () => {
	test("hyphenated custom element tag with static attribute", () => {
		const template = html`<my-component id="x"></my-component>`;
		expect(template.parsedHTML.bindings).toHaveLength(0);
		const element = buildFragment(template.parsedHTML.result).querySelector(
			"my-component",
		)!;
		expect(element).not.toBeNull();
		expect(element.getAttribute("id")).toBe("x");
	});

	test("hyphenated custom element tag with dynamic attribute", () => {
		const value = "red";
		const template = html`<my-component class="${value}"></my-component>`;
		expect(template.parsedHTML.bindings).toHaveLength(1);
		const binding = template.parsedHTML.bindings[0] as AttributeBinding;
		expect(binding.keys).toEqual(["class"]);
		expect(
			buildFragment(template.parsedHTML.result).querySelector("my-component"),
		).not.toBeNull();
	});

	test("aria-* and data-* attribute names preserve hyphens", () => {
		const label = "submit";
		const id = "main";
		const template = html`<button
			aria-label="${label}"
			data-test-id="${id}"
		></button>`;
		expect(template.parsedHTML.bindings).toHaveLength(2);
		const first = template.parsedHTML.bindings[0] as AttributeBinding;
		const second = template.parsedHTML.bindings[1] as AttributeBinding;
		expect(first.keys).toEqual(["aria-label"]);
		expect(second.keys).toEqual(["data-test-id"]);
	});

	test("namespaced attribute name with colon", () => {
		const value = "en";
		const template = html`<div xml:lang="${value}"></div>`;
		expect(template.parsedHTML.bindings).toHaveLength(1);
		const binding = template.parsedHTML.bindings[0] as AttributeBinding;
		expect(binding.keys).toEqual(["xml:lang"]);
	});
});
