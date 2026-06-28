import { describe, test, expect } from "vitest";
import { html } from "../html";
import { BINDING_TYPES } from "../types";

describe("html parser — content bindings", () => {
	test("text expression creates a content binding", () => {
		const name = "world";
		const template = html` <div>${name}</div>`;

		expect(template.parsedHTML.bindings).toHaveLength(1);
		expect(template.parsedHTML.bindings[0].type).toBe(BINDING_TYPES.CONTENT);
		expect(template.currentExpressions).toEqual(["world"]);
	});

	test("multiple text expressions create separate bindings", () => {
		const a = "hello";
		const b = "world";
		const template = html`<p>${a}</p>
			<p>${b}</p>`;

		expect(template.parsedHTML.bindings).toHaveLength(2);
		expect(template.parsedHTML.bindings[0].type).toBe(BINDING_TYPES.CONTENT);
		expect(template.parsedHTML.bindings[1].type).toBe(BINDING_TYPES.CONTENT);
		expect(template.parsedHTML.expressionToBinding).toEqual([0, 1]);
	});

	test("adjacent text expressions share no binding", () => {
		const a = "hello";
		const b = "world";
		const template = html` <div>${a}${b}</div>`;

		expect(template.parsedHTML.bindings).toHaveLength(2);
		expect(template.parsedHTML.expressionToBinding).toEqual([0, 1]);
	});

	test("expression between static text", () => {
		const name = "world";
		const template = html` <div>hello ${name} goodbye</div>`;

		expect(template.parsedHTML.bindings).toHaveLength(1);
		expect(template.parsedHTML.bindings[0].type).toBe(BINDING_TYPES.CONTENT);
	});

	test("nested template expression", () => {
		const inner = html`<span>child</span>`;
		const template = html` <div>${inner}</div>`;

		expect(template.parsedHTML.bindings).toHaveLength(1);
		expect(template.parsedHTML.bindings[0].type).toBe(BINDING_TYPES.CONTENT);
	});

	test("array expression", () => {
		const items = [1, 2, 3];
		const template = html` <ul>
			${items}
		</ul>`;

		expect(template.parsedHTML.bindings).toHaveLength(1);
		expect(template.parsedHTML.bindings[0].type).toBe(BINDING_TYPES.CONTENT);
	});

	test("expression between two static text nodes in same element", () => {
		const mid = "middle";
		const template = html`<p>start ${mid} end</p>`;

		expect(template.parsedHTML.bindings).toHaveLength(1);
		expect(template.parsedHTML.bindings[0].type).toBe(BINDING_TYPES.CONTENT);
	});

	test("adjacent expressions with static text between them", () => {
		const a = "hello";
		const b = "world";
		const template = html` <div>${a} and ${b}</div>`;

		expect(template.parsedHTML.bindings).toHaveLength(2);
		expect(template.parsedHTML.expressionToBinding).toEqual([0, 1]);
	});

	test("expression as the only content (no wrapper element)", () => {
		const val = "bare";
		const template = html`${val}`;

		expect(template.parsedHTML.bindings).toHaveLength(1);
		expect(template.parsedHTML.bindings[0].type).toBe(BINDING_TYPES.CONTENT);
	});

	test("three adjacent expressions", () => {
		const a = "x";
		const b = "y";
		const c = "z";
		const template = html`${a}${b}${c}`;

		expect(template.parsedHTML.bindings).toHaveLength(3);
		expect(template.parsedHTML.expressionToBinding).toEqual([0, 1, 2]);
	});

	test("expression after self-closing element", () => {
		const val = "text";
		const template = html`<br />${val}`;

		expect(template.parsedHTML.bindings).toHaveLength(1);
		expect(template.parsedHTML.bindings[0].type).toBe(BINDING_TYPES.CONTENT);
	});

	test("expression before and after an element", () => {
		const before = "pre";
		const after = "post";
		const template = html`${before}
			<div>static</div>
			${after}`;

		expect(template.parsedHTML.bindings).toHaveLength(2);
		expect(template.parsedHTML.bindings[0].type).toBe(BINDING_TYPES.CONTENT);
		expect(template.parsedHTML.bindings[1].type).toBe(BINDING_TYPES.CONTENT);
	});

	test("null expression", () => {
		const val = null;
		const template = html` <div>${val}</div>`;

		expect(template.parsedHTML.bindings).toHaveLength(1);
		expect(template.parsedHTML.bindings[0].type).toBe(BINDING_TYPES.CONTENT);
		expect(template.currentExpressions).toEqual([null]);
	});

	test("undefined expression", () => {
		const val = undefined;
		const template = html` <div>${val}</div>`;

		expect(template.parsedHTML.bindings).toHaveLength(1);
		expect(template.currentExpressions).toEqual([undefined]);
	});

	test("numeric expression", () => {
		const val = 42;
		const template = html` <div>${val}</div>`;

		expect(template.parsedHTML.bindings).toHaveLength(1);
		expect(template.currentExpressions).toEqual([42]);
	});

	test("boolean expression", () => {
		const val = false;
		const template = html` <div>${val}</div>`;

		expect(template.parsedHTML.bindings).toHaveLength(1);
		expect(template.currentExpressions).toEqual([false]);
	});
});
