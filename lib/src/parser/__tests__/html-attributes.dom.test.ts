import { describe, test, expect } from "vitest";
import { getParsedTemplate } from "../html";
import { buildFragment } from "../../rendering/dom";
import { BINDING } from "../constants";
import {
	AttributeStaticBinding,
	NamedDynamicStaticBinding,
	SingleValueAttributeStaticBinding,
} from "../types";

const parse = (strings: TemplateStringsArray, ..._values: Array<unknown>) =>
	getParsedTemplate(strings);

describe("html parser — attribute bindings", () => {
	test("single dynamic value lowers to a single-value attribute", () => {
		const cls = "active";
		const parsed = parse` <div class="${cls}"></div>`;

		expect(parsed.bindings).toHaveLength(1);
		const binding = parsed.bindings[0] as SingleValueAttributeStaticBinding;
		expect(binding.type).toBe(BINDING.SINGLE_VALUE_ATTRIBUTE);
		expect(binding.nameParts).toEqual(["class"]);
		expect(binding.valueIndex).toBe(0);
	});

	test("multi-part attribute value shares one composed binding", () => {
		const a = "hello";
		const b = "world";
		const parsed = parse` <div class="${a} ${b}"></div>`;

		expect(parsed.bindings).toHaveLength(1);
		const binding = parsed.bindings[0] as AttributeStaticBinding;
		expect(binding.type).toBe(BINDING.ATTRIBUTE);
		expect(binding.valueParts).toEqual([0, " ", 1]);
	});

	test("dynamic attribute name (boolean) lowers to a spread", () => {
		const name = "disabled";
		const parsed = parse` <button ${name}></button>`;

		expect(parsed.bindings).toHaveLength(1);
		expect(parsed.bindings[0].type).toBe(BINDING.DYNAMIC_ATTRIBUTE);
		expect(
			(parsed.bindings[0] as { valueIndex: number }).valueIndex,
		).toBe(0);
	});

	test("dynamic attribute name with static prefix and static value", () => {
		const suffix = "name";
		const parsed = parse` <div data-${suffix}="value"></div>`;

		expect(parsed.bindings).toHaveLength(1);
		const binding = parsed.bindings[0] as AttributeStaticBinding;
		expect(binding.type).toBe(BINDING.ATTRIBUTE);
		expect(binding.nameParts).toEqual(["data-", 0]);
		expect(binding.valueParts).toEqual(["value"]);
	});

	test("multiple attributes on one element create separate bindings", () => {
		const cls = "red";
		const id = "main";
		const parsed = parse` <div class="${cls}" id="${id}"></div>`;

		expect(parsed.bindings.map((binding) => binding.type)).toEqual([
			BINDING.SINGLE_VALUE_ATTRIBUTE,
			BINDING.SINGLE_VALUE_ATTRIBUTE,
		]);
	});

	test("event handler attribute lowers to a named-dynamic binding", () => {
		const handler = () => {};
		const parsed = parse` <button onclick="${handler}"></button>`;

		expect(parsed.bindings).toHaveLength(1);
		const binding = parsed.bindings[0] as NamedDynamicStaticBinding;
		expect(binding.type).toBe(BINDING.NAMED_DYNAMIC);
		expect(binding.name).toBe("onclick");
		expect(binding.valueIndex).toBe(0);
	});

	test("unquoted attribute value", () => {
		const val = "test";
		const parsed = parse` <div class=${val}></div>`;

		expect(parsed.bindings).toHaveLength(1);
		expect(parsed.bindings[0].type).toBe(BINDING.SINGLE_VALUE_ATTRIBUTE);
	});

	test("boolean (spread) attribute followed by regular attribute", () => {
		const flag = "hidden";
		const cls = "red";
		const parsed = parse` <div ${flag} class="${cls}"></div>`;

		expect(parsed.bindings.map((binding) => binding.type)).toEqual([
			BINDING.DYNAMIC_ATTRIBUTE,
			BINDING.SINGLE_VALUE_ATTRIBUTE,
		]);
		expect((parsed.bindings[1] as SingleValueAttributeStaticBinding).nameParts).toEqual(
			["class"],
		);
	});
});

describe("html parser — expandable attributes", () => {
	test("array expandable is a dynamic attribute at the expression index", () => {
		const attrs = ["disabled", "hidden"];
		const parsed = parse` <button ${attrs}>click</button>`;

		expect(parsed.bindings).toHaveLength(1);
		expect(parsed.bindings[0].type).toBe(BINDING.DYNAMIC_ATTRIBUTE);
		expect((parsed.bindings[0] as { valueIndex: number }).valueIndex).toBe(0);
	});

	test("object expandable is a dynamic attribute at the expression index", () => {
		const attrs = { class: "red", id: "main" };
		const parsed = parse` <div ${attrs}>content</div>`;

		expect(parsed.bindings).toHaveLength(1);
		expect(parsed.bindings[0].type).toBe(BINDING.DYNAMIC_ATTRIBUTE);
		expect((parsed.bindings[0] as { valueIndex: number }).valueIndex).toBe(0);
	});

	test("expandable after static attribute", () => {
		const extra = { title: "hello" };
		const parsed = parse` <div class="base" ${extra}></div>`;

		expect(parsed.bindings).toHaveLength(1);
		expect(parsed.bindings[0].type).toBe(BINDING.DYNAMIC_ATTRIBUTE);
	});

	test("expandable before static attribute", () => {
		const extra = { title: "hello" };
		const parsed = parse` <div ${extra} class="base"></div>`;

		expect(parsed.bindings).toHaveLength(1);
		expect(parsed.bindings[0].type).toBe(BINDING.DYNAMIC_ATTRIBUTE);
	});

	test("expandable between static attributes", () => {
		const extra = ["hidden"];
		const parsed = parse` <div id="a" ${extra} class="b"></div>`;

		expect(parsed.bindings).toHaveLength(1);
		expect(parsed.bindings[0].type).toBe(BINDING.DYNAMIC_ATTRIBUTE);
	});
});

describe("html parser — attribute edge cases", () => {
	test("single-quoted attribute value", () => {
		const val = "test";
		const parsed = parse` <div class="${val}"></div>`;

		expect(parsed.bindings).toHaveLength(1);
		const binding = parsed.bindings[0] as SingleValueAttributeStaticBinding;
		expect(binding.type).toBe(BINDING.SINGLE_VALUE_ATTRIBUTE);
		expect(binding.nameParts).toEqual(["class"]);
	});

	test("unquoted attribute value followed by closing bracket", () => {
		const val = "test";
		const parsed = parse` <div class=${val}>text</div>`;

		expect(parsed.bindings).toHaveLength(1);
		expect(parsed.bindings[0].type).toBe(BINDING.SINGLE_VALUE_ATTRIBUTE);
	});

	test("multiple boolean (spread) attributes", () => {
		const a = "disabled";
		const b = "hidden";
		const parsed = parse` <div ${a} ${b}></div>`;

		expect(parsed.bindings.map((binding) => binding.type)).toEqual([
			BINDING.DYNAMIC_ATTRIBUTE,
			BINDING.DYNAMIC_ATTRIBUTE,
		]);
	});

	test("dynamic attribute key with dynamic value", () => {
		const key = "data-x";
		const val = "123";
		const parsed = parse` <div ${key}="${val}"></div>`;

		expect(parsed.bindings).toHaveLength(1);
		const binding = parsed.bindings[0] as SingleValueAttributeStaticBinding;
		expect(binding.type).toBe(BINDING.SINGLE_VALUE_ATTRIBUTE);
		expect(binding.nameParts).toEqual([0]);
		expect(binding.valueIndex).toBe(1);
	});

	test("attribute with empty string value", () => {
		const val = "";
		const parsed = parse` <div class="${val}"></div>`;

		expect(parsed.bindings).toHaveLength(1);
		const binding = parsed.bindings[0] as SingleValueAttributeStaticBinding;
		expect(binding.type).toBe(BINDING.SINGLE_VALUE_ATTRIBUTE);
		expect(binding.nameParts).toEqual(["class"]);
	});

	test("attribute on self-closing element", () => {
		const val = "text";
		const parsed = parse`<input type="${val}" />`;

		expect(parsed.bindings).toHaveLength(1);
		const binding = parsed.bindings[0] as SingleValueAttributeStaticBinding;
		expect(binding.type).toBe(BINDING.SINGLE_VALUE_ATTRIBUTE);
		expect(binding.nameParts).toEqual(["type"]);
	});

	test("boolean (spread) attribute on self-closing element", () => {
		const attr = "disabled";
		const parsed = parse`<input ${attr} />`;

		expect(parsed.bindings).toHaveLength(1);
		expect(parsed.bindings[0].type).toBe(BINDING.DYNAMIC_ATTRIBUTE);
		expect((parsed.bindings[0] as { valueIndex: number }).valueIndex).toBe(0);
	});

	test("mixed static and dynamic attributes on same element", () => {
		const dyn = "dynamic-value";
		const parsed = parse` <div
			id="static"
			class="${dyn}"
			data-fixed="true"
		></div>`;

		expect(parsed.bindings).toHaveLength(1);
		const binding = parsed.bindings[0] as SingleValueAttributeStaticBinding;
		expect(binding.nameParts).toEqual(["class"]);
	});

	test("attribute value with static prefix and suffix", () => {
		const mid = "dynamic";
		const parsed = parse` <div class="prefix-${mid}-suffix"></div>`;

		expect(parsed.bindings).toHaveLength(1);
		const binding = parsed.bindings[0] as AttributeStaticBinding;
		expect(binding.type).toBe(BINDING.ATTRIBUTE);
		expect(binding.valueParts).toEqual(["prefix-", 0, "-suffix"]);
	});

	test("event handler without quotes lowers to a named-dynamic binding", () => {
		const handler = () => {};
		const parsed = parse` <button onclick=${handler}></button>`;

		expect(parsed.bindings).toHaveLength(1);
		const binding = parsed.bindings[0] as NamedDynamicStaticBinding;
		expect(binding.type).toBe(BINDING.NAMED_DYNAMIC);
		expect(binding.name).toBe("onclick");
	});

	test("an on-prefixed non-handler keeps its whole name (no eventType slice)", () => {
		const value = () => {};
		//the whole name survives to commit-time resolution; the old bug sliced "once" → event "ce"
		const once = parse` <button once=${value}></button>`
			.bindings[0] as NamedDynamicStaticBinding;
		expect(once.type).toBe(BINDING.NAMED_DYNAMIC);
		expect(once.name).toBe("once");

		const online = parse` <button online=${value}></button>`
			.bindings[0] as NamedDynamicStaticBinding;
		expect(online.type).toBe(BINDING.NAMED_DYNAMIC);
		expect(online.name).toBe("online");
	});
});

describe("html parser — custom element and namespaced attribute names", () => {
	test("hyphenated custom element tag with static attribute", () => {
		const parsed = parse`<my-component id="x"></my-component>`;
		expect(parsed.bindings).toHaveLength(0);
		const element = buildFragment(parsed.htmlWithMarkers).querySelector(
			"my-component",
		)!;
		expect(element).not.toBeNull();
		expect(element.getAttribute("id")).toBe("x");
	});

	test("hyphenated custom element tag with dynamic attribute", () => {
		const value = "red";
		const parsed = parse`<my-component class="${value}"></my-component>`;
		expect(parsed.bindings).toHaveLength(1);
		const binding = parsed.bindings[0] as SingleValueAttributeStaticBinding;
		expect(binding.nameParts).toEqual(["class"]);
		expect(
			buildFragment(parsed.htmlWithMarkers).querySelector("my-component"),
		).not.toBeNull();
	});

	test("aria-* and data-* attribute names preserve hyphens", () => {
		const label = "submit";
		const id = "main";
		const parsed = parse`<button
			aria-label="${label}"
			data-test-id="${id}"
		></button>`;
		expect(parsed.bindings).toHaveLength(2);
		const first = parsed.bindings[0] as SingleValueAttributeStaticBinding;
		const second = parsed.bindings[1] as SingleValueAttributeStaticBinding;
		expect(first.nameParts).toEqual(["aria-label"]);
		expect(second.nameParts).toEqual(["data-test-id"]);
	});

	test("namespaced attribute name with colon", () => {
		const value = "en";
		const parsed = parse`<div xml:lang="${value}"></div>`;
		expect(parsed.bindings).toHaveLength(1);
		const binding = parsed.bindings[0] as SingleValueAttributeStaticBinding;
		expect(binding.nameParts).toEqual(["xml:lang"]);
	});
});
