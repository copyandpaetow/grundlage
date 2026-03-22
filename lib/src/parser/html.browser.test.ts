import { describe, test, expect } from "vitest";
import { html } from "./html";
import { BINDING_TYPES } from "./types";

describe("html parser", () => {
	test("static template produces no bindings", () => {
		const template = html`<div>hello</div>`;
		expect(template.parsedHTML.bindings).toHaveLength(0);
		expect(template.parsedHTML.expressionToBinding).toHaveLength(0);
	});

	test("text expression creates a content binding", () => {
		const name = "world";
		const template = html`<div>${name}</div>`;

		expect(template.parsedHTML.bindings).toHaveLength(1);
		expect(template.parsedHTML.bindings[0].type).toBe(BINDING_TYPES.CONTENT);
		expect(template.currentExpressions).toEqual(["world"]);
	});

	test("attribute expression creates an attribute binding", () => {
		const cls = "active";
		const template = html`<div class="${cls}"></div>`;

		expect(template.parsedHTML.bindings).toHaveLength(1);
		expect(template.parsedHTML.bindings[0].type).toBe(BINDING_TYPES.ATTR);
	});

	test("same template strings reuse cached parse result", () => {
		const a = html`<span>${"one"}</span>`;
		const b = html`<span>${"two"}</span>`;

		expect(a.parsedHTML).toStrictEqual(b.parsedHTML);
		expect(a.currentExpressions).toEqual(["one"]);
		expect(b.currentExpressions).toEqual(["two"]);
	});
});
