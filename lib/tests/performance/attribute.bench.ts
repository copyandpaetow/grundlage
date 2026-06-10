// @vitest-environment happy-dom
import { describe } from "vitest";
import { html } from "../../src/parser/html";
import {
	HTMLTemplate,
	setupTemplate,
	updateTemplate,
} from "../../src/rendering/template-html";
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
	host.attachShadow({ mode: "open" }).appendChild(setupTemplate(template));
	return template;
};

describe("updateAttribute — single-expression value, static name", () => {
	const template = renderOnce(html`<div class="${"a"}"></div>`);
	let counter = 0;

	bench("class string changes every call", () => {
		counter++;
		updateTemplate(template, [`class-${counter}`]);
	});
});

describe("updateAttribute — multi-expression concatenated value", () => {
	const template = renderOnce(html`<div class="${"a"} ${"b"} ${"c"}"></div>`);
	let counter = 0;

	bench("3-part class change (exercises bindingToString)", () => {
		counter++;
		updateTemplate(template, [`a${counter}`, `b${counter}`, `c${counter}`]);
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
		updateTemplate(template, inputs[counter++ & POOL_MASK]);
	});
});

describe("updateAttribute — boolean expandable (single dynamic key)", () => {
	const template = renderOnce(html`<input ${"disabled"} />`);
	const callA = ["disabled"];
	const callB = ["readonly"];
	let toggle = false;

	bench("swap key disabled <-> readonly", () => {
		toggle = !toggle;
		updateTemplate(template, toggle ? callB : callA);
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
		updateTemplate(template, inputs[counter++ & POOL_MASK]);
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
		updateTemplate(template, toggle ? callB : callA);
	});
});

describe("updateAttribute — expandable object spread", () => {
	const template = renderOnce(html`<div ${{ class: "a", id: "b" }}></div>`);
	let counter = 0;

	bench("2-key object value change", () => {
		counter++;
		updateTemplate(template, [{ class: `c${counter}`, id: `i${counter}` }]);
	});
});

/*
phase-2 path: expandable object spread where keys overlap between renders but one value changes
=> the diff in updateExpandable threads previous values as oldValue, so applyAttributeBinding's identity short-circuit no-ops the unchanged "class" entry and only "id" reaches setAttribute
=> compared to the prior blind remove-all + apply-all this saves 1 removeAttribute + 1 setAttribute per iteration (2 of the 4 DOM hops collapse to nothing)
*/
describe("updateAttribute — expandable object spread, partial value change", () => {
	const template = renderOnce(html`<div ${{ class: "a", id: "b" }}></div>`);
	const callA = [{ class: "stable", id: "first" }];
	const callB = [{ class: "stable", id: "second" }];
	let toggle = false;

	bench("2-key object, one value stable + one flipping", () => {
		toggle = !toggle;
		updateTemplate(template, toggle ? callB : callA);
	});
});

/*
phase-2 path: expandable object spread carrying a stable event handler alongside a flipping class
=> diff sees onclick: handler === handler and the identity short-circuit skips the removeEventListener + addEventListener pair entirely
=> the prior code did detach+reattach every iteration on the same function reference, which is the most expensive DOM op in the expandable surface
*/
describe("updateAttribute — expandable object spread, stable handler", () => {
	const stableHandler = () => {};
	const template = renderOnce(
		html`<button ${{ onclick: stableHandler, class: "a" }}>x</button>`,
	);
	const callA = [{ onclick: stableHandler, class: "btn" }];
	const callB = [{ onclick: stableHandler, class: "btn-active" }];
	let toggle = false;

	bench("stable onclick + flipping class (listener stays attached)", () => {
		toggle = !toggle;
		updateTemplate(template, toggle ? callB : callA);
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
		updateTemplate(template, handlerCalls[counter++ & POOL_MASK]);
	});
});

describe("updateAttribute — complex (non-stringable) property", () => {
	const template = renderOnce(html`<div data-payload="${{ x: 1 }}"></div>`);
	let counter = 0;

	bench("object value change", () => {
		counter++;
		updateTemplate(template, [{ x: counter }]);
	});
});

/*
Tier 1.3 in PERFORMANCE.md — updateExpandable currently calls removeExpandable (strips every previous name) then re-adds every current name. for a 10-key spread where the key sets differ by one key, we do 20 attribute writes when 2 would suffice (one removeAttribute for the dropped key, one setAttribute for the new one).
the values for the 9 stable keys are identical strings across both shapes, so a future name-diff change would short-circuit them entirely and this bench would drop by ~90%.
the existing partial-value-change bench above measures the path where the key set is stable and one value flips — that case the diff also helps, but the savings ceiling is smaller (4 ops → 2 ops). Together the two benches bracket what the optimization gains across the realistic shapes.
*/
describe("updateAttribute — expandable object spread, 10-key set, key flipping", () => {
	const setA: Record<string, string> = {
		a: "0",
		b: "0",
		c: "0",
		d: "0",
		e: "0",
		f: "0",
		g: "0",
		h: "0",
		i: "0",
		j: "0",
	};
	const setB: Record<string, string> = {
		a: "0",
		b: "0",
		c: "0",
		d: "0",
		e: "0",
		f: "0",
		g: "0",
		h: "0",
		i: "0",
		k: "0",
	};
	const template = renderOnce(html`<div ${setA}></div>`);
	let toggle = false;

	bench("10-key spread, one key swapped (j <-> k), nine stable", () => {
		toggle = !toggle;
		updateTemplate(template, [toggle ? setB : setA]);
	});
});

/*
PERFORMANCE.md Tier 1.4 + Tier 2.7 share one diagnostic shape: a multi-expression attribute that lives on a swapped tag.

Tier 1.4 — updateTag copies every attribute onto the new element via setAttribute, then dirty-marks the binding so the dirty flush rewrites it. the binding's attribute ends up written twice per swap.
Tier 2.7 — bindingToString rebuilds an identical "a b c" string on every dirty flush because none of the binding's own expressions changed. a "did my expression indices change against previousExpressions" guard would skip the rebuild and the second setAttribute.

so either fix alone moves this bench; a fix for both moves it hardest. the sibling bench "updateTag — element with related dynamic attribute" in tag.bench.ts changes the attribute's value too, so it can't separate this case from the legitimate-rewrite case — this bench keeps the attribute expressions stable on purpose.
*/
describe("updateAttribute — tag swap with stable multi-part attr (Tier 1.4 + 2.7)", () => {
	const template = renderOnce(
		html`<${"span"} class="${"a"} ${"b"} ${"c"}">x</${"span"}>`,
	);
	let toggle = false;

	bench("tag flips span <-> div, class expressions stay (a, b, c)", () => {
		toggle = !toggle;
		const tag = toggle ? "div" : "span";
		updateTemplate(template, [tag, "a", "b", "c", tag]);
	});
});
