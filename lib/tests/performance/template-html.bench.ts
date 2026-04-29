// @vitest-environment happy-dom
import { bench, describe } from "vitest";
import { html } from "../../src/parser/html";
import { HTMLTemplate } from "../../src/rendering/template-html";

/*
    Measures the render hot path — parse (cached), setup, and update.
    Update scenarios mirror real component shapes:
    - unchanged: fastest path, strict equality skips work
    - primitives-only: mimics raf-animation (numbers through style attributes)
    - mixed primitives + templates: typical component with nested templates
    - list diff: array-of-templates reconciliation

    Run with: npm run bench
*/

const renderOnce = (template: HTMLTemplate) => {
	const host = document.createElement("div");
	host.attachShadow({ mode: "open" }).appendChild(template.setup());
	return template;
};

describe("html() — tagged template creation", () => {
	bench("small template (2 expressions, cached parse)", () => {
		html`<p class="${"x"}">${"y"}</p>`;
	});

	bench("animation-shape template (20 style attrs, ~80 expressions)", () => {
		html`
			<div
				style="width:${1}%;background:hsl(${2},70%,${3}%);opacity:${4}"
			></div>
			<div
				style="width:${5}%;background:hsl(${6},70%,${7}%);opacity:${8}"
			></div>
			<div
				style="width:${9}%;background:hsl(${10},70%,${11}%);opacity:${12}"
			></div>
			<div
				style="width:${13}%;background:hsl(${14},70%,${15}%);opacity:${16}"
			></div>
			<div
				style="width:${17}%;background:hsl(${18},70%,${19}%);opacity:${20}"
			></div>
		`;
	});
});

describe("HTMLTemplate.setup()", () => {
	bench("small template", () => {
		renderOnce(html`<p class="${"x"}">${"y"}</p>`);
	});

	bench("animation-shape template", () => {
		renderOnce(html`
			<div
				style="width:${1}%;background:hsl(${2},70%,${3}%);opacity:${4}"
			></div>
			<div
				style="width:${5}%;background:hsl(${6},70%,${7}%);opacity:${8}"
			></div>
			<div
				style="width:${9}%;background:hsl(${10},70%,${11}%);opacity:${12}"
			></div>
			<div
				style="width:${13}%;background:hsl(${14},70%,${15}%);opacity:${16}"
			></div>
			<div
				style="width:${17}%;background:hsl(${18},70%,${19}%);opacity:${20}"
			></div>
		`);
	});
});

describe("HTMLTemplate.update() — no-op (all expressions unchanged)", () => {
	const template = renderOnce(
		html`<p class="${"x"}" data-count="${42}">${"hello"}</p>`,
	);
	const sameExpressions = ["x", 42, "hello"];

	bench("small template, strict-equal expressions", () => {
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

describe("HTMLTemplate.update() — list reconciliation", () => {
	const items = Array.from({ length: 20 }, (_, index) => ({
		id: index,
		label: `item-${index}`,
	}));

	const listTemplate = () =>
		html`<ul>
			${items.map((item) => html`<li data-id="${item.id}">${item.label}</li>`)}
		</ul>`;

	const template = renderOnce(listTemplate());

	bench("20-item list, unchanged order (hash-hit path)", () => {
		template.update(listTemplate().currentExpressions);
	});

	bench("20-item list, one item mutated", () => {
		items[10].label = `item-10-${Math.random()}`;
		template.update(listTemplate().currentExpressions);
	});
});
