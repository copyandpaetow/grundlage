import { describe, test, expect } from "vitest";
import { html } from "../html";
import { buildFragment } from "../../rendering/build-fragment";
import { AttributeBinding, BINDING_TYPES } from "../types";

describe("html parser — root template detection", () => {
	test("clean root template strips the wrapper and produces no host bindings", () => {
		const parsed = html`<template><p>hi</p></template>`.parsedHTML;

		expect(buildFragment(parsed.result).querySelector("template")).toBeNull();
		expect(buildFragment(parsed.result).querySelector("p")?.textContent).toBe(
			"hi",
		);
		expect(parsed.hostBindingOffset).toBe(0);
	});

	test("empty root template yields an empty fragment", () => {
		const parsed = html`<template></template>`.parsedHTML;

		expect(buildFragment(parsed.result).childNodes).toHaveLength(0);
		expect(parsed.hostBindingOffset).toBe(0);
	});

	test("non-template root has no host bindings", () => {
		const parsed = html`<div></div>`.parsedHTML;

		expect(parsed.hostBindingOffset).toBe(0);
	});
});

describe("html parser — root template static attributes", () => {
	test("single static attribute is lowered into a binding and kept off the element", () => {
		const parsed = html`<template id="host"></template>`.parsedHTML;

		expect(parsed.hostBindingOffset).toBe(1);
		expect(parsed.bindings).toHaveLength(1);
		expect(parsed.bindings[0]).toMatchObject({
			type: BINDING_TYPES.ATTR,
			keys: ["id"],
			values: ["host"],
		});
		expect(buildFragment(parsed.result).querySelector("template")).toBeNull();
	});

	test("multiple static attributes preserve source order", () => {
		const parsed = html`<template data-z="3" data-a="1" data-m="2"></template>`
			.parsedHTML;

		expect(parsed.hostBindingOffset).toBe(3);
		expect(parsed.bindings).toHaveLength(3);
		expect(
			parsed.bindings.map((binding) => (binding as AttributeBinding).keys[0]),
		).toEqual(["data-z", "data-a", "data-m"]);
	});

	test("static attribute values preserve HTML-special characters", () => {
		const parsed = html`<template
			title="a > b"
			data-q='he said "hi"'
		></template>`.parsedHTML;

		expect(parsed.hostBindingOffset).toBe(2);
		expect(parsed.bindings[0]).toMatchObject({
			keys: ["title"],
			values: ["a > b"],
		});
		expect(parsed.bindings[1]).toMatchObject({
			keys: ["data-q"],
			values: ['he said "hi"'],
		});
	});

	test("boolean static attribute is lowered with empty values", () => {
		const parsed = html`<template hidden></template>`.parsedHTML;

		expect(parsed.hostBindingOffset).toBe(1);
		expect(parsed.bindings[0]).toMatchObject({
			type: BINDING_TYPES.ATTR,
			keys: ["hidden"],
			values: [],
		});
	});
});

describe("html parser — root template dynamic attributes", () => {
	test("single dynamic host attribute counts once and stays out of the DOM", () => {
		const id = "x";
		const parsed = html`<template id="${id}"></template>`.parsedHTML;

		expect(parsed.hostBindingOffset).toBe(1);
		expect(parsed.bindings).toHaveLength(1);
		expect(parsed.bindings[0].type).toBe(BINDING_TYPES.ATTR);
	});

	test("multiple dynamic host attributes each contribute one binding", () => {
		const a = "1";
		const b = "2";
		const c = "3";
		const parsed = html`<template
			id="${a}"
			data-x="${b}"
			data-y="${c}"
		></template>`.parsedHTML;

		expect(parsed.hostBindingOffset).toBe(3);
		expect(parsed.bindings).toHaveLength(3);
	});

	test("multi-expression value on one attribute is one binding", () => {
		//two expressions on the same attribute must collapse into one binding,
		//and expressionToBinding has to mirror that mapping
		const a = "x";
		const b = "y";
		const parsed = html`<template class="${a} ${b}"></template>`.parsedHTML;

		expect(parsed.hostBindingOffset).toBe(1);
		expect(parsed.bindings).toHaveLength(1);
		expect(parsed.expressionToBinding).toEqual([0, 0]);
	});

	test("dynamic attribute name with static prefix", () => {
		const suffix = "name";
		const parsed = html`<template data-${suffix}="value"></template>`
			.parsedHTML;

		expect(parsed.hostBindingOffset).toBe(1);
		const binding = parsed.bindings[0] as AttributeBinding;
		expect(binding.keys[0]).toBe("data-");
	});

	test("multi-expression dynamic attribute name", () => {
		const a = "test";
		const b = "case";
		const parsed = html`<template data-${a}-${b}="value"></template>`
			.parsedHTML;

		expect(parsed.hostBindingOffset).toBe(1);
		expect(parsed.bindings).toHaveLength(1);
		expect(parsed.expressionToBinding).toEqual([0, 0]);
	});

	test("dynamic boolean host attribute", () => {
		const name = "hidden";
		const parsed = html`<template ${name}></template>`.parsedHTML;

		expect(parsed.hostBindingOffset).toBe(1);
		const binding = parsed.bindings[0] as AttributeBinding;
		expect(binding.values).toEqual([0]);
		expect(binding.keys).toHaveLength(0);
	});

	test("mixed static and dynamic host attributes coexist in source order", () => {
		const dyn = "v";
		const parsed = html`<template
			id="static"
			data-x="${dyn}"
			role="card"
		></template>`.parsedHTML;

		//all three count toward hostBindingOffset and share the bindings array
		expect(parsed.hostBindingOffset).toBe(3);
		expect(parsed.bindings).toHaveLength(3);
		expect(parsed.bindings[0]).toMatchObject({
			keys: ["id"],
			values: ["static"],
		});
		expect((parsed.bindings[1] as AttributeBinding).keys).toEqual(["data-x"]);
		expect((parsed.bindings[1] as AttributeBinding).values).toEqual([0]);
		expect(parsed.bindings[2]).toMatchObject({
			keys: ["role"],
			values: ["card"],
		});
		//only the dynamic one consumes an expression slot
		expect(parsed.expressionToBinding).toEqual([1]);
	});

	test("mixed static/dynamic value on the same attribute is one host binding", () => {
		//a partially-dynamic attribute can't be split into separate static/dynamic
		//bindings — the binding owns the whole attribute
		const dyn = "active";
		const parsed = html`<template class="prefix ${dyn} suffix"></template>`
			.parsedHTML;

		expect(parsed.hostBindingOffset).toBe(1);
		expect(parsed.bindings).toHaveLength(1);
	});
});

describe("html parser — root template binding ordering", () => {
	test("host bindings come first, inner bindings after", () => {
		const id = "host";
		const text = "body";
		const parsed = html`<template id="${id}"><p>${text}</p></template>`
			.parsedHTML;

		expect(parsed.hostBindingOffset).toBe(1);
		expect(parsed.bindings).toHaveLength(2);
		expect(parsed.bindings[0].type).toBe(BINDING_TYPES.ATTR);
		expect(parsed.bindings[1].type).toBe(BINDING_TYPES.CONTENT);
	});

	test("multiple host bindings followed by inner bindings retain ordering", () => {
		const idValue = "h";
		const cls = "c";
		const inner = "txt";
		const parsed = html`<template id="${idValue}" class="${cls}"
			><p>${inner}</p></template
		>`.parsedHTML;

		expect(parsed.hostBindingOffset).toBe(2);
		expect(parsed.bindings).toHaveLength(3);
		expect(parsed.bindings[0].type).toBe(BINDING_TYPES.ATTR);
		expect(parsed.bindings[1].type).toBe(BINDING_TYPES.ATTR);
		expect(parsed.bindings[2].type).toBe(BINDING_TYPES.CONTENT);
		expect(parsed.expressionToBinding).toEqual([0, 1, 2]);
	});

	test("static host attrs precede dynamic child bindings in source order", () => {
		const text = "body";
		const parsed = html`<template id="host"><p>${text}</p></template>`
			.parsedHTML;

		expect(parsed.hostBindingOffset).toBe(1);
		expect(parsed.bindings).toHaveLength(2);
		expect(parsed.bindings[0]).toMatchObject({
			type: BINDING_TYPES.ATTR,
			keys: ["id"],
			values: ["host"],
		});
		expect(parsed.bindings[1].type).toBe(BINDING_TYPES.CONTENT);
		//only the dynamic content consumes an expression slot
		expect(parsed.expressionToBinding).toEqual([1]);
	});

	test("dynamic tag inside root template registers as a tag binding", () => {
		const tag = "section";
		const parsed = html`<template><${tag}>x</${tag}></template>`.parsedHTML;

		expect(parsed.bindings).toHaveLength(1);
		expect(parsed.bindings[0].type).toBe(BINDING_TYPES.TAG);
		expect(parsed.hostBindingOffset).toBe(0);
	});

	test("dynamic content inside root template stays as content binding", () => {
		const text = "hello";
		const parsed = html`<template>${text}</template>`.parsedHTML;

		expect(parsed.bindings).toHaveLength(1);
		expect(parsed.bindings[0].type).toBe(BINDING_TYPES.CONTENT);
	});

	test("multiple dynamic children inside root template", () => {
		const a = 1;
		const b = 2;
		const parsed = html`<template
			><p>${a}</p>
			<span>${b}</span></template
		>`.parsedHTML;

		expect(parsed.bindings).toHaveLength(2);
		expect(
			parsed.bindings.every(
				(binding) => binding.type === BINDING_TYPES.CONTENT,
			),
		).toBe(true);
	});
});

describe("html parser — root template tolerated siblings", () => {
	test("leading whitespace before root template is tolerated", () => {
		const parsed = html` <template id="x"></template> `.parsedHTML;

		expect(parsed.hostBindingOffset).toBe(1);
		expect(parsed.bindings[0]).toMatchObject({ keys: ["id"], values: ["x"] });
		expect(buildFragment(parsed.result).querySelector("template")).toBeNull();
	});

	test("trailing whitespace after root template is tolerated", () => {
		const parsed = html`<template id="x"></template> `.parsedHTML;

		expect(parsed.hostBindingOffset).toBe(1);
		expect(parsed.bindings[0]).toMatchObject({ keys: ["id"], values: ["x"] });
		expect(buildFragment(parsed.result).querySelector("template")).toBeNull();
	});

	test("only-whitespace template literal around root template still parses as root", () => {
		const parsed = html` <template id="x"></template> `.parsedHTML;

		expect(parsed.hostBindingOffset).toBe(1);
		expect(parsed.bindings[0]).toMatchObject({ keys: ["id"], values: ["x"] });
	});

	test("leading static comment is tolerated", () => {
		const parsed = html`<!-- a host template --><template id="x"></template>`
			.parsedHTML;

		expect(parsed.hostBindingOffset).toBe(1);
		expect(parsed.bindings[0]).toMatchObject({ keys: ["id"], values: ["x"] });
		expect(buildFragment(parsed.result).querySelector("template")).toBeNull();
	});

	test("trailing static comment is tolerated", () => {
		const parsed = html`<template id="x"></template
			><!-- trailing -->`.parsedHTML;

		expect(parsed.hostBindingOffset).toBe(1);
		expect(parsed.bindings[0]).toMatchObject({ keys: ["id"], values: ["x"] });
	});

	test("comments and whitespace combined on both sides are tolerated", () => {
		const parsed = html`
			<!-- top -->
			<template id="x"></template>
			<!-- bottom -->
		`.parsedHTML;

		expect(parsed.hostBindingOffset).toBe(1);
		expect(parsed.bindings[0]).toMatchObject({ keys: ["id"], values: ["x"] });
	});
});

describe("html parser — root template misdetection and reparse", () => {
	test("text content before template prevents root detection", () => {
		//reparse path leaves isRootTemplate false, so the static attr stays on the
		//template element in the serialized fragment instead of becoming a host binding
		const parsed = html`hello<template id="x"></template>`.parsedHTML;

		expect(parsed.hostBindingOffset).toBe(0);
		expect(
			buildFragment(parsed.result)
				.querySelector("template")
				?.getAttribute("id"),
		).toBe("x");
	});

	test("text content after template prevents root detection", () => {
		const parsed = html`<template id="x"></template>trailing text`.parsedHTML;

		expect(parsed.hostBindingOffset).toBe(0);
		expect(
			buildFragment(parsed.result)
				.querySelector("template")
				?.getAttribute("id"),
		).toBe("x");
	});

	test("element sibling after template prevents root detection", () => {
		const parsed = html`<template></template>
			<div id="other"></div>`.parsedHTML;

		expect(parsed.hostBindingOffset).toBe(0);
		expect(
			buildFragment(parsed.result).querySelector("template"),
		).not.toBeNull();
		expect(buildFragment(parsed.result).querySelector("div")).not.toBeNull();
	});

	test("element sibling before template prevents root detection", () => {
		const parsed = html`<div></div>
			<template></template>`.parsedHTML;

		expect(parsed.hostBindingOffset).toBe(0);
		expect(
			buildFragment(parsed.result).querySelector("template"),
		).not.toBeNull();
		expect(buildFragment(parsed.result).querySelector("div")).not.toBeNull();
	});

	test("dynamic attribute on a template after another element is not a host binding", () => {
		//openTagBindings.length === 0 fires both for "first tag ever" and for
		//"all previously-opened tags have closed" — the post-parse check skips the
		//reparse because firstElementChild is the div, leaving the bogus host
		//state in place. needs a monotonic "any tag ever opened" flag at parse time
		const id = "x";
		const parsed = html`<div></div>
			<template id="${id}"></template>`.parsedHTML;

		expect(parsed.hostBindingOffset).toBe(0);
	});

	test("misdetected template's dynamic content becomes raw content", () => {
		const content = "<p>raw</p>";
		const parsed = html`<template>${content}</template>
			<div></div>`.parsedHTML;

		expect(parsed.bindings).toHaveLength(1);
		expect(parsed.bindings[0].type).toBe(BINDING_TYPES.RAW_CONTENT);
		expect(
			buildFragment(parsed.result).querySelector("template"),
		).not.toBeNull();
	});

	test("misdetected template still records its dynamic attributes as regular bindings", () => {
		const id = "x";
		const parsed = html`<template id="${id}"></template>
			<div></div>`.parsedHTML;

		//the dynamic attribute survives as an ATTR binding, but it targets the
		//(non-root) template element and does not count toward hostBindingOffset
		expect(parsed.hostBindingOffset).toBe(0);
		expect(parsed.bindings).toHaveLength(1);
		expect(parsed.bindings[0].type).toBe(BINDING_TYPES.ATTR);
	});

	test("reparse path does not leak forceNoRootTemplate to the next parse", () => {
		//a misdetected case sets forceNoRootTemplate true mid-parse;
		//if we forgot to reset, the very next clean root template would fail to lower its host attrs
		const misdetected = html`<template></template><span></span>`.parsedHTML;
		expect(misdetected.hostBindingOffset).toBe(0);

		const clean = html`<template id="after"></template>`.parsedHTML;
		expect(clean.hostBindingOffset).toBe(1);
		expect(clean.bindings[0]).toMatchObject({
			keys: ["id"],
			values: ["after"],
		});
		expect(buildFragment(clean.result).querySelector("template")).toBeNull();
	});

	test("reparse path does not leak across an inner-then-clean sequence", () => {
		const misdetectedWithDyn = html`<template id="${"x"}"></template><i></i>`
			.parsedHTML;
		expect(misdetectedWithDyn.hostBindingOffset).toBe(0);

		const cleanWithDyn = html`<template id="${"y"}"></template>`.parsedHTML;
		expect(cleanWithDyn.hostBindingOffset).toBe(1);
	});

	test("dynamic outer tag is never recognized as a root template", () => {
		//even when the runtime tag name is "template", the open tag is dynamic so
		//the parser emits PLACEHOLDER_TAG ("div") into the fragment — the host-template
		//path keys off the literal tag name, so this must stay an inner TAG binding
		const tag = "template";
		const parsed = html`<${tag}><p>hi</p></${tag}>`.parsedHTML;

		expect(parsed.hostBindingOffset).toBe(0);
		expect(parsed.bindings).toHaveLength(1);
		expect(parsed.bindings[0].type).toBe(BINDING_TYPES.TAG);
		expect(buildFragment(parsed.result).querySelector("template")).toBeNull();
	});

	test("dynamic outer tag with dynamic attribute does not produce host bindings", () => {
		const tag = "template";
		const id = "x";
		const parsed = html`<${tag} id="${id}"></${tag}>`.parsedHTML;

		expect(parsed.hostBindingOffset).toBe(0);
		expect(parsed.bindings).toHaveLength(2);
		expect(parsed.bindings[0].type).toBe(BINDING_TYPES.TAG);
		expect(parsed.bindings[1].type).toBe(BINDING_TYPES.ATTR);
	});

	test("non-template literal after a misdetection does not inherit state", () => {
		html`<template></template>
			<div></div>`.parsedHTML;

		const plain = html`<section>${"hello"}</section>`.parsedHTML;
		expect(plain.hostBindingOffset).toBe(0);
		expect(buildFragment(plain.result).querySelector("section")).not.toBeNull();
	});
});

describe("html parser — root template nested cases", () => {
	test("nested template inside root template is treated as raw content", () => {
		const slot = "<p>x</p>";
		const parsed = html`<template id="host"
			><template>${slot}</template></template
		>`.parsedHTML;

		expect(parsed.hostBindingOffset).toBe(1);
		expect(parsed.bindings[0]).toMatchObject({
			keys: ["id"],
			values: ["host"],
		});
		expect(parsed.bindings[1].type).toBe(BINDING_TYPES.RAW_CONTENT);
		expect(
			buildFragment(parsed.result).querySelector("template"),
		).not.toBeNull();
	});

	test("template inside another element is not the root", () => {
		const content = "slot";
		const parsed = html`<div><template>${content}</template></div>`.parsedHTML;

		expect(parsed.hostBindingOffset).toBe(0);
		expect(parsed.bindings).toHaveLength(1);
		expect(parsed.bindings[0].type).toBe(BINDING_TYPES.RAW_CONTENT);
	});

	test("inner element with dynamic attribute does not count as host", () => {
		const cls = "a";
		const parsed = html`<template id="host"><p class="${cls}">x</p></template>`
			.parsedHTML;

		//host slot is the static id binding; the inner class binding is a regular child ATTR
		expect(parsed.hostBindingOffset).toBe(1);
		expect(parsed.bindings).toHaveLength(2);
		expect(parsed.bindings[0]).toMatchObject({
			keys: ["id"],
			values: ["host"],
		});
		expect(parsed.bindings[1].type).toBe(BINDING_TYPES.ATTR);
	});

	test("dynamic inner tag with dynamic attribute does not count as host", () => {
		//a dynamic open tag inside the root template is still an inner element —
		//its attributes belong to the inner tag, not the host. without this,
		//isRootTemplate leaks from the host into the dynamic inner open.
		const tag = "section";
		const cls = "a";
		const parsed =
			html`<template id="host"><${tag} class="${cls}">x</${tag}></template>`
				.parsedHTML;

		expect(parsed.hostBindingOffset).toBe(1);
		expect(parsed.bindings).toHaveLength(3);
		expect(parsed.bindings[0]).toMatchObject({
			keys: ["id"],
			values: ["host"],
		});
		expect(parsed.bindings[1].type).toBe(BINDING_TYPES.TAG);
		expect(parsed.bindings[2].type).toBe(BINDING_TYPES.ATTR);
	});
});
