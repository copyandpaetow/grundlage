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
    Dynamic tag swaps are heavy: createElement, attribute migration, child
    re-parenting, focus restoration. Benches alternate the tag name so the
    dirty check fires updateTag every call.
*/

const renderOnce = (template: HTMLTemplate) => {
	const host = document.createElement("div");
	host.attachShadow({ mode: "open" }).appendChild(setupTemplate(template));
	return template;
};

describe("updateTag — minimal element (no attrs, no children)", () => {
	const template = renderOnce(html`<${"span"}></${"span"}>`);
	let toggle = false;

	bench("swap span <-> div", () => {
		toggle = !toggle;
		const tag = toggle ? "div" : "span";
		updateTemplate(template, [tag, tag]);
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
		updateTemplate(template, [tag, tag]);
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
		updateTemplate(template, [tag, tag]);
	});
});

describe("updateTag — first flush resolves to the placeholder tag", () => {
	// dynamic tags emit a <div> placeholder; a tag that resolves to "div" matches what
	// is already mounted, so the identical-tag guard skips the placeholder rebuild
	// (createElement + attribute copy + child re-parent) the first flush would run
	bench("setup <${'div'}> with static attrs + 5 children", () => {
		const template = html`
			<${"div"} class="box" id="main" role="presentation">
				<em>a</em><em>b</em><em>c</em><em>d</em><em>e</em>
			</${"div"}>`;
		const host = document.createElement("div");
		host.attachShadow({ mode: "open" }).appendChild(setupTemplate(template));
	});
});

describe("updateTag — element with related dynamic attribute", () => {
	const template = renderOnce(html`<${"span"} class="${"a"}">x</${"span"}>`);
	let toggle = false;
	let counter = 0;

	bench("swap also marks related attr binding dirty", () => {
		toggle = !toggle;
		counter++;
		const tag = toggle ? "div" : "span";
		updateTemplate(template, [tag, `class-${counter}`, tag]);
	});
});
