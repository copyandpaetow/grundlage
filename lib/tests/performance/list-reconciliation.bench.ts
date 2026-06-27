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
renderList is the heaviest hot path in the library when arrays are present. This file isolates every shape we currently exercise plus a few that map directly to PERFORMANCE.md opportunities:

  - alternation patterns (append, prepend, reverse, swap, shuffle) at the original N=20 — historical baselines stay comparable
  - the same patterns at N=100 and N=1000 — Tier 1.2 (Range.deleteContents) and Tier 2.6 (scratch-buffer reuse) both scale with N, so N=20 hides the savings
  - bulk removal (N → 0, N → 1) — Tier 1.2's most-favorable shape
  - nested list — the canonical re-entrancy scenario that any "reuse scratch buffers" change in Tier 2.6 has to preserve
*/

const renderOnce = (template: HTMLTemplate) => {
	const host = document.createElement("div");
	host.attachShadow({ mode: "open" }).appendChild(setupTemplate(template));
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
		updateTemplate(template, listFor(items).currentExpressions);
	});
});

describe("renderList — 20 items, one item mutated", () => {
	const items = buildItems(20);
	const template = renderOnce(listFor(items));

	bench("one label changes per call", () => {
		items[10].label = `item-10-${Math.random()}`;
		updateTemplate(template, listFor(items).currentExpressions);
	});
});

describe("renderList — 20 items, append/pop alternation", () => {
	const items10 = buildItems(10);
	const items11 = [...items10, { id: 10, label: "item-10" }];

	const template = renderOnce(listFor(items10));
	let toggle = false;

	bench("tail growth (pure-insertion + pure-removal halves)", () => {
		toggle = !toggle;
		updateTemplate(
			template,
			listFor(toggle ? items11 : items10).currentExpressions,
		);
	});
});

describe("renderList — 20 items, prepend/shift alternation", () => {
	const items10 = buildItems(10);
	const items11 = [{ id: -1, label: "item-prepend" }, ...items10];

	const template = renderOnce(listFor(items10));
	let toggle = false;

	bench("head growth (tail-peel resolves entirely)", () => {
		toggle = !toggle;
		updateTemplate(
			template,
			listFor(toggle ? items11 : items10).currentExpressions,
		);
	});
});

describe("renderList — 20 items, full reverse", () => {
	const itemsAsc = buildItems(20);
	const itemsDesc = [...itemsAsc].reverse();

	const template = renderOnce(listFor(itemsAsc));
	let toggle = false;

	bench("reverse alternation (full middle-map + moves)", () => {
		toggle = !toggle;
		updateTemplate(
			template,
			listFor(toggle ? itemsDesc : itemsAsc).currentExpressions,
		);
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
		updateTemplate(
			template,
			listFor(toggle ? itemsB : itemsA).currentExpressions,
		);
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
		updateTemplate(
			template,
			listFor(toggle ? itemsB : itemsA).currentExpressions,
		);
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
		updateTemplate(template, listFor(items).currentExpressions);
	});
});

describe("renderList — 100 items, full reverse", () => {
	const itemsAsc = buildItems(100);
	const itemsDesc = [...itemsAsc].reverse();
	const template = renderOnce(listFor(itemsAsc));
	let toggle = false;

	bench("reverse alternation (Map build + 100 moves)", () => {
		toggle = !toggle;
		updateTemplate(
			template,
			listFor(toggle ? itemsDesc : itemsAsc).currentExpressions,
		);
	});
});

describe("renderList — 1000 items, all labels change, stable order", () => {
	const items = buildItems(1000);
	const template = renderOnce(listFor(items));
	let frame = 0;

	//the wasted-map shape: row 0 and row N change so neither peel fires, the whole list is the middle, and every
	//key differs so every claim resolves structurally (positionally). measures the eager key-Map's cost on the
	//shape where it never helps.
	bench(
		"every label changes per call (full middle, all structural claims)",
		() => {
			frame++;
			for (let index = 0; index < items.length; index++) {
				items[index].label = `item-${index}-f${frame}`;
			}
			updateTemplate(template, listFor(items).currentExpressions);
		},
	);
});

describe("renderList — 1000 items, one item mutated", () => {
	const items = buildItems(1000);
	const template = renderOnce(listFor(items));

	bench("one label changes per call (linear-walk floor at N=1000)", () => {
		items[500].label = `item-500-${Math.random()}`;
		updateTemplate(template, listFor(items).currentExpressions);
	});
});

describe("renderList — 1000 items, full reverse", () => {
	const itemsAsc = buildItems(1000);
	const itemsDesc = [...itemsAsc].reverse();
	const template = renderOnce(listFor(itemsAsc));
	let toggle = false;

	bench("reverse alternation (Map build + 1000 moves)", () => {
		toggle = !toggle;
		updateTemplate(
			template,
			listFor(toggle ? itemsDesc : itemsAsc).currentExpressions,
		);
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

re-entrancy mechanics: renderList inserts an item by calling `setupTemplate(template, null)`, which runs the inner template's #flush, which dispatches to updateContent for the inner content binding, which sees an array and re-enters renderList synchronously inside the outer call.
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
		updateTemplate(template, nestedListFor(groups).currentExpressions);
	});
});

/*
Object- and nested-template-valued rows — the primitive rows above can never exercise the
slot-diff's non-primitive comparison, because renderList's row-hash prunes a fully-equal row
before updateTemplate runs. The slot-diff only sees a row claimed *structurally* (some
expression changed), so to reach a non-primitive comparison we change one expression (forcing
the structural claim) while keeping a second expression fresh-but-equal. That fresh-but-equal
expression is exactly where a hash comparison and a short-circuit equality comparison diverge:

  - object: hash walks both references fully; deep-equal short-circuits.
  - nested template: hash prunes the equal subtree with a numeric walk; equality recurses
    through renderTemplate to prove it unchanged.

The real-change control alongside each pins the case where the second expression genuinely
changes — both comparisons then do identical work, so any A/B delta there is pure noise.
*/

type ObjectRow = {
	tick: number;
	payload: { weight: number; active: boolean; tag: string };
};

const buildObjectRows = (count: number): Array<ObjectRow> =>
	Array.from({ length: count }, (_, index) => ({
		tick: 0,
		payload: { weight: index, active: index % 2 === 0, tag: `t-${index}` },
	}));

const objectRowListFor = (source: ReadonlyArray<ObjectRow>) =>
	html`<ul>
		${source.map(
			(item) =>
				html`<li data-tick="${item.tick}" data-payload="${item.payload}"></li>`,
		)}
	</ul>`;

describe("renderList — 100 object-payload rows", () => {
	const equalItems = buildObjectRows(100);
	const equalTemplate = renderOnce(objectRowListFor(equalItems));
	let equalFrame = 0;

	//tick changes => structural claim => slot-diff runs; payload is reallocated with identical content => the diverging comparison runs but stays clean (no write)
	bench("tick changes, payload fresh-but-equal (object slot-diff: walk vs short-circuit)", () => {
		equalFrame++;
		for (let index = 0; index < equalItems.length; index++) {
			equalItems[index].tick = equalFrame;
			equalItems[index].payload = {
				weight: index,
				active: index % 2 === 0,
				tag: `t-${index}`,
			};
		}
		updateTemplate(equalTemplate, objectRowListFor(equalItems).currentExpressions);
	});

	const changeItems = buildObjectRows(100);
	const changeTemplate = renderOnce(objectRowListFor(changeItems));
	let changeFrame = 0;

	bench("tick + payload both change (real change control)", () => {
		changeFrame++;
		for (let index = 0; index < changeItems.length; index++) {
			changeItems[index].tick = changeFrame;
			changeItems[index].payload = {
				weight: index + changeFrame,
				active: index % 2 === 0,
				tag: `t-${index}-${changeFrame}`,
			};
		}
		updateTemplate(
			changeTemplate,
			objectRowListFor(changeItems).currentExpressions,
		);
	});
});

type TemplateRow = { tick: number; label: string };

const buildTemplateRows = (count: number): Array<TemplateRow> =>
	Array.from({ length: count }, (_, index) => ({
		tick: 0,
		label: `item-${index}`,
	}));

const templateRowListFor = (source: ReadonlyArray<TemplateRow>) =>
	html`<ul>
		${source.map(
			(item) =>
				html`<li data-tick="${item.tick}">${html`<span class="row">${item.label}</span>`}</li>`,
		)}
	</ul>`;

describe("renderList — 100 nested-template rows", () => {
	const equalItems = buildTemplateRows(100);
	const equalTemplate = renderOnce(templateRowListFor(equalItems));
	let equalFrame = 0;

	//tick changes => structural claim => slot-diff runs; the nested <span> is reallocated each frame but its label is unchanged => hash prunes the subtree, equality recurses to prove it unchanged
	bench("tick changes, nested template fresh-but-equal (template slot-diff: prune vs recurse)", () => {
		equalFrame++;
		for (let index = 0; index < equalItems.length; index++) {
			equalItems[index].tick = equalFrame;
		}
		updateTemplate(
			equalTemplate,
			templateRowListFor(equalItems).currentExpressions,
		);
	});

	const changeItems = buildTemplateRows(100);
	const changeTemplate = renderOnce(templateRowListFor(changeItems));
	let changeFrame = 0;

	bench("nested label genuinely changes (real change control: both recurse)", () => {
		changeFrame++;
		for (let index = 0; index < changeItems.length; index++) {
			changeItems[index].label = `item-${index}-f${changeFrame}`;
		}
		updateTemplate(
			changeTemplate,
			templateRowListFor(changeItems).currentExpressions,
		);
	});
});

/*
All-primitive rows — `${["a", "b", ...]}` straight into the binding, no per-item html`` from
the caller. This is the shape the no-wrapper leaf dispatch targets: each entry renders as a
bare text node instead of a wrapper template, so the per-render cost is N text-node
create/patch + the side-channel arrays, with zero wrapper allocation. No other bench covers
it (every list above maps to templates), so it is the one that shows the wrapper-drop win and
guards against a side-channel regression on the primitive path.
*/

const buildLabels = (count: number): Array<string> =>
	Array.from({ length: count }, (_, index) => `item-${index}`);

const primitiveListFor = (source: ReadonlyArray<string>) =>
	html`<ul>
		${source}
	</ul>`;

describe("renderList — 100 primitive rows, unchanged", () => {
	const labels = buildLabels(100);
	const template = renderOnce(primitiveListFor(labels));

	bench("every entry resolves at head peel (hash-hit, no DOM)", () => {
		updateTemplate(template, primitiveListFor(labels).currentExpressions);
	});
});

describe("renderList — 100 primitive rows, one changes", () => {
	const labels = buildLabels(100);
	const template = renderOnce(primitiveListFor(labels));
	let frame = 0;

	bench("one entry patched in place per call (structural text-node patch)", () => {
		frame++;
		labels[50] = `item-50-f${frame}`;
		updateTemplate(template, primitiveListFor(labels).currentExpressions);
	});
});

describe("renderList — 100 primitive rows, all change", () => {
	const labels = buildLabels(100);
	const template = renderOnce(primitiveListFor(labels));
	let frame = 0;

	bench("every entry patched per call (full structural text-node patch)", () => {
		frame++;
		for (let index = 0; index < labels.length; index++) {
			labels[index] = `item-${index}-f${frame}`;
		}
		updateTemplate(template, primitiveListFor(labels).currentExpressions);
	});
});

describe("renderList — 1000 primitive rows, append/pop alternation", () => {
	const labels1000 = buildLabels(1000);
	const labels1001 = [...labels1000, "item-tail"];
	const template = renderOnce(primitiveListFor(labels1000));
	let toggle = false;

	bench("tail growth on a long primitive list", () => {
		toggle = !toggle;
		updateTemplate(
			template,
			primitiveListFor(toggle ? labels1001 : labels1000).currentExpressions,
		);
	});
});
