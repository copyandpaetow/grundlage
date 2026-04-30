// @vitest-environment happy-dom
import { bench, describe } from "vitest";
import { html } from "../../src/parser/html";
import { HTMLTemplate } from "../../src/rendering/template-html";

/*
    Dynamic tag swaps are heavy: createElement, attribute migration, child
    re-parenting, focus restoration. Benches alternate the tag name so the
    dirty check fires updateTag every call.
*/

const renderOnce = (template: HTMLTemplate) => {
	const host = document.createElement("div");
	host.attachShadow({ mode: "open" }).appendChild(template.setup());
	return template;
};

describe("updateTag — minimal element (no attrs, no children)", () => {
	const template = renderOnce(html`<${"span"}></${"span"}>`);
	let toggle = false;

	bench("swap span <-> div", () => {
		toggle = !toggle;
		const tag = toggle ? "div" : "span";
		template.update([tag, tag]);
	});
});

describe("updateTag — element with static attrs", () => {
	const template = renderOnce(
		html`<${"span"} class="box" id="main" role="presentation"></${"span"}>`,
	);
	let toggle = false;

	bench("swap with 3 static attrs (attribute migration loop)", () => {
		toggle = !toggle;
		const tag = toggle ? "div" : "span";
		template.update([tag, tag]);
	});
});

describe("updateTag — element wrapping static children", () => {
	const template = renderOnce(html`
		<${"span"}>
			<em>a</em>
			<em>b</em>
			<em>c</em>
			<em>d</em>
			<em>e</em>
		</${"span"}>
	`);
	let toggle = false;

	bench("swap parent of 5 children (firstChild re-parenting loop)", () => {
		toggle = !toggle;
		const tag = toggle ? "div" : "span";
		template.update([tag, tag]);
	});
});

describe("updateTag — element with related dynamic attribute", () => {
	const template = renderOnce(
		html`<${"span"} class="${"a"}">x</${"span"}>`,
	);
	let toggle = false;
	let counter = 0;

	bench("swap also marks related attr binding dirty", () => {
		toggle = !toggle;
		counter++;
		const tag = toggle ? "div" : "span";
		template.update([tag, `class-${counter}`, tag]);
	});
});
