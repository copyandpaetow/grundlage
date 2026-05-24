// @vitest-environment happy-dom
import { describe } from "vitest";
import { html } from "../../src/parser/html";
import { HTMLTemplate } from "../../src/rendering/template-html";
import { bench } from "./bench-options";

/*
renderList is the heaviest hot path in the library when arrays are present. This file isolates every shape we currently exercise plus a few that map directly to PERFORMANCE.md opportunities:

  - alternation patterns (append, prepend, reverse, swap, shuffle) at the original N=20 — historical baselines stay comparable
  - the same patterns at N=100 and N=1000 — Tier 1.2 (Range.deleteContents) and Tier 2.6 (scratch-buffer reuse) both scale with N, so N=20 hides the savings
  - bulk removal (N → 0, N → 1) — Tier 1.2's most-favorable shape
  - nested list — the canonical re-entrancy scenario that any "reuse scratch buffers" change in Tier 2.6 has to preserve
*/

const renderOnce = (template: HTMLTemplate) => {
	const host = document.createElement("div");
	host.attachShadow({ mode: "open" }).appendChild(template.setup());
	return template;
};

const buildItems = (count: number) =>
	Array.from({ length: count }, (_, index) => ({
		id: index,
		label: `item-${index}`,
	}));

const listFor = (source: ReadonlyArray<{ id: number; label: string }>) =>
	html`<ul>
		${source.map((item) => html`<li data-id="${item.id}">${item.label}</li>`)}
	</ul>`;

//baseline at N=20 — kept verbatim so historical bench measurements stay comparable across the file split

describe("renderList — 20 items, unchanged order", () => {
	const items = buildItems(20);
	const template = renderOnce(listFor(items));

	bench("hash-hit path (every item resolves at head peel)", () => {
		template.update(listFor(items).currentExpressions);
	});
});

describe("renderList — 20 items, one item mutated", () => {
	const items = buildItems(20);
	const template = renderOnce(listFor(items));

	bench("one label changes per call", () => {
		items[10].label = `item-10-${Math.random()}`;
		template.update(listFor(items).currentExpressions);
	});
});

describe("renderList — 20 items, append/pop alternation", () => {
	const items10 = buildItems(10);
	const items11 = [...items10, { id: 10, label: "item-10" }];

	const template = renderOnce(listFor(items10));
	let toggle = false;

	bench("tail growth (pure-insertion + pure-removal halves)", () => {
		toggle = !toggle;
		template.update(listFor(toggle ? items11 : items10).currentExpressions);
	});
});

describe("renderList — 20 items, prepend/shift alternation", () => {
	const items10 = buildItems(10);
	const items11 = [{ id: -1, label: "item-prepend" }, ...items10];

	const template = renderOnce(listFor(items10));
	let toggle = false;

	bench("head growth (tail-peel resolves entirely)", () => {
		toggle = !toggle;
		template.update(listFor(toggle ? items11 : items10).currentExpressions);
	});
});

describe("renderList — 20 items, full reverse", () => {
	const itemsAsc = buildItems(20);
	const itemsDesc = [...itemsAsc].reverse();

	const template = renderOnce(listFor(itemsAsc));
	let toggle = false;

	bench("reverse alternation (full middle-map + moves)", () => {
		toggle = !toggle;
		template.update(listFor(toggle ? itemsDesc : itemsAsc).currentExpressions);
	});
});

describe("renderList — 20 items, adjacent swap", () => {
	const itemsA = buildItems(20);
	const itemsB = itemsA.slice();
	[itemsB[10], itemsB[11]] = [itemsA[11], itemsA[10]];

	const template = renderOnce(listFor(itemsA));
	let toggle = false;

	bench("swap items[10] and items[11] (head/tail peel + 2-item middle)", () => {
		toggle = !toggle;
		template.update(listFor(toggle ? itemsB : itemsA).currentExpressions);
	});
});

describe("renderList — 20 items, full shuffle", () => {
	const itemsA = buildItems(20);
	//deterministic non-trivial permutation: hash-claim and structural fallback both fire across the run
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

	const template = renderOnce(listFor(itemsA));
	let toggle = false;

	bench("shuffle alternation (hash-claim worst case)", () => {
		toggle = !toggle;
		template.update(listFor(toggle ? itemsB : itemsA).currentExpressions);
	});
});

/*
N=100 and N=1000 — surface O(N) costs that the audit calls out but N=20 hides.
We pick the patterns where the linear-walk component dominates:
  - "one item mutated" measures the full-list walk + minimal DOM work (the floor we pay just for being a long list)
  - "full reverse" measures the Map build + N moves (the worst case for Tier 2.6 scratch-buffer reuse — bigger N => bigger Map => bigger per-call allocation today)
*/

describe("renderList — 100 items, one item mutated", () => {
	const items = buildItems(100);
	const template = renderOnce(listFor(items));

	bench("one label changes per call (linear-walk floor at N=100)", () => {
		items[50].label = `item-50-${Math.random()}`;
		template.update(listFor(items).currentExpressions);
	});
});

describe("renderList — 100 items, full reverse", () => {
	const itemsAsc = buildItems(100);
	const itemsDesc = [...itemsAsc].reverse();
	const template = renderOnce(listFor(itemsAsc));
	let toggle = false;

	bench("reverse alternation (Map build + 100 moves)", () => {
		toggle = !toggle;
		template.update(listFor(toggle ? itemsDesc : itemsAsc).currentExpressions);
	});
});

describe("renderList — 1000 items, one item mutated", () => {
	const items = buildItems(1000);
	const template = renderOnce(listFor(items));

	bench("one label changes per call (linear-walk floor at N=1000)", () => {
		items[500].label = `item-500-${Math.random()}`;
		template.update(listFor(items).currentExpressions);
	});
});

describe("renderList — 1000 items, full reverse", () => {
	const itemsAsc = buildItems(1000);
	const itemsDesc = [...itemsAsc].reverse();
	const template = renderOnce(listFor(itemsAsc));
	let toggle = false;

	bench("reverse alternation (Map build + 1000 moves)", () => {
		toggle = !toggle;
		template.update(listFor(toggle ? itemsDesc : itemsAsc).currentExpressions);
	});
});

/*
Tier 1.2 — Range.deleteContents() opportunity. removeItemDom currently fires one .remove() per node, so going from N items to 0 or 1 is where a Range-based delete lands hardest.
the alternation is symmetric (clear → refill → clear → refill), so half the iterations are the delete path we're targeting; a Range optimization would move this bench down by roughly half the per-node delete savings.
*/
describe("renderList — bulk removal (Tier 1.2)", () => {
	const items100 = buildItems(100);
	const empty: ReadonlyArray<{ id: number; label: string }> = [];
	const single = items100.slice(0, 1);

	const clearTemplate = renderOnce(listFor(items100));
	let clearToggle = false;
	bench(
		"100 items, clear/refill alternation (full delete + setup cycle)",
		() => {
			clearToggle = !clearToggle;
			clearTemplate.update(
				listFor(clearToggle ? empty : items100).currentExpressions,
			);
		},
	);

	const shrinkTemplate = renderOnce(listFor(items100));
	let shrinkToggle = false;
	bench("100 items, shrink to 1 / refill alternation", () => {
		shrinkToggle = !shrinkToggle;
		shrinkTemplate.update(
			listFor(shrinkToggle ? single : items100).currentExpressions,
		);
	});
});

/*
Nested list — the outer list has 5 items, each carrying its own inner 5-item list.

re-entrancy mechanics: renderList inserts an item by calling `template.setup(null)`, which runs the inner template's #flush, which dispatches to updateContent for the inner content binding, which sees an array and re-enters renderList synchronously inside the outer call.
=> any "reuse scratch buffers in renderList" change (Tier 2.6) must preserve this bench. corrupting scratch between outer and inner calls would either crash or silently produce wrong DOM.

we also mutate every inner label per frame so the inner renderList does real work; the outer renderList sees stable group references (still array-identity-different because of .map) and hash-claims through.
*/
describe("renderList — nested list (re-entrancy stress)", () => {
	const groups = Array.from({ length: 5 }, (_, outer) =>
		Array.from({ length: 5 }, (_, inner) => ({
			id: outer * 5 + inner,
			label: `o${outer}-i${inner}`,
		})),
	);

	const nestedListFor = (
		source: ReadonlyArray<ReadonlyArray<{ id: number; label: string }>>,
	) =>
		html`<ul>
			${source.map(
				(group) =>
					html`<li>
						<ul>
							${group.map(
								(item) => html`<li data-id="${item.id}">${item.label}</li>`,
							)}
						</ul>
					</li>`,
			)}
		</ul>`;

	const template = renderOnce(nestedListFor(groups));

	let frame = 0;
	bench("5 outer x 5 inner, every label changes (full nested update)", () => {
		frame++;
		for (let outer = 0; outer < groups.length; outer++) {
			for (let inner = 0; inner < groups[outer].length; inner++) {
				groups[outer][inner].label = `f${frame}-o${outer}-i${inner}`;
			}
		}
		template.update(nestedListFor(groups).currentExpressions);
	});
});
