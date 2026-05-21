import { describe } from "vitest";
import { html } from "../../src/parser/html";
import { bench } from "./bench-options";

describe("html tagged template - parsing (cold)", () => {
	/*
	 * Cold parse benchmarks: force a fresh parse every iteration by creating
	 * new template-strings-array objects. This measures the raw parser speed
	 * without the WeakMap cache.
	 */

	const makeTSA = (strings: string[]): TemplateStringsArray => {
		const tsa = strings as unknown as TemplateStringsArray;
		Object.defineProperty(tsa, "raw", { value: strings });
		Object.freeze(tsa);
		return tsa;
	};

	bench("simple static template", () => {
		html(makeTSA(["<div>hello</div>"]));
	});

	bench("single expression", () => {
		html(makeTSA(["<div>", "</div>"]), "hello");
	});

	bench("multiple expressions", () => {
		html(
			makeTSA(["<div class='", "'>", " - ", "</div>"]),
			"cls",
			"hello",
			"world",
		);
	});

	bench("nested elements with attributes", () => {
		html(
			makeTSA(["<section><h1 class='", "'>", "</h1><ul>", "</ul></section>"]),
			"title",
			"Hello",
			"<li>item</li>",
		);
	});

	bench("10 expressions", () => {
		html(
			makeTSA([
				"<div a='",
				"' b='",
				"' c='",
				"'>",
				"<span>",
				"</span>",
				"<span>",
				"</span>",
				"<span>",
				"</span>",
				"</div>",
			]),
			"a",
			"b",
			"c",
			"d",
			"e",
			"f",
			"g",
			"h",
			"i",
			"j",
		);
	});
});

describe("html tagged template - cached", () => {
	/*
	 * Warm cache benchmarks: reuses the same tagged template. This measures
	 * the HTMLTemplate constructor + WeakMap lookup path, which is what
	 * happens on re-renders.
	 */

	bench("simple static template", () => {
		html`<div>hello</div>`;
	});

	bench("single expression", () => {
		html`<div>${"hello"}</div>`;
	});

	bench("multiple expressions", () => {
		html`<div class="${"cls"}">${"hello"} - ${"world"}</div>`;
	});

	bench("10 expressions", () => {
		html`<div a="${"a"}" b="${"b"}" c="${"c"}">
			${"d"}<span>${"e"}</span><span>${"f"}</span><span>${"g"}</span
			><span>${"h"}</span><span>${"i"}</span>${"j"}
		</div>`;
	});
});
