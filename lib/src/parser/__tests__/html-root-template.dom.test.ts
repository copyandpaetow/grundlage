import { describe, test, expect } from "vitest";
import { getParsedTemplate } from "../html";
import { buildFragment } from "../../rendering/dom";
import { BINDING } from "../constants";
import { AttributeStaticBinding } from "../types";

const parse = (strings: TemplateStringsArray, ..._values: Array<unknown>) =>
	getParsedTemplate(strings);

describe("html parser — root template detection", () => {
	test("clean root template strips the wrapper and produces no host bindings", () => {
		const parsed = parse`<template><p>hi</p></template>`;

		expect(
			buildFragment(parsed.htmlWithMarkers).querySelector("template"),
		).toBeNull();
		expect(
			buildFragment(parsed.htmlWithMarkers).querySelector("p")?.textContent,
		).toBe("hi");
		expect(parsed.hostBindingCount).toBe(0);
	});

	test("empty root template yields an empty fragment", () => {
		const parsed = parse`<template></template>`;

		expect(buildFragment(parsed.htmlWithMarkers).childNodes).toHaveLength(0);
		expect(parsed.hostBindingCount).toBe(0);
	});

	test("non-template root has no host bindings", () => {
		const parsed = parse`<div></div>`;

		expect(parsed.hostBindingCount).toBe(0);
	});
});

describe("html parser — root template static attributes", () => {
	test("single static attribute is lowered into a binding and kept off the element", () => {
		const parsed = parse`<template id="host"></template>`;

		expect(parsed.hostBindingCount).toBe(1);
		expect(parsed.bindings).toHaveLength(1);
		expect(parsed.bindings[0]).toMatchObject({
			type: BINDING.ATTRIBUTE,
			nameParts: ["id"],
			valueParts: ["host"],
		});
		expect(
			buildFragment(parsed.htmlWithMarkers).querySelector("template"),
		).toBeNull();
	});

	test("multiple static attributes preserve source order", () => {
		const parsed = parse`<template data-z="3" data-a="1" data-m="2"></template>`;

		expect(parsed.hostBindingCount).toBe(3);
		expect(parsed.bindings).toHaveLength(3);
		expect(
			parsed.bindings.map(
				(binding) => (binding as AttributeStaticBinding).nameParts[0],
			),
		).toEqual(["data-z", "data-a", "data-m"]);
	});

	test("static attribute values preserve HTML-special characters", () => {
		const parsed = parse`<template
			title="a > b"
			data-q='he said "hi"'
		></template>`;

		expect(parsed.hostBindingCount).toBe(2);
		expect(parsed.bindings[0]).toMatchObject({
			nameParts: ["title"],
			valueParts: ["a > b"],
		});
		expect(parsed.bindings[1]).toMatchObject({
			nameParts: ["data-q"],
			valueParts: ['he said "hi"'],
		});
	});

	test("boolean static attribute is lowered with an empty value part", () => {
		const parsed = parse`<template hidden></template>`;

		expect(parsed.hostBindingCount).toBe(1);
		expect(parsed.bindings[0]).toMatchObject({
			type: BINDING.ATTRIBUTE,
			nameParts: ["hidden"],
			valueParts: [""],
		});
	});
});

describe("html parser — root template dynamic attributes", () => {
	test("single dynamic host attribute counts once and stays out of the DOM", () => {
		const id = "x";
		const parsed = parse`<template id="${id}"></template>`;

		expect(parsed.hostBindingCount).toBe(1);
		expect(parsed.bindings).toHaveLength(1);
		expect(parsed.bindings[0].type).toBe(BINDING.SINGLE_VALUE_ATTRIBUTE);
	});

	test("multiple dynamic host attributes each contribute one binding", () => {
		const a = "1";
		const b = "2";
		const c = "3";
		const parsed = parse`<template
			id="${a}"
			data-x="${b}"
			data-y="${c}"
		></template>`;

		expect(parsed.hostBindingCount).toBe(3);
		expect(parsed.bindings).toHaveLength(3);
	});

	test("multi-expression value on one attribute is one binding", () => {
		const a = "x";
		const b = "y";
		const parsed = parse`<template class="${a} ${b}"></template>`;

		expect(parsed.hostBindingCount).toBe(1);
		expect(parsed.bindings).toHaveLength(1);
		expect(parsed.bindings[0]).toMatchObject({
			type: BINDING.ATTRIBUTE,
			valueParts: [0, " ", 1],
		});
	});

	test("dynamic attribute name with static prefix", () => {
		const suffix = "name";
		const parsed = parse`<template data-${suffix}="value"></template>`;

		expect(parsed.hostBindingCount).toBe(1);
		const binding = parsed.bindings[0] as AttributeStaticBinding;
		expect(binding.nameParts[0]).toBe("data-");
	});

	test("multi-expression dynamic attribute name", () => {
		const a = "test";
		const b = "case";
		const parsed = parse`<template data-${a}-${b}="value"></template>`;

		expect(parsed.hostBindingCount).toBe(1);
		expect(parsed.bindings).toHaveLength(1);
		expect(parsed.bindings[0].type).toBe(BINDING.ATTRIBUTE);
	});

	test("dynamic boolean host attribute", () => {
		const name = "hidden";
		const parsed = parse`<template ${name}></template>`;

		expect(parsed.hostBindingCount).toBe(1);
		expect(parsed.bindings[0].type).toBe(BINDING.DYNAMIC_ATTRIBUTE);
		expect((parsed.bindings[0] as { valueIndex: number }).valueIndex).toBe(0);
	});

	test("mixed static and dynamic host attributes coexist in source order", () => {
		const dyn = "v";
		const parsed = parse`<template
			id="static"
			data-x="${dyn}"
			role="card"
		></template>`;

		expect(parsed.hostBindingCount).toBe(3);
		expect(parsed.bindings).toHaveLength(3);
		expect(parsed.bindings[0]).toMatchObject({
			nameParts: ["id"],
			valueParts: ["static"],
		});
		expect(parsed.bindings[1]).toMatchObject({
			type: BINDING.SINGLE_VALUE_ATTRIBUTE,
			nameParts: ["data-x"],
			valueIndex: 0,
		});
		expect(parsed.bindings[2]).toMatchObject({
			nameParts: ["role"],
			valueParts: ["card"],
		});
	});

	test("mixed static/dynamic value on the same attribute is one host binding", () => {
		const dyn = "active";
		const parsed = parse`<template class="prefix ${dyn} suffix"></template>`;

		expect(parsed.hostBindingCount).toBe(1);
		expect(parsed.bindings).toHaveLength(1);
	});
});

describe("html parser — root template binding ordering", () => {
	test("host bindings come first, inner bindings after", () => {
		const id = "host";
		const text = "body";
		const parsed = parse`<template id="${id}"><p>${text}</p></template>`;

		expect(parsed.hostBindingCount).toBe(1);
		expect(parsed.bindings.map((b) => b.type)).toEqual([
			BINDING.SINGLE_VALUE_ATTRIBUTE,
			BINDING.CONTENT,
		]);
	});

	test("multiple host bindings followed by inner bindings retain ordering", () => {
		const idValue = "h";
		const cls = "c";
		const inner = "txt";
		const parsed = parse`<template id="${idValue}" class="${cls}"
			><p>${inner}</p></template
		>`;

		expect(parsed.hostBindingCount).toBe(2);
		expect(parsed.bindings.map((b) => b.type)).toEqual([
			BINDING.SINGLE_VALUE_ATTRIBUTE,
			BINDING.SINGLE_VALUE_ATTRIBUTE,
			BINDING.CONTENT,
		]);
	});

	test("static host attrs precede dynamic child bindings in source order", () => {
		const text = "body";
		const parsed = parse`<template id="host"><p>${text}</p></template>`;

		expect(parsed.hostBindingCount).toBe(1);
		expect(parsed.bindings).toHaveLength(2);
		expect(parsed.bindings[0]).toMatchObject({
			type: BINDING.ATTRIBUTE,
			nameParts: ["id"],
			valueParts: ["host"],
		});
		expect(parsed.bindings[1].type).toBe(BINDING.CONTENT);
	});

	test("dynamic tag inside root template registers as a tag binding", () => {
		const tag = "section";
		const parsed = parse`<template><${tag}>x</${tag}></template>`;

		expect(parsed.bindings).toHaveLength(1);
		expect(parsed.bindings[0].type).toBe(BINDING.TAG);
		expect(parsed.hostBindingCount).toBe(0);
	});

	test("dynamic content inside root template stays as content binding", () => {
		const text = "hello";
		const parsed = parse`<template>${text}</template>`;

		expect(parsed.bindings).toHaveLength(1);
		expect(parsed.bindings[0].type).toBe(BINDING.CONTENT);
	});

	test("multiple dynamic children inside root template", () => {
		const a = 1;
		const b = 2;
		const parsed = parse`<template
			><p>${a}</p>
			<span>${b}</span></template
		>`;

		expect(parsed.bindings).toHaveLength(2);
		expect(
			parsed.bindings.every((binding) => binding.type === BINDING.CONTENT),
		).toBe(true);
	});
});

describe("html parser — root template tolerated siblings", () => {
	test("leading whitespace before root template is tolerated", () => {
		const parsed = parse` <template id="x"></template> `;

		expect(parsed.hostBindingCount).toBe(1);
		expect(parsed.bindings[0]).toMatchObject({
			nameParts: ["id"],
			valueParts: ["x"],
		});
		expect(
			buildFragment(parsed.htmlWithMarkers).querySelector("template"),
		).toBeNull();
	});

	test("trailing whitespace after root template is tolerated", () => {
		const parsed = parse`<template id="x"></template> `;

		expect(parsed.hostBindingCount).toBe(1);
		expect(parsed.bindings[0]).toMatchObject({
			nameParts: ["id"],
			valueParts: ["x"],
		});
		expect(
			buildFragment(parsed.htmlWithMarkers).querySelector("template"),
		).toBeNull();
	});

	test("only-whitespace template literal around root template still parses as root", () => {
		const parsed = parse` <template id="x"></template> `;

		expect(parsed.hostBindingCount).toBe(1);
		expect(parsed.bindings[0]).toMatchObject({
			nameParts: ["id"],
			valueParts: ["x"],
		});
	});

	test("leading static comment is tolerated", () => {
		const parsed = parse`<!-- a host template --><template id="x"></template>`;

		expect(parsed.hostBindingCount).toBe(1);
		expect(parsed.bindings[0]).toMatchObject({
			nameParts: ["id"],
			valueParts: ["x"],
		});
		expect(
			buildFragment(parsed.htmlWithMarkers).querySelector("template"),
		).toBeNull();
	});

	test("trailing static comment is tolerated", () => {
		const parsed = parse`<template id="x"></template
			><!-- trailing -->`;

		expect(parsed.hostBindingCount).toBe(1);
		expect(parsed.bindings[0]).toMatchObject({
			nameParts: ["id"],
			valueParts: ["x"],
		});
	});

	test("comments and whitespace combined on both sides are tolerated", () => {
		const parsed = parse`
			<!-- top -->
			<template id="x"></template>
			<!-- bottom -->
		`;

		expect(parsed.hostBindingCount).toBe(1);
		expect(parsed.bindings[0]).toMatchObject({
			nameParts: ["id"],
			valueParts: ["x"],
		});
	});
});

describe("html parser — root template misdetection and reparse", () => {
	test("text content before template prevents root detection", () => {
		const parsed = parse`hello<template id="x"></template>`;

		expect(parsed.hostBindingCount).toBe(0);
		expect(
			buildFragment(parsed.htmlWithMarkers)
				.querySelector("template")
				?.getAttribute("id"),
		).toBe("x");
	});

	test("text content after template prevents root detection", () => {
		const parsed = parse`<template id="x"></template>trailing text`;

		expect(parsed.hostBindingCount).toBe(0);
		expect(
			buildFragment(parsed.htmlWithMarkers)
				.querySelector("template")
				?.getAttribute("id"),
		).toBe("x");
	});

	test("element sibling after template prevents root detection", () => {
		const parsed = parse`<template></template>
			<div id="other"></div>`;

		expect(parsed.hostBindingCount).toBe(0);
		expect(
			buildFragment(parsed.htmlWithMarkers).querySelector("template"),
		).not.toBeNull();
		expect(
			buildFragment(parsed.htmlWithMarkers).querySelector("div"),
		).not.toBeNull();
	});

	test("element sibling before template prevents root detection", () => {
		const parsed = parse`<div></div>
			<template></template>`;

		expect(parsed.hostBindingCount).toBe(0);
		expect(
			buildFragment(parsed.htmlWithMarkers).querySelector("template"),
		).not.toBeNull();
		expect(
			buildFragment(parsed.htmlWithMarkers).querySelector("div"),
		).not.toBeNull();
	});

	test("dynamic attribute on a template after another element is not a host binding", () => {
		const id = "x";
		const parsed = parse`<div></div>
			<template id="${id}"></template>`;

		expect(parsed.hostBindingCount).toBe(0);
	});

	test("misdetected template's dynamic content becomes raw content", () => {
		const content = "<p>raw</p>";
		const parsed = parse`<template>${content}</template>
			<div></div>`;

		expect(parsed.bindings).toHaveLength(1);
		expect(parsed.bindings[0].type).toBe(BINDING.RAW_CONTENT);
		expect(
			buildFragment(parsed.htmlWithMarkers).querySelector("template"),
		).not.toBeNull();
	});

	test("misdetected template still records its dynamic attributes as regular bindings", () => {
		const id = "x";
		const parsed = parse`<template id="${id}"></template>
			<div></div>`;

		expect(parsed.hostBindingCount).toBe(0);
		expect(parsed.bindings).toHaveLength(1);
		expect(parsed.bindings[0].type).toBe(BINDING.SINGLE_VALUE_ATTRIBUTE);
	});

	test("reparse path does not leak forceNoRootTemplate to the next parse", () => {
		const misdetected = parse`<template></template><span></span>`;
		expect(misdetected.hostBindingCount).toBe(0);

		const clean = parse`<template id="after"></template>`;
		expect(clean.hostBindingCount).toBe(1);
		expect(clean.bindings[0]).toMatchObject({
			nameParts: ["id"],
			valueParts: ["after"],
		});
		expect(
			buildFragment(clean.htmlWithMarkers).querySelector("template"),
		).toBeNull();
	});

	test("reparse path does not leak across an inner-then-clean sequence", () => {
		const misdetectedWithDyn = parse`<template id="${"x"}"></template><i></i>`;
		expect(misdetectedWithDyn.hostBindingCount).toBe(0);

		const cleanWithDyn = parse`<template id="${"y"}"></template>`;
		expect(cleanWithDyn.hostBindingCount).toBe(1);
	});

	test("dynamic outer tag is never recognized as a root template", () => {
		const tag = "template";
		const parsed = parse`<${tag}><p>hi</p></${tag}>`;

		expect(parsed.hostBindingCount).toBe(0);
		expect(parsed.bindings).toHaveLength(1);
		expect(parsed.bindings[0].type).toBe(BINDING.TAG);
		expect(
			buildFragment(parsed.htmlWithMarkers).querySelector("template"),
		).toBeNull();
	});

	test("dynamic outer tag with dynamic attribute does not produce host bindings", () => {
		const tag = "template";
		const id = "x";
		const parsed = parse`<${tag} id="${id}"></${tag}>`;

		expect(parsed.hostBindingCount).toBe(0);
		expect(parsed.bindings.map((b) => b.type)).toEqual([
			BINDING.TAG,
			BINDING.SINGLE_VALUE_ATTRIBUTE,
		]);
	});

	test("non-template literal after a misdetection does not inherit state", () => {
		parse`<template></template>
			<div></div>`;

		const plain = parse`<section>${"hello"}</section>`;
		expect(plain.hostBindingCount).toBe(0);
		expect(
			buildFragment(plain.htmlWithMarkers).querySelector("section"),
		).not.toBeNull();
	});
});

describe("html parser — root template nested cases", () => {
	test("nested template inside root template is treated as raw content", () => {
		const slot = "<p>x</p>";
		const parsed = parse`<template id="host"
			><template>${slot}</template></template
		>`;

		expect(parsed.hostBindingCount).toBe(1);
		expect(parsed.bindings[0]).toMatchObject({
			nameParts: ["id"],
			valueParts: ["host"],
		});
		expect(parsed.bindings[1].type).toBe(BINDING.RAW_CONTENT);
		expect(
			buildFragment(parsed.htmlWithMarkers).querySelector("template"),
		).not.toBeNull();
	});

	test("template inside another element is not the root", () => {
		const content = "slot";
		const parsed = parse`<div><template>${content}</template></div>`;

		expect(parsed.hostBindingCount).toBe(0);
		expect(parsed.bindings).toHaveLength(1);
		expect(parsed.bindings[0].type).toBe(BINDING.RAW_CONTENT);
	});

	test("inner element with dynamic attribute does not count as host", () => {
		const cls = "a";
		const parsed = parse`<template id="host"><p class="${cls}">x</p></template>`;

		expect(parsed.hostBindingCount).toBe(1);
		expect(parsed.bindings).toHaveLength(2);
		expect(parsed.bindings[0]).toMatchObject({
			nameParts: ["id"],
			valueParts: ["host"],
		});
		expect(parsed.bindings[1].type).toBe(BINDING.SINGLE_VALUE_ATTRIBUTE);
	});

	test("dynamic inner tag with dynamic attribute does not count as host", () => {
		const tag = "section";
		const cls = "a";
		const parsed = parse`<template id="host"><${tag} class="${cls}">x</${tag}></template>`;

		expect(parsed.hostBindingCount).toBe(1);
		expect(parsed.bindings).toHaveLength(3);
		expect(parsed.bindings[0]).toMatchObject({
			nameParts: ["id"],
			valueParts: ["host"],
		});
		expect(parsed.bindings[1].type).toBe(BINDING.TAG);
		expect(parsed.bindings[2].type).toBe(BINDING.SINGLE_VALUE_ATTRIBUTE);
	});
});
