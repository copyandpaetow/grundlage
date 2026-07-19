import { describe, test, expect } from "vitest";
import { getParsedTemplate } from "../html";
import { buildFragment } from "../../rendering/dom";
import { BINDING } from "../constants";
import { RawContentStaticBinding } from "../types";

const parse = (strings: TemplateStringsArray, ..._values: Array<unknown>) =>
	getParsedTemplate(strings);

describe("html parser — raw content bindings", () => {
	test("dynamic style content", () => {
		const color = "red";
		const parsed = parse` <style>
			div {
				color: ${color};
			}
		</style>`;

		expect(parsed.bindings).toHaveLength(1);
		expect(parsed.bindings[0].type).toBe(BINDING.RAW_CONTENT);
	});

	test("dynamic content inside textarea", () => {
		const val = "user input";
		const parsed = parse`<textarea>${val}</textarea>`;

		expect(parsed.bindings).toHaveLength(1);
		expect(parsed.bindings[0].type).toBe(BINDING.RAW_CONTENT);
	});

	test("dynamic content inside script", () => {
		const code = "console.log('hi')";
		const parsed = parse` <script>
			${code};
		</script>`;

		expect(parsed.bindings).toHaveLength(1);
		expect(parsed.bindings[0].type).toBe(BINDING.RAW_CONTENT);
	});

	test("dynamic content inside non-root template element", () => {
		const content = "<p>slot</p>";
		const parsed = parse` <div><template>${content}</template></div>`;

		expect(parsed.bindings).toHaveLength(1);
		expect(parsed.bindings[0].type).toBe(BINDING.RAW_CONTENT);
	});

	test("multiple expressions in style element share one binding", () => {
		const color = "red";
		const size = "16px";
		const parsed = parse` <style>
			p {
				color: ${color};
				font-size: ${size};
			}
		</style>`;

		expect(parsed.bindings).toHaveLength(1);
		const binding = parsed.bindings[0] as RawContentStaticBinding;
		expect(binding.type).toBe(BINDING.RAW_CONTENT);
		expect(binding.parts.filter((part) => typeof part === "number")).toEqual([
			0, 1,
		]);
	});

	test("static raw content produces no bindings", () => {
		const parsed = parse` <style>
			p {
				color: red;
			}
		</style>`;

		expect(parsed.bindings).toHaveLength(0);
	});

	test("raw content element followed by regular element with binding", () => {
		const color = "red";
		const text = "hello";
		const parsed = parse` <style>
				p {
					color: ${color};
				}
			</style>
			<p>${text}</p>`;

		expect(parsed.bindings.map((binding) => binding.type)).toEqual([
			BINDING.RAW_CONTENT,
			BINDING.CONTENT,
		]);
	});

	test("raw content preserves inner HTML-like text without parsing", () => {
		const injection = "<div>not a real tag</div>";
		const parsed = parse` <style>
			${injection}
		</style>`;

		expect(parsed.bindings).toHaveLength(1);
		expect(parsed.bindings[0].type).toBe(BINDING.RAW_CONTENT);
	});

	test("style element with attributes and dynamic content", () => {
		const css = "color: red";
		const parsed = parse` <style type="text/css">
			p {
			                ${css}
			            }
		</style>`;

		expect(parsed.bindings).toHaveLength(1);
		expect(parsed.bindings[0].type).toBe(BINDING.RAW_CONTENT);
	});

	test("adjacent raw-content elements each get their own binding", () => {
		const a = "red";
		const b = "blue";
		const parsed = parse`<style>
				${a}</style
			><style>
				${b}
			</style>`;

		expect(parsed.bindings.map((binding) => binding.type)).toEqual([
			BINDING.RAW_CONTENT,
			BINDING.RAW_CONTENT,
		]);
		const styles = buildFragment(parsed.htmlWithMarkers).querySelectorAll(
			"style",
		);
		expect(styles).toHaveLength(2);
	});

	test("script content with stray '</other>' does not exit raw-content early", () => {
		const parsed = parse`<script>
			if (a < 10) {
				log("</other>");
			}
		</script>`;
		const script = buildFragment(parsed.htmlWithMarkers).querySelector(
			"script",
		)!;
		expect(script).not.toBeNull();
		expect(script.textContent).toContain("</other>");
	});

	test("script content with '<' not followed by '/' stays in raw-content", () => {
		const parsed = parse`<script>
			if (a < b) return;
		</script>`;
		const script = buildFragment(parsed.htmlWithMarkers).querySelector(
			"script",
		)!;
		expect(script.textContent).toContain("<");
	});
});

describe("html parser — css plan attachment", () => {
	const rawContentBinding = (parsed: ReturnType<typeof parse>) =>
		parsed.bindings[0] as RawContentStaticBinding;

	test("a style value hole gets a css plan named from the template hash", () => {
		const color = "red";
		const parsed = parse`<style>div { color: ${color}; }</style>`;

		const expectedName = `--${(parsed.templateHash >>> 0).toString(36)}-0`;
		const compiledStyleSheet = rawContentBinding(parsed).compiledStyleSheet;
		expect(compiledStyleSheet?.customPropertyNames).toEqual([expectedName]);
		expect(compiledStyleSheet?.customProperties).toEqual([
			{ nameSuffix: 0, valueParts: [" ", 0] },
		]);
		//the prepared sheet is baked into the markup — no first-commit write
		expect(parsed.htmlWithMarkers).toContain(
			`<style>div { color:var(${expectedName}); }</style>`,
		);
	});

	test("templates differing only in raw-content statics get distinct hashes", () => {
		const color = "red";
		const first = parse`<style>p { color: ${color}; }</style>`;
		const second = parse`<style>div { background: ${color}; }</style>`;

		expect(first.templateHash).not.toBe(second.templateHash);
	});

	test("a structural style hole gets no css plan", () => {
		const selector = "div";
		const parsed = parse`<style>${selector} { color: red; }</style>`;

		expect(rawContentBinding(parsed).compiledStyleSheet).toBeNull();
	});

	test("script and textarea holes get no css plan", () => {
		const code = "let a = 1;";
		const value = "user input";
		const scriptParsed = parse`<script>${code}</script>`;
		const textareaParsed = parse`<textarea>${value}</textarea>`;

		expect(rawContentBinding(scriptParsed).compiledStyleSheet).toBeNull();
		expect(rawContentBinding(textareaParsed).compiledStyleSheet).toBeNull();
	});

	test("a nested template hole gets no css plan", () => {
		const content = "div { color: red; }";
		const parsed = parse`<div><template>${content}</template></div>`;

		expect(rawContentBinding(parsed).compiledStyleSheet).toBeNull();
	});

	//the plan stays attached — the fallback decision happens at mount, where the flag
	//also covers planned styles in NESTED templates under the same host
	test("a dynamic host style binding sets hostStyleIsBound", () => {
		const inline = "color: red";
		const color = "blue";
		const parsed = parse`<template style="${inline}"><style>div { color: ${color}; }</style></template>`;

		const rawContent = parsed.bindings.find(
			(binding) => binding.type === BINDING.RAW_CONTENT,
		) as RawContentStaticBinding;
		expect(parsed.hostStyleIsBound).toBe(true);
		expect(rawContent.compiledStyleSheet).not.toBeNull();
	});

	test("a static host style attribute also sets hostStyleIsBound", () => {
		const color = "blue";
		const parsed = parse`<template style="position: absolute"><style>div { color: ${color}; }</style></template>`;

		expect(parsed.hostStyleIsBound).toBe(true);
	});

	test("a non-style host binding leaves hostStyleIsBound unset", () => {
		const className = "card";
		const color = "blue";
		const parsed = parse`<template class="${className}"><style>div { color: ${color}; }</style></template>`;

		const rawContent = parsed.bindings.find(
			(binding) => binding.type === BINDING.RAW_CONTENT,
		) as RawContentStaticBinding;
		expect(parsed.hostStyleIsBound).toBe(false);
		expect(rawContent.compiledStyleSheet).not.toBeNull();
	});

	test("two style elements in one template get disjoint group names", () => {
		const a = "red";
		const b = "10px";
		const parsed = parse`<style>.a { color: ${a}; }</style
		><style>.b { width: ${b}; }</style>`;

		const [firstBinding, secondBinding] =
			parsed.bindings as Array<RawContentStaticBinding>;
		const hashPrefix = `--${(parsed.templateHash >>> 0).toString(36)}-`;
		expect(firstBinding.compiledStyleSheet?.customPropertyNames[0]).toBe(
			`${hashPrefix}0`,
		);
		expect(secondBinding.compiledStyleSheet?.customPropertyNames[0]).toBe(
			`${hashPrefix}1`,
		);
	});
});
