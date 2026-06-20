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
TIER 0 of the committed-state plan (docs/plans/committed-state-implementation-plan.md §7).

These measure the IDLE re-render — "parent re-renders, nothing changed" — against TODAY's hash engine.
Every existing list bench mutates or alternates; none of them measure the zero-change frame, which is
the exact case committed-state is supposed to win on. So these benches both (a) establish the baseline
the new model must beat and (b) are reusable verbatim as the A/B once phases 1–3 exist.

What today does on an idle frame (template-html.ts):
  - nested template slot  → needsContentCompare → one deep hashValue/hashTemplate walk → match → skip flush
  - object-valued slot     → needsContentCompare → hashValue(obj) walk → match → skip flush
  - primitive slot         → input `===` settles it before any hashing → no dirty, no flush
  - list slot              → renderList builds a claim Map via hashTemplate over N rows, head-peels, skips

IMPORTANT (per the standing read of these numbers): look at relative AND absolute (p75 µs/ns) together,
run a few times, and do NOT conclude from Tier 0/1 alone. Even if a primitive looks even-or-worse here,
the plan can still net out faster as a whole — this tier is foreshadowing, not the gate.
*/

const renderOnce = (template: HTMLTemplate): HTMLTemplate => {
	const host = document.createElement("div");
	host.attachShadow({ mode: "open" }).appendChild(setupTemplate(template));
	return template;
};

/*
Idle deep nested-template tree — THE headline number (§7 "single most important").
Today: one hashValue walk down the fresh incoming tree at the top binding, match, skip the whole subtree.
After: recurse + leaf-compare every level every frame. We capture the "skip" cost here so the A/B has a floor.
*/
const leaf = (text: string) => html`<span>${text}</span>`;
const wrap = (child: HTMLTemplate) => html`<section>${child}</section>`;
const treeFor = (depth: number, text: string): HTMLTemplate => {
	let node = leaf(text);
	for (let level = 0; level < depth; level++) node = wrap(node);
	return node;
};

describe("idle re-render — nested template tree (depth 4)", () => {
	const template = renderOnce(treeFor(4, "stable"));
	bench(
		"re-render, nothing changed (today: one deep hash, skip subtree)",
		() => {
			updateTemplate(template, treeFor(4, "stable").currentExpressions);
		},
	);
});

describe("idle re-render — nested template tree (depth 8)", () => {
	const template = renderOnce(treeFor(8, "stable"));
	bench(
		"re-render, nothing changed (today: one deep hash, skip subtree)",
		() => {
			updateTemplate(template, treeFor(8, "stable").currentExpressions);
		},
	);
});

/*
Idle list — list-scale version of the same skip. Same items re-rendered: each frame produces fresh row
templates (so the array ref differs and the list binding goes dirty), renderList builds a claim Map via
hashTemplate over the rows, every row head-peels, nothing touches the DOM.
*/
const buildItems = (count: number) =>
	Array.from({ length: count }, (_, index) => ({
		id: index,
		label: `item-${index}`,
	}));

const listFor = (source: ReadonlyArray<{ id: number; label: string }>) =>
	html`<ul>
		${source.map((item) => html`<li data-id="${item.id}">${item.label}</li>`)}
	</ul>`;

for (const count of [20, 100, 1000]) {
	describe(`idle re-render — list, unchanged (N=${count})`, () => {
		const items = buildItems(count);
		const template = renderOnce(listFor(items));
		bench(
			`re-render same ${count} items (today: N hashTemplate, head-peel, skip)`,
			() => {
				updateTemplate(template, listFor(items).currentExpressions);
			},
		);
	});
}

/*
Idle component, fresh-but-equal object prop — the regression-2-relevant idle. A fresh object literal each
frame (different ref, identical contents) fails the input `===`, so today it falls to the hashValue(obj)
gate, matches, and skips. After: input `===` fails the same way, then shallowEqual decides. This baselines
the hashValue(obj) walk that shallowEqual will replace (Tier 1 measures the two primitives in isolation).
*/
const freshMeta = () => ({
	id: 7,
	role: "admin",
	active: true,
	score: 42,
	tag: null,
});
const widget = (data: object) => html`<div data-meta="${data}"></div>`;

describe("idle re-render — fresh-but-equal object prop", () => {
	const template = renderOnce(widget(freshMeta()));
	bench(
		"re-render fresh-but-equal object (today: hashValue(obj), skip)",
		() => {
			updateTemplate(template, widget(freshMeta()).currentExpressions);
		},
	);
});

/*
Idle wide component, all-primitive attrs — the input-`===` floor. No object/template slots, so nothing
ever reaches the hash gate: updateTemplate's `===` loop settles every attr and flush is a no-op. This is
the path committed-state keeps verbatim (the `===` pre-filter survives), so the A/B should show ~no delta;
it's here so a regression in that loop can't hide.
*/
const wideRow = (
	a: string,
	b: string,
	c: string,
	d: string,
	e: string,
	f: string,
) =>
	html`<div
		class="${a}"
		id="${b}"
		title="${c}"
		lang="${d}"
		dir="${e}"
		role="${f}"
	></div>`;

describe("idle re-render — wide component, all-primitive attrs (=== floor)", () => {
	const template = renderOnce(wideRow("x", "y", "z", "en", "ltr", "button"));
	bench("re-render same 6 primitive attrs (today: === loop, no flush)", () => {
		updateTemplate(
			template,
			wideRow("x", "y", "z", "en", "ltr", "button").currentExpressions,
		);
	});
});

/*
PARTIAL update — the ONE shape where flush-all diverges from the per-binding dirty bitset. A wide template
where exactly one of N bindings changes per frame. The bitset flushes only the 1 changed binding; flush-all
re-derives + self-gates ALL N (the unchanged N-1 each do a getAttribute compare and skip the setAttribute).
So this bench isolates the cost of dropping expressionToBinding/dirtyBindings: (N-1) wasted getAttribute reads.
Idle (nothing changed) is unaffected — the whole-template early-out skips the flush in both models.
*/
const wide10 = (v: ReadonlyArray<string>) =>
	html`<div
		data-a="${v[0]}"
		data-b="${v[1]}"
		data-c="${v[2]}"
		data-d="${v[3]}"
		data-e="${v[4]}"
		data-f="${v[5]}"
		data-g="${v[6]}"
		data-h="${v[7]}"
		data-i="${v[8]}"
		data-j="${v[9]}"
	></div>`;

describe("partial update — wide template (10 attrs), 1 changes", () => {
	const base = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"];
	const template = renderOnce(wide10(base));
	let frame = 0;
	bench("one of ten attrs changes (flush-all re-derives all 10)", () => {
		frame++;
		const next = base.slice();
		next[0] = `a-${frame}`;
		updateTemplate(template, wide10(next).currentExpressions);
	});
});
