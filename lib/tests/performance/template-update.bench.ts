// @vitest-environment happy-dom
import { describe } from "vitest";
import { html } from "../../src/parser/html";
import { HTMLTemplate } from "../../src/rendering/template-html";
import { bench } from "./bench-options";

/*
Steady-state update() cost — the comparison loop, dirty walk, and per-binding update functions.

List reconciliation lives in list-reconciliation.bench.ts; the raf-animation steady state lives in raf-animation.bench.ts. This file covers the simpler shapes — primitives, mixed change sets, content slots, comment slots — plus a targeted bench for the plain-object double-hash cost called out in PERFORMANCE.md.
*/

const renderOnce = (template: HTMLTemplate) => {
	const host = document.createElement("div");
	host.attachShadow({ mode: "open" }).appendChild(template.setup());
	return template;
};

describe("HTMLTemplate.update() — no-op (all expressions unchanged)", () => {
	const template = renderOnce(
		html`<p class="${"x"}" data-count="${42}">${"hello"}</p>`,
	);
	const sameExpressions = ["x", 42, "hello"];

	bench("strict-equal expressions (no work past the === check)", () => {
		template.update(sameExpressions);
	});
});

describe("HTMLTemplate.update() — primitives changing (animation hot path)", () => {
	const template = renderOnce(html`
		<div style="width:${0}%;background:hsl(${0},70%,${0}%);opacity:${0}"></div>
		<div style="width:${0}%;background:hsl(${0},70%,${0}%);opacity:${0}"></div>
		<div style="width:${0}%;background:hsl(${0},70%,${0}%);opacity:${0}"></div>
		<div style="width:${0}%;background:hsl(${0},70%,${0}%);opacity:${0}"></div>
		<div style="width:${0}%;background:hsl(${0},70%,${0}%);opacity:${0}"></div>
	`);

	let frame = 0;
	bench("20 floats change every call", () => {
		frame++;
		const expressions: Array<number> = [];
		for (let index = 0; index < 20; index++) {
			expressions.push(frame + index * 0.1);
		}
		template.update(expressions);
	});
});

describe("HTMLTemplate.update() — mixed change set", () => {
	const template = renderOnce(html`
		<section>
			<h1>${"title"}</h1>
			<p class="${"static"}" data-count="${0}">${"body"}</p>
			<footer>${"footer"}</footer>
		</section>
	`);

	let frame = 0;
	bench("one primitive changes per call (typical UI update)", () => {
		frame++;
		template.update(["title", "static", frame, "body", "footer"]);
	});
});

describe("HTMLTemplate.update() — content slot: template <-> null", () => {
	const inner = html`<p class="${"x"}">${"hello"}</p>`;
	const template = renderOnce(html`<section>${inner}</section>`);
	let toggle = true;

	bench("toggle child template on/off (deleteNodesBetween + setup)", () => {
		toggle = !toggle;
		template.update([toggle ? inner : null]);
	});
});

describe("HTMLTemplate.update() — content slot: template shape swap", () => {
	const template = renderOnce(
		html`<section>${html`<p>${"hello"}</p>`}</section>`,
	);
	let toggle = false;

	bench("alternate <p>${x}</p> <-> <span>${x}</span>", () => {
		toggle = !toggle;
		template.update([
			toggle ? html`<span>${"world"}</span>` : html`<p>${"hello"}</p>`,
		]);
	});
});

describe("HTMLTemplate.update() — content slot: same-shape re-render", () => {
	const template = renderOnce(
		html`<section>${html`<p class="${"a"}">${"hello"}</p>`}</section>`,
	);
	let counter = 0;

	bench("same template shape, expressions change (isSameTemplate hit)", () => {
		counter++;
		template.update([html`<p class="${`a-${counter}`}">${"hello"}</p>`]);
	});
});

describe("HTMLTemplate.update() — comment slot: multi-expression", () => {
	const template = renderOnce(html`<div><!-- ${"a"}-${"b"}-${"c"} --></div>`);
	let counter = 0;

	bench("3-expression comment concat (renderComment path)", () => {
		counter++;
		template.update([`a${counter}`, `b${counter}`, `c${counter}`]);
	});
});

/*
PERFORMANCE.md "no hash cache for plain objects/arrays" — HTMLTemplate instances memoize their hash on `#hash`, but plain objects walk their full structure on every hashValue() call.
update() compares non-primitive, non-array expressions with `hashValue(current) === hashValue(previous)`, so an object whose reference flips but whose content matches the previous frame pays two full walks per update for no dirty work and no DOM write.
These two benches isolate that cost:
  - "fresh reference every call, equal content" measures the pure double-walk hit. A per-object hash cache (or a faster identity-only fast path) would drop this bench while every other update bench stays put.
  - "one value changes per call" is the real-change baseline — a per-object hash cache helps the first bench, not this one, so the gap between the two is the cache's potential savings.
the binding here is a non-stringable attribute (data-payload="${object}") so the dirty bit, when it does fire, writes via `element[key] = value` rather than setAttribute — keeping the DOM-write half of the cost minimal so the bench surfaces the hash cost specifically.
*/
describe("HTMLTemplate.update() — plain-object expression (hash-cache opportunity)", () => {
	const template = renderOnce(html`<div data-payload="${{ a: 0 }}"></div>`);

	const reference5KeyA = { a: 1, b: 2, c: 3, d: 4, e: 5 };
	const reference5KeyB = { a: 1, b: 2, c: 3, d: 4, e: 5 };
	let toggle = false;

	bench("5-key object, equal content, fresh reference every call", () => {
		toggle = !toggle;
		template.update([toggle ? reference5KeyA : reference5KeyB]);
	});

	let changingCounter = 0;
	bench("5-key object, one value changes every call (real-change baseline)", () => {
		changingCounter++;
		template.update([{ a: changingCounter, b: 2, c: 3, d: 4, e: 5 }]);
	});
});
