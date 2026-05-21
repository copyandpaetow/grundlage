// @vitest-environment happy-dom
import { describe } from "vitest";
import { html } from "../../src/parser/html";
import { HTMLTemplate } from "../../src/rendering/template-html";
import { bench } from "./bench-options";

/*
    Covers updateAttribute branches: static-name fast path, multi-expression
    concatenation, dynamic name, boolean expandable, dynamic-name boolean,
    expandable spread (array + object), event listener swap, and complex
    (non-stringable) property assignment. Each bench changes the expression
    every call so the dirty check actually fires updateAttribute.

    benches that drive update() with fresh strings/closures/arrays on every
    iteration filled the nursery fast enough to provoke an eden GC mid-run,
    which inflated max/RME while p75 stayed stable. for those we pre-build a
    rotating pool of inputs once and index into it — the swap path (what we
    actually want to measure) still fires every call, but the per-iteration
    allocation is gone.

    POOL_SIZE & POOL_MASK use a power-of-two so `counter & POOL_MASK` is a
    free wrap-around instead of a modulo divide.
*/

const POOL_SIZE = 256;
const POOL_MASK = POOL_SIZE - 1;

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
	const inputs: Array<[string, string]> = Array.from(
		{ length: POOL_SIZE },
		(_, index) => [`data-${index}`, `value-${index}`],
	);
	let counter = 0;

	bench("name and value change every call", () => {
		template.update(inputs[counter++ & POOL_MASK]);
	});
});

describe("updateAttribute — boolean expandable (single dynamic key)", () => {
	const template = renderOnce(html`<input ${"disabled"} />`);
	const callA = ["disabled"];
	const callB = ["readonly"];
	let toggle = false;

	bench("swap key disabled <-> readonly", () => {
		toggle = !toggle;
		template.update(toggle ? callB : callA);
	});
});

describe("updateAttribute — boolean dynamic-name (concatenated)", () => {
	const template = renderOnce(html`<input data-${"a"} />`);
	const inputs: Array<[string]> = Array.from(
		{ length: POOL_SIZE },
		(_, index) => [`x${index}`],
	);
	let counter = 0;

	bench("suffix changes every call", () => {
		template.update(inputs[counter++ & POOL_MASK]);
	});
});

describe("updateAttribute — expandable array spread", () => {
	const template = renderOnce(html`<div ${["a", "b", "c"]}></div>`);
	const setA: ReadonlyArray<string> = ["a", "b", "c"];
	const setB: ReadonlyArray<string> = ["x", "y", "z"];
	const callA = [setA];
	const callB = [setB];
	let toggle = false;

	bench("3-attr alternation (full add/remove cycle)", () => {
		toggle = !toggle;
		template.update(toggle ? callB : callA);
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
	const template = renderOnce(html`<button onclick="${() => {}}">x</button>`);
	//each entry has its own [handler] wrapper so update() never sees the same expressions array twice in a row — the swap path still fires every iteration, we just don't pay for fresh allocation
	const handlerCalls: Array<[() => void]> = Array.from(
		{ length: POOL_SIZE },
		() => [() => {}],
	);
	let counter = 0;

	bench("function reference replaced every call", () => {
		template.update(handlerCalls[counter++ & POOL_MASK]);
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
