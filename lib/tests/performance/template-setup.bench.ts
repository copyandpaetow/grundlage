// @vitest-environment happy-dom
import { describe } from "vitest";
import { html } from "../../src/parser/html";
import { HTMLTemplate } from "../../src/rendering/template-html";
import { BaseComponent } from "../../src/types";
import { bench } from "./bench-options";

/*
Setup-side measurements — the cold cost of going from a tagged template literal to a mounted DOM fragment:
  - html() — TemplateStringsArray identity → cached ParsedHTML lookup + HTMLTemplate construction
  - setup() — fragment.cloneNode + findTargets TreeWalker pass + initial #flush

setup() runs on every component mount and every list-item insert, so movement here propagates into the higher-level benches too.
*/

const mountInShadow = (template: HTMLTemplate) => {
	const host = document.createElement("div");
	host.attachShadow({ mode: "open" }).appendChild(template.setup());
	return template;
};

describe("html() — tagged template construction (warm cache)", () => {
	bench("small template (2 expressions)", () => {
		html`<p class="${"x"}">${"y"}</p>`;
	});

	bench("animation-shape template (20 attribute expressions)", () => {
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

describe("HTMLTemplate.setup() — typical shapes", () => {
	bench("small template (one attr + one content binding)", () => {
		mountInShadow(html`<p class="${"x"}">${"y"}</p>`);
	});

	bench("animation-shape template (20 attribute bindings)", () => {
		mountInShadow(html`
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

/*
Tier 1.1 in PERFORMANCE.md — findTargets unconditionally allocates a TreeWalker and reads its first nextNode(), even when bindings.length === hostBindingOffset (host-only) or bindings.length === 0 (no expressions at all).
=> these two benches isolate that overhead. A "skip the walker when there are no child markers to find" change should drop both measurably while leaving every other setup bench unmoved — that side-by-side movement is what tells us the change worked and didn't regress the non-target paths.
the host-only bench passes a host element because findTargets refuses to set up a host-bindings template without one; the zero-binding bench passes nothing because the template has no expressions at all.
*/
describe("HTMLTemplate.setup() — TreeWalker-skip opportunities (Tier 1.1)", () => {
	bench("zero-binding template (no expressions at all)", () => {
		mountInShadow(html`<p>static content</p>`);
	});

	bench("host-only template (one static host attr, no child bindings)", () => {
		const host = document.createElement("div");
		host.attachShadow({ mode: "open" });
		const template = html`<template class="card"><slot></slot></template>`;
		host.shadowRoot!.appendChild(
			template.setup(host as unknown as BaseComponent),
		);
	});
});
