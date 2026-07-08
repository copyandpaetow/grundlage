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
