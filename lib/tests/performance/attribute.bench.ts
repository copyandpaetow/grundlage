// @vitest-environment happy-dom
import { bench, describe } from "vitest";
import { html } from "../../src/parser/html";
import { HTMLTemplate } from "../../src/rendering/template-html";

/*
    Covers updateAttribute branches: static-name fast path, multi-expression
    concatenation, dynamic name, boolean expandable, dynamic-name boolean,
    expandable spread (array + object), event listener swap, and complex
    (non-stringable) property assignment. Each bench changes the expression
    every call so the dirty check actually fires updateAttribute.
*/

const renderOnce = (template: HTMLTemplate) => {
	const host = document.createElement("div");
	host.attachShadow({ mode: "open" }).appendChild(template.setup());
	return template;
};

describe("updateAttribute — single-expression value, static name", () => {
	const template = renderOnce(html`<div class="${"a"}"></div>`);
	let counter = 0;

	bench("class string changes every call", () => {
		counter++;
		template.update([`class-${counter}`]);
	});
});

describe("updateAttribute — multi-expression concatenated value", () => {
	const template = renderOnce(html`<div class="${"a"} ${"b"} ${"c"}"></div>`);
	let counter = 0;

	bench("3-part class change (exercises bindingToString)", () => {
		counter++;
		template.update([`a${counter}`, `b${counter}`, `c${counter}`]);
	});
});

describe("updateAttribute — dynamic name + dynamic value", () => {
	const template = renderOnce(html`<div ${"data-x"}="${"v"}"></div>`);
	let counter = 0;

	bench("name and value change every call", () => {
		counter++;
		template.update([`data-${counter}`, `value-${counter}`]);
	});
});

describe("updateAttribute — boolean expandable (single dynamic key)", () => {
	const template = renderOnce(html`<input ${"disabled"}>`);
	let toggle = false;

	bench("swap key disabled <-> readonly", () => {
		toggle = !toggle;
		template.update([toggle ? "readonly" : "disabled"]);
	});
});

describe("updateAttribute — boolean dynamic-name (concatenated)", () => {
	const template = renderOnce(html`<input data-${"a"}>`);
	let counter = 0;

	bench("suffix changes every call", () => {
		counter++;
		template.update([`x${counter}`]);
	});
});

describe("updateAttribute — expandable array spread", () => {
	const template = renderOnce(html`<div ${["a", "b", "c"]}></div>`);
	const setA: ReadonlyArray<string> = ["a", "b", "c"];
	const setB: ReadonlyArray<string> = ["x", "y", "z"];
	let toggle = false;

	bench("3-attr alternation (full add/remove cycle)", () => {
		toggle = !toggle;
		template.update([toggle ? setB : setA]);
	});
});

describe("updateAttribute — expandable object spread", () => {
	const template = renderOnce(html`<div ${{ class: "a", id: "b" }}></div>`);
	let counter = 0;

	bench("2-key object value change", () => {
		counter++;
		template.update([{ class: `c${counter}`, id: `i${counter}` }]);
	});
});

describe("updateAttribute — event listener swap", () => {
	const template = renderOnce(
		html`<button onclick="${() => {}}">x</button>`,
	);

	bench("function reference replaced every call", () => {
		template.update([() => {}]);
	});
});

describe("updateAttribute — complex (non-stringable) property", () => {
	const template = renderOnce(html`<div data-payload="${{ x: 1 }}"></div>`);
	let counter = 0;

	bench("object value change", () => {
		counter++;
		template.update([{ x: counter }]);
	});
});
