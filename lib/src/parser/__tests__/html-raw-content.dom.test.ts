import { describe, test, expect } from "vitest";
import { getParsedTemplate } from "../html";
import { buildFragment } from "../../rendering/dom";
import * as BINDING from "../binding";
import { ParsedTemplate, Part, RawContentStaticBinding } from "../types";

const parse = (strings: TemplateStringsArray, ..._values: Array<unknown>) =>
	getParsedTemplate(strings);

describe("html parser: raw content bindings", () => {
	test("a hole in a <style> is one raw-content binding", () => {
		const color = "red";
		const parsed = parse` <style>
			div {
				color: ${color};
			}
		</style>`;

		expect(parsed.bindings).toHaveLength(1);
		expect(parsed.bindings[0].type).toBe(BINDING.RAW_CONTENT);
	});

	test("a hole in a <textarea> is one raw-content binding", () => {
		const val = "user input";
		const parsed = parse`<textarea>${val}</textarea>`;

		expect(parsed.bindings).toHaveLength(1);
		expect(parsed.bindings[0].type).toBe(BINDING.RAW_CONTENT);
	});

	test("a hole in a <script> is one raw-content binding", () => {
		const code = "console.log('hi')";
		const parsed = parse` <script>
			${code};
		</script>`;

		expect(parsed.bindings).toHaveLength(1);
		expect(parsed.bindings[0].type).toBe(BINDING.RAW_CONTENT);
	});

	test("a hole inside a nested template binds the template, with its content parsed as markup", () => {
		const content = "<p>slot</p>";
		const parsed = parse` <div><template><p class=${"a"}>${content}</p></template></div>`;

		expect(parsed.bindings).toHaveLength(1);
		const [binding] = parsed.bindings;
		if (binding.type !== BINDING.TEMPLATE_CONTENT) throw new Error("expected a template binding");
		expect(binding.valueIndices).toEqual([0, 1]);
		expect(binding.content.bindings.map((inner) => inner.type)).toEqual([
			BINDING.ATTRIBUTE,
			BINDING.CONTENT,
		]);
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
		expect(binding.parts.filter((part) => typeof part === "number")).toEqual([0, 1]);
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

	test("a <style> with static attributes and a hole is one raw-content binding", () => {
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
		const styles = buildFragment(parsed.htmlWithMarkers).querySelectorAll("style");
		expect(styles).toHaveLength(2);
	});

	test("script content with stray '</other>' does not exit raw-content early", () => {
		const parsed = parse`<script>
			if (a < 10) {
				log("</other>");
			}
		</script>`;
		const script = buildFragment(parsed.htmlWithMarkers).querySelector("script")!;
		expect(script).not.toBeNull();
		expect(script.textContent).toContain("</other>");
	});

	test("script content with '<' not followed by '/' stays in raw-content", () => {
		const parsed = parse`<script>
			if (a < b) return;
		</script>`;
		const script = buildFragment(parsed.htmlWithMarkers).querySelector("script")!;
		expect(script.textContent).toContain("<");
	});
});

//each <style> as its text, or as the parts of the binding whose marker sits right before it
const styleSheetsOf = (parsed: ParsedTemplate): Array<string | ReadonlyArray<Part>> =>
	Array.from(buildFragment(parsed.htmlWithMarkers).querySelectorAll("style"), (style) => {
		const marker = style.previousSibling;
		if (!(marker instanceof Comment)) return style.textContent;
		const bindingIndex = Number(marker.data.slice(marker.data.indexOf("-") + 1));
		return (parsed.bindings[bindingIndex] as RawContentStaticBinding).parts;
	});

describe("html parser: a dynamic <style> is split at its top-level rules", () => {
	test("a sheet of one rule stays one <style>", () => {
		const parsed = parse`<style>.a { width: ${1}px; }</style>`;

		expect(styleSheetsOf(parsed)).toEqual([[".a { width: ", 0, "px; }"]]);
	});

	test("static rules around a holed rule become static <style> elements", () => {
		const parsed = parse`<style>.a { color: red; } .b { width: ${1}px; } .c { color: blue; }</style>`;

		expect(styleSheetsOf(parsed)).toEqual([
			".a { color: red; }",
			[" .b { width: ", 0, "px; }"],
			" .c { color: blue; }",
		]);
	});

	test("adjacent static rules share one <style>", () => {
		const parsed = parse`<style>.a { color: red; } .b { color: blue; } .c { width: ${1}px; }</style>`;

		expect(styleSheetsOf(parsed)).toEqual([
			".a { color: red; } .b { color: blue; }",
			[" .c { width: ", 0, "px; }"],
		]);
	});

	test("each holed rule gets its own binding, with the holes numbered in source order", () => {
		const parsed = parse`<style>.a { width: ${1}px; height: ${2}px; } .b { color: ${"red"}; }</style>`;

		expect(styleSheetsOf(parsed)).toEqual([
			[".a { width: ", 0, "px; height: ", 1, "px; }"],
			[" .b { color: ", 2, "; }"],
		]);
	});

	test("a hole inside a nested block makes its whole top-level rule dynamic", () => {
		const parsed = parse`<style>@media (width > 1px) { .a { width: ${1}px; } .b { color: red; } } .c { color: blue; }</style>`;

		expect(styleSheetsOf(parsed)).toEqual([
			["@media (width > 1px) { .a { width: ", 0, "px; } .b { color: red; } }"],
			" .c { color: blue; }",
		]);
	});

	test("a brace in a string, a comment, an escape or a url ends no rule", () => {
		expect(styleSheetsOf(parse`<style>.a { content: "}"; } .b { width: ${1}px; }</style>`)).toEqual(
			['.a { content: "}"; }', [" .b { width: ", 0, "px; }"]],
		);
		expect(
			styleSheetsOf(parse`<style>.a { content: "\\"}"; } .b { width: ${1}px; }</style>`),
		).toEqual(['.a { content: "\\"}"; }', [" .b { width: ", 0, "px; }"]]);
		expect(styleSheetsOf(parse`<style>.a { /* } */ } .b { width: ${1}px; }</style>`)).toEqual([
			".a { /* } */ }",
			[" .b { width: ", 0, "px; }"],
		]);
		expect(
			styleSheetsOf(parse`<style>.a\\{ { color: red; } .b { width: ${1}px; }</style>`),
		).toEqual([".a\\{ { color: red; }", [" .b { width: ", 0, "px; }"]]);
		expect(
			styleSheetsOf(parse`<style>.a { background: url(a}.png); } .b { width: ${1}px; }</style>`),
		).toEqual([".a { background: url(a}.png); }", [" .b { width: ", 0, "px; }"]]);
	});

	test("a string ends at a line break, the way CSS reads a broken string", () => {
		const parsed = parse`<style>.a { content: "x
			} .b { width: ${1}px; }</style>`;

		expect(styleSheetsOf(parsed)).toEqual([
			'.a { content: "x\n\t\t\t}',
			[" .b { width: ", 0, "px; }"],
		]);
	});

	test("a hole between rules joins the rule after it", () => {
		const parsed = parse`<style>.a { color: red; } ${".x { color: blue; }"} .b { color: green; }</style>`;

		expect(styleSheetsOf(parsed)).toEqual([
			".a { color: red; }",
			[" ", 0, " .b { color: green; }"],
		]);
	});

	test("text after the last rule stays with it instead of getting a <style> of its own", () => {
		const parsed = parse`<style>
			.a { width: ${1}px; }
		</style>`;

		expect(styleSheetsOf(parsed)).toEqual([["\n\t\t\t.a { width: ", 0, "px; }\n\t\t"]]);
	});

	test("every piece keeps the <style>'s attributes", () => {
		const parsed = parse`<style media="print">.a { color: red; } .b { width: ${1}px; }</style>`;

		expect(parsed.htmlWithMarkers).toBe(
			"<style media='print'>.a { color: red; }</style><!--^.^ 13-0--><style media='print'></style>",
		);
	});

	test("an attribute hole on a dynamic <style> throws", () => {
		expect(() => parse`<style media=${"print"}>.a { width: ${1}px; }</style>`).toThrow(
			/<style> expects \$\{...\} in its attributes or in its content, not both/,
		);
	});

	test("@namespace in a dynamic <style> throws", () => {
		expect(
			() =>
				parse`<style>@namespace svg url(http://www.w3.org/2000/svg); .a { width: ${1}px; }</style>`,
		).toThrow(/expects no @namespace/);
	});

	test("templates differing only in style statics get distinct hashes", () => {
		const color = "red";
		const first = parse`<style>p { color: ${color}; }</style>`;
		const second = parse`<style>div { background: ${color}; }</style>`;

		expect(first.templateHash).not.toBe(second.templateHash);
	});
});
