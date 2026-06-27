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
Deep-nesting divergence bench — the one shape where the hash comparison and a
short-circuiting equality comparison can actually part ways.

`template-update.bench.ts` covers shallow shapes where both behave identically (a
primitive slot is `===` either way). The cost models only diverge once a slot
holds a *nested template subtree*:

  - hash: a fresh subtree is walked to completion to produce its number, but a
    reused child is read from its memoized `hash` field (the prevented descent).
    A changed branch must still be hashed fully before it can be seen to differ.
  - equality: compares shape then recurses pairwise, bailing on the first `===`
    slot and on the first differing leaf — but a fresh-but-equal subtree cannot
    bail; it must be walked to be proven equal.

The point of contention is the caller's frame shape, so each describe pins one
regime; the A/B (current hash baseline vs. a swapped equality comparison) then
shows the whole trade instead of one cherry-picked direction:

  - persistent-equal .... the cleanest discriminator, construction-free. Two
                          distinct-but-equal instances alternate, so the hash
                          reads their memoized `hash` field (O(top-level)) while
                          an equality comparison cannot memoize — distinct
                          instances aren't `===`, so it must walk the subtree to
                          prove equality. The A/B delta here is the pure
                          memoization-vs-forced-walk cost.
  - stable siblings ..... reused subtrees `===`-bail for equality and read cached
                          for hash — the symmetry test (both should prune fast).
  - reference-stable .... the `===` floor both share.
  - all-fresh ........... realistic naive-rerender frame; construction dominates,
                          so it bounds how small the comparison's share actually
                          is rather than discriminating the two approaches.

A fresh instance (`hash === null`) is the only thing that forces a full walk, and
making one fresh *is* construction — so a forced walk can never be measured apart
from construction. That is why the all-fresh regime can't isolate the comparison,
and why the persistent-equal regime carries the construction-free signal instead.

Construction cost is identical under either comparison implementation, so where it
appears it is common-mode and cancels in the A/B delta. Parsing is cached per call
site (html` ` keys on its strings), so per-frame work is clone + struct
allocation, not re-parse.
*/

const BRANCHING_DEPTH = 4; //3-way branch × depth 4 = 121 templates, 81 leaves — deep and wide enough that skippable branches matter
const CONST_LEAF = 0;

const makeLeaf = (value: number): HTMLTemplate => html`<span>${value}</span>`;
const makeBranch = (
	first: HTMLTemplate,
	second: HTMLTemplate,
	third: HTMLTemplate,
): HTMLTemplate => html`<div>${first}${second}${third}</div>`;

//a subtree whose every leaf is the constant value — fresh instances, stable content
const buildConstSubtree = (depth: number): HTMLTemplate =>
	depth === 0
		? makeLeaf(CONST_LEAF)
		: makeBranch(
				buildConstSubtree(depth - 1),
				buildConstSubtree(depth - 1),
				buildConstSubtree(depth - 1),
			);

//every node fresh; only the leftmost-spine leaf carries the changing value, every other leaf stays constant
const buildFreshTreeChangingOneLeaf = (
	depth: number,
	spineLeaf: number,
): HTMLTemplate =>
	depth === 0
		? makeLeaf(spineLeaf)
		: makeBranch(
				buildFreshTreeChangingOneLeaf(depth - 1, spineLeaf),
				buildConstSubtree(depth - 1),
				buildConstSubtree(depth - 1),
			);

//captures the two off-spine sibling subtrees at each spine level so later frames can reuse the same instances (=== bail / cached hash) and rebuild only the spine
const spineSiblings: Array<[HTMLTemplate, HTMLTemplate]> = [];
const buildBaselineCapturingSpineSiblings = (depth: number): HTMLTemplate => {
	if (depth === 0) return makeLeaf(CONST_LEAF);
	const spineChild = buildBaselineCapturingSpineSiblings(depth - 1);
	const sibling = buildConstSubtree(depth - 1);
	const otherSibling = buildConstSubtree(depth - 1);
	spineSiblings[depth] = [sibling, otherSibling];
	return makeBranch(spineChild, sibling, otherSibling);
};

//fresh instances down the spine, reused captured siblings everywhere else — every off-spine slot is reference-equal, only the spine recurses
const rebuildSpineReusingStableSiblings = (
	depth: number,
	spineLeaf: number,
): HTMLTemplate => {
	if (depth === 0) return makeLeaf(spineLeaf);
	const [sibling, otherSibling] = spineSiblings[depth];
	return makeBranch(
		rebuildSpineReusingStableSiblings(depth - 1, spineLeaf),
		sibling,
		otherSibling,
	);
};

const renderOnce = (template: HTMLTemplate): HTMLTemplate => {
	const host = document.createElement("div");
	host.attachShadow({ mode: "open" }).appendChild(setupTemplate(template));
	return template;
};

describe("deep nesting — full fresh rebuild, one leaf changes", () => {
	const template = renderOnce(
		buildFreshTreeChangingOneLeaf(BRANCHING_DEPTH, 0),
	);
	let spineLeaf = 0;

	bench("121 templates, every instance fresh, off-spine subtrees equal-but-fresh", () => {
		spineLeaf++;
		updateTemplate(
			template,
			buildFreshTreeChangingOneLeaf(BRANCHING_DEPTH, spineLeaf)
				.currentExpressions,
		);
	});
});

describe("deep nesting — stable siblings, only the spine rebuilt", () => {
	const template = renderOnce(
		buildBaselineCapturingSpineSiblings(BRANCHING_DEPTH),
	);
	let spineLeaf = 0;

	bench("121 templates, off-spine subtrees reference-stable, one leaf changes", () => {
		spineLeaf++;
		updateTemplate(
			template,
			rebuildSpineReusingStableSiblings(BRANCHING_DEPTH, spineLeaf)
				.currentExpressions,
		);
	});
});

describe("deep nesting — persistent equal instances (cached-hash vs forced-walk)", () => {
	const template = renderOnce(buildConstSubtree(BRANCHING_DEPTH));
	//two distinct, content-equal trees that persist across frames: the hash memoizes on each, equality cannot (they are never ===)
	const equalTreeA = buildConstSubtree(BRANCHING_DEPTH);
	const equalTreeB = buildConstSubtree(BRANCHING_DEPTH);
	let toggle = false;

	bench("121 templates, nothing changes, two persistent equal instances alternating", () => {
		toggle = !toggle;
		updateTemplate(
			template,
			(toggle ? equalTreeA : equalTreeB).currentExpressions,
		);
	});
});

describe("deep nesting — no-op, reference-stable (=== floor)", () => {
	const root = buildConstSubtree(BRANCHING_DEPTH);
	const template = renderOnce(root);
	const stableChildren = root.currentExpressions.slice();

	bench("121 templates, identical references, top-level === bail", () => {
		updateTemplate(template, stableChildren);
	});
});
