import { describe, test, expect } from "vitest";
import { getParsedTemplate } from "../html";
import { html } from "../../template";
import * as BINDING from "../binding";
import { ContentStaticBinding } from "../types";

const parse = (strings: TemplateStringsArray, ..._values: Array<unknown>) =>
	getParsedTemplate(strings);

const valueIndices = (parsed: { bindings: ReadonlyArray<{ type: number }> }) =>
	parsed.bindings.map((b) => (b as ContentStaticBinding).valueIndex);

describe("html parser: content bindings", () => {
	test("text expression creates a content binding", () => {
		const name = "world";
		const parsed = parse` <div>${name}</div>`;

		expect(parsed.bindings).toHaveLength(1);
		expect(parsed.bindings[0].type).toBe(BINDING.CONTENT);
		expect(html` <div>${name}</div>`.values).toEqual(["world"]);
	});

	test("multiple text expressions create separate bindings", () => {
		const a = "hello";
		const b = "world";
		const parsed = parse`<p>${a}</p>
			<p>${b}</p>`;

		expect(parsed.bindings.map((binding) => binding.type)).toEqual([
			BINDING.CONTENT,
			BINDING.CONTENT,
		]);
		expect(valueIndices(parsed)).toEqual([0, 1]);
	});

	test("adjacent text expressions share no binding", () => {
		const a = "hello";
		const b = "world";
		const parsed = parse` <div>${a}${b}</div>`;

		expect(parsed.bindings).toHaveLength(2);
		expect(valueIndices(parsed)).toEqual([0, 1]);
	});

	test("a hole between words in a <div> is one content binding", () => {
		const name = "world";
		const parsed = parse` <div>hello ${name} goodbye</div>`;

		expect(parsed.bindings).toHaveLength(1);
		expect(parsed.bindings[0].type).toBe(BINDING.CONTENT);
	});

	test("nested template expression", () => {
		const inner = html`<span>child</span>`;
		const parsed = parse` <div>${inner}</div>`;

		expect(parsed.bindings).toHaveLength(1);
		expect(parsed.bindings[0].type).toBe(BINDING.CONTENT);
	});

	test("a hole holding an array is one content binding", () => {
		const items = [1, 2, 3];
		const parsed = parse` <ul>
			${items}
		</ul>`;

		expect(parsed.bindings).toHaveLength(1);
		expect(parsed.bindings[0].type).toBe(BINDING.CONTENT);
	});

	test("a hole between words in a <p> is one content binding", () => {
		const mid = "middle";
		const parsed = parse`<p>start ${mid} end</p>`;

		expect(parsed.bindings).toHaveLength(1);
		expect(parsed.bindings[0].type).toBe(BINDING.CONTENT);
	});

	test("two holes with text between them are two content bindings in order", () => {
		const a = "hello";
		const b = "world";
		const parsed = parse` <div>${a} and ${b}</div>`;

		expect(parsed.bindings).toHaveLength(2);
		expect(valueIndices(parsed)).toEqual([0, 1]);
	});

	test("a hole as the whole template is one content binding", () => {
		const val = "bare";
		const parsed = parse`${val}`;

		expect(parsed.bindings).toHaveLength(1);
		expect(parsed.bindings[0].type).toBe(BINDING.CONTENT);
	});

	test("three adjacent holes are three content bindings in order", () => {
		const a = "x";
		const b = "y";
		const c = "z";
		const parsed = parse`${a}${b}${c}`;

		expect(parsed.bindings).toHaveLength(3);
		expect(valueIndices(parsed)).toEqual([0, 1, 2]);
	});

	test("a hole after a self-closing element is a content binding", () => {
		const val = "text";
		const parsed = parse`<br />${val}`;

		expect(parsed.bindings).toHaveLength(1);
		expect(parsed.bindings[0].type).toBe(BINDING.CONTENT);
	});

	test("holes before and after an element are two content bindings", () => {
		const before = "pre";
		const after = "post";
		const parsed = parse`${before}
			<div>static</div>
			${after}`;

		expect(parsed.bindings.map((binding) => binding.type)).toEqual([
			BINDING.CONTENT,
			BINDING.CONTENT,
		]);
	});

	test("content binding is created regardless of value type", () => {
		for (const val of [null, undefined, 42, false]) {
			const parsed = parse` <div>${val}</div>`;
			expect(parsed.bindings).toHaveLength(1);
			expect(parsed.bindings[0].type).toBe(BINDING.CONTENT);
		}
	});

	test("html captures raw content values verbatim, including nullish and false", () => {
		expect(html` <div>${null}</div>`.values).toEqual([null]);
		expect(html` <div>${undefined}</div>`.values).toEqual([undefined]);
		expect(html` <div>${42}</div>`.values).toEqual([42]);
		expect(html` <div>${false}</div>`.values).toEqual([false]);
	});
});
