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

describe("HTMLTemplate.update() — list reconciliation: tail growth", () => {
	const items10 = Array.from({ length: 10 }, (_, index) => ({
		id: index,
		label: `item-${index}`,
	}));
	const items11 = [...items10, { id: 10, label: "item-10" }];

	const listFor = (source: ReadonlyArray<{ id: number; label: string }>) =>
		html`<ul>
			${source.map((item) => html`<li data-id="${item.id}">${item.label}</li>`)}
		</ul>`;

	const template = renderOnce(listFor(items10));
	let toggle = false;

	bench("append/pop alternation (pure-insertion + pure-removal)", () => {
		toggle = !toggle;
		template.update(listFor(toggle ? items11 : items10).currentExpressions);
	});
});

describe("HTMLTemplate.update() — list reconciliation: head growth", () => {
	const items10 = Array.from({ length: 10 }, (_, index) => ({
		id: index,
		label: `item-${index}`,
	}));
	const items11 = [{ id: -1, label: "item-prepend" }, ...items10];

	const listFor = (source: ReadonlyArray<{ id: number; label: string }>) =>
		html`<ul>
			${source.map((item) => html`<li data-id="${item.id}">${item.label}</li>`)}
		</ul>`;

	const template = renderOnce(listFor(items10));
	let toggle = false;

	bench("prepend/shift alternation (tail-peel resolves entirely)", () => {
		toggle = !toggle;
		template.update(listFor(toggle ? items11 : items10).currentExpressions);
	});
});

describe("HTMLTemplate.update() — list reconciliation: reverse", () => {
	const itemsAsc = Array.from({ length: 20 }, (_, index) => ({
		id: index,
		label: `item-${index}`,
	}));
	const itemsDesc = [...itemsAsc].reverse();

	const listFor = (source: ReadonlyArray<{ id: number; label: string }>) =>
		html`<ul>
			${source.map((item) => html`<li data-id="${item.id}">${item.label}</li>`)}
		</ul>`;

	const template = renderOnce(listFor(itemsAsc));
	let toggle = false;

	bench("20-item reverse alternation (full middle-map + moves)", () => {
		toggle = !toggle;
		template.update(listFor(toggle ? itemsDesc : itemsAsc).currentExpressions);
	});
});

describe("HTMLTemplate.update() — list reconciliation: adjacent swap", () => {
	const itemsA = Array.from({ length: 20 }, (_, index) => ({
		id: index,
		label: `item-${index}`,
	}));
	const itemsB = itemsA.slice();
	[itemsB[10], itemsB[11]] = [itemsA[11], itemsA[10]];

	const listFor = (source: ReadonlyArray<{ id: number; label: string }>) =>
		html`<ul>
			${source.map((item) => html`<li data-id="${item.id}">${item.label}</li>`)}
		</ul>`;

	const template = renderOnce(listFor(itemsA));
	let toggle = false;

	bench("swap items[10] and items[11] (head/tail peel + 2-item middle)", () => {
		toggle = !toggle;
		template.update(listFor(toggle ? itemsB : itemsA).currentExpressions);
	});
});

describe("HTMLTemplate.update() — list reconciliation: shuffle", () => {
	const itemsA = Array.from({ length: 20 }, (_, index) => ({
		id: index,
		label: `item-${index}`,
	}));
	// Deterministic non-trivial permutation: hash-claim and structural fallback
	// both fire across the run.
	const itemsB = [
		itemsA[3],
		itemsA[7],
		itemsA[1],
		itemsA[14],
		itemsA[0],
		itemsA[18],
		itemsA[5],
		itemsA[11],
		itemsA[2],
		itemsA[19],
		itemsA[6],
		itemsA[13],
		itemsA[9],
		itemsA[16],
		itemsA[4],
		itemsA[10],
		itemsA[8],
		itemsA[17],
		itemsA[12],
		itemsA[15],
	];

	const listFor = (source: ReadonlyArray<{ id: number; label: string }>) =>
		html`<ul>
			${source.map((item) => html`<li data-id="${item.id}">${item.label}</li>`)}
		</ul>`;

	const template = renderOnce(listFor(itemsA));
	let toggle = false;

	bench("20-item shuffle alternation (hash-claim worst case)", () => {
		toggle = !toggle;
		template.update(listFor(toggle ? itemsB : itemsA).currentExpressions);
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
