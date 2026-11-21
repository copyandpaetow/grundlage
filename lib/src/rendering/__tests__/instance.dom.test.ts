import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { html, TemplateValue } from "../../template";
import { hashValue } from "../value-hashing";
import { getParsedTemplate } from "../../parser/html";
import {
	HYDRATION_MISMATCH,
	parseNestedTemplate,
	hydrateInstance,
	cloneTemplateFragment,
	mountInstance,
	patchInstance,
	isPatchableInPlace,
} from "../instance";
import { ContentLiveBinding, Instance, TreeState } from "../bindings/types";

const treeState = (): TreeState => ({ isTemplateContent: false });

const mountTemplateValue = (value: TemplateValue, treeStateValue: TreeState) => {
	const parsed = getParsedTemplate(value.__templateStrings);
	const fragment = cloneTemplateFragment(parsed, null);
	const instance = mountInstance(fragment, value.values, parsed, treeStateValue);
	return { instance, fragment };
};

const mountIntoShadow = (value: TemplateValue) => {
	const host = document.createElement("div");
	document.body.appendChild(host);
	const shadowRoot = host.attachShadow({ mode: "open" });
	const { instance, fragment } = mountTemplateValue(value, treeState());
	shadowRoot.appendChild(fragment);
	return { host, shadowRoot, instance };
};

const hydrateShadowRoot = (
	value: TemplateValue,
	shadowRoot: ShadowRoot,
	rangeEnd: Comment | null,
	treeState: TreeState,
) =>
	hydrateInstance(
		document.createTreeWalker(shadowRoot, NodeFilter.SHOW_COMMENT),
		value,
		getParsedTemplate(value.__templateStrings),
		rangeEnd,
		treeState,
	);

const instanceOrThrow = (instance: Instance | typeof HYDRATION_MISMATCH): Instance => {
	if (instance === HYDRATION_MISMATCH) throw new Error("expected the server range to hydrate");
	return instance;
};

const textNodeOf = (element: Element): Text =>
	Array.from(element.childNodes).find((node) => node.nodeType === Node.TEXT_NODE) as Text;

describe("template value hashing", () => {
	test("hash changes when an expression changes at the same call site", () => {
		const paragraph = (value: string) => html`<p>${value}</p>`;
		expect(hashValue(paragraph("a"))).not.toBe(hashValue(paragraph("b")));
	});

	test("hash matches for identical structure and values", () => {
		const paragraph = (value: string) => html`<p>${value}</p>`;
		expect(hashValue(paragraph("b"))).toBe(hashValue(paragraph("b")));
	});

	test("hash is stable across repeated reads of the same value", () => {
		const value = html`<p>${"a"}</p>`;
		expect(hashValue(value)).toBe(hashValue(value));
	});
});

describe("parseNestedTemplate: host binding requirement", () => {
	test("throws when a root template with host bindings is nested", () => {
		const value = html`<template id="${"missing-host"}"><p>hi</p></template>`;
		expect(getParsedTemplate(value.__templateStrings).hostBindingCount).toBeGreaterThan(0);
		expect(() => parseNestedTemplate(value)).toThrow(
			/top level of the template a component yields/,
		);
	});

	test("does not throw for a template without host bindings", () => {
		const value = html`<p>${"x"}</p>`;
		expect(() => parseNestedTemplate(value)).not.toThrow();
	});

	test("mounting a parent whose content is a nested root template throws", () => {
		const inner = html`<template class="leak"><p>x</p></template>`;
		expect(() => mountTemplateValue(html`<div>${inner}</div>`, treeState())).toThrow(
			/top level of the template a component yields/,
		);
	});

	test("mounting a list whose item is a root template throws", () => {
		const items = [html`<template class="leak"><p>x</p></template>`];
		expect(() =>
			mountTemplateValue(
				html`<ul>
					${items}
				</ul>`,
				treeState(),
			),
		).toThrow(/top level of the template a component yields/);
	});
});

describe("mountInstance: fragment + live-binding wiring", () => {
	test("produces a DocumentFragment with the parsed shape", () => {
		const { fragment } = mountTemplateValue(html`<section><p>${"hi"}</p></section>`, treeState());
		expect(fragment.querySelector("section")).not.toBeNull();
		expect(fragment.querySelector("p")?.textContent).toContain("hi");
	});

	test("builds one live binding per static binding", () => {
		const value = html`<p class="${"c"}">${"text"}</p>`;
		const { instance } = mountTemplateValue(value, treeState());
		expect(instance.liveBindings.length).toBe(
			getParsedTemplate(value.__templateStrings).bindings.length,
		);
	});
});

describe("isPatchableInPlace: patch vs rebuild", () => {
	test("patches in place when the template hash matches", () => {
		const paragraph = (value: string) => html`<p class="${value}">x</p>`;
		const { instance } = mountTemplateValue(paragraph("a"), treeState());
		const next = paragraph("b");
		expect(isPatchableInPlace(instance, getParsedTemplate(next.__templateStrings))).toBe(true);
	});

	test("rebuilds when the structure differs", () => {
		const { instance } = mountTemplateValue(html`<p>${"a"}</p>`, treeState());
		const next = html`<span>${"a"}</span>`;
		expect(isPatchableInPlace(instance, getParsedTemplate(next.__templateStrings))).toBe(false);
	});

	test("a first paint has no instance to patch", () => {
		const value = html`<p>${"a"}</p>`;
		expect(isPatchableInPlace(null, getParsedTemplate(value.__templateStrings))).toBe(false);
	});
});

describe("patchInstance: change detection", () => {
	test("a changed attribute value is written to the DOM", () => {
		const paragraph = (value: string) => html`<p class="${value}">${"hi"}</p>`;
		const { instance, fragment } = mountTemplateValue(paragraph("before"), treeState());
		const element = fragment.querySelector("p")!;
		expect(element.getAttribute("class")).toBe("before");

		patchInstance(instance, paragraph("after").values);
		expect(element.getAttribute("class")).toBe("after");
	});

	test("a changed text expression updates the text node in place", () => {
		const paragraph = (value: string) => html`<p>${value}</p>`;
		const { instance, fragment } = mountTemplateValue(paragraph("first"), treeState());
		const element = fragment.querySelector("p")!;
		const original = textNodeOf(element);
		expect(original.data).toBe("first");

		patchInstance(instance, paragraph("second").values);
		expect(textNodeOf(element)).toBe(original);
		expect(original.data).toBe("second");
	});
});

describe("a dynamic style sheet", () => {
	const sheet = (color: string) =>
		html`<style>
			.static { color: black; }
			p { color: ${color}; }
		</style>`;
	const normalizeWhitespace = (string: string) => string.replace(/\s+/g, " ").trim();
	const textsOf = (root: ParentNode) =>
		Array.from(root.querySelectorAll("style"), (style) => normalizeWhitespace(style.textContent));

	test("mount writes the holed rule into its own <style> after the static one", () => {
		const { fragment } = mountTemplateValue(sheet("red"), treeState());

		expect(textsOf(fragment)).toEqual([".static { color: black; }", "p { color: red; }"]);
	});

	test("a patch rewrites the holed rule's <style> and leaves the static one alone", () => {
		const { shadowRoot, instance } = mountIntoShadow(sheet("red"));
		const [staticStyle] = shadowRoot.querySelectorAll("style");
		const staticText = staticStyle.firstChild;

		patchInstance(instance, sheet("blue").values);

		expect(staticStyle.firstChild).toBe(staticText);
		expect(textsOf(shadowRoot)).toEqual([".static { color: black; }", "p { color: blue; }"]);
	});

	test("an unchanged patch writes nothing", () => {
		const { shadowRoot, instance } = mountIntoShadow(sheet("red"));
		const [, holedStyle] = shadowRoot.querySelectorAll("style");
		holedStyle.textContent = "p { color: teal; }";

		patchInstance(instance, sheet("red").values);

		expect(holedStyle.textContent).toBe("p { color: teal; }");
	});

	test("hydration adopts the server text without a write, and a later patch rewrites it", () => {
		const { shadowRoot } = mountIntoShadow(sheet("red"));
		const [, holedStyle] = shadowRoot.querySelectorAll("style");
		const serverText = holedStyle.firstChild;

		const instance = hydrateShadowRoot(sheet("red"), shadowRoot, null, treeState());
		expect(holedStyle.firstChild).toBe(serverText);

		patchInstance(instanceOrThrow(instance), sheet("blue").values);
		expect(normalizeWhitespace(holedStyle.textContent)).toBe("p { color: blue; }");
	});

	test("duplicate instances own their own <style> elements and never interfere", () => {
		const host = document.createElement("div");
		document.body.appendChild(host);
		const shadowRoot = host.attachShadow({ mode: "open" });
		const state = treeState();
		const first = mountTemplateValue(sheet("red"), state);
		shadowRoot.appendChild(first.fragment);
		const second = mountTemplateValue(sheet("blue"), state);
		shadowRoot.appendChild(second.fragment);

		patchInstance(second.instance, sheet("green").values);

		expect(textsOf(shadowRoot)).toEqual([
			".static { color: black; }",
			"p { color: red; }",
			".static { color: black; }",
			"p { color: green; }",
		]);
	});

	test("a moved style keeps its current value, since its text holds it", () => {
		const { shadowRoot, instance } = mountIntoShadow(sheet("red"));
		patchInstance(instance, sheet("blue").values);
		const [, holedStyle] = shadowRoot.querySelectorAll("style");

		const wrapper = document.createElement("div");
		shadowRoot.appendChild(wrapper);
		wrapper.append(...Array.from(shadowRoot.childNodes).filter((node) => node !== wrapper));

		const rule = holedStyle.sheet!.cssRules[0] as CSSStyleRule;
		expect(rule.style.getPropertyValue("color")).toBe("blue");
	});

	test("switching a branch away removes the style elements with the branch", () => {
		const wrap = (inner: unknown) => html`<div>${inner}</div>`;
		const { instance, fragment } = mountTemplateValue(wrap(sheet("red")), treeState());
		expect(fragment.querySelector("style")).not.toBeNull();

		patchInstance(instance, wrap(null).values);

		expect(fragment.querySelector("style")).toBeNull();
	});

	test("removing a list row removes its style elements", () => {
		const wrap = (items: Array<unknown>) => html`<div>${items}</div>`;
		const { instance, fragment } = mountTemplateValue(wrap([sheet("red")]), treeState());
		expect(fragment.querySelector("style")).not.toBeNull();

		patchInstance(instance, wrap([]).values);

		expect(fragment.querySelector("style")).toBeNull();
	});
});

describe("hydrateInstance: adopts the server DOM, repairing what diverged", () => {
	test("repairs diverged text in place, keeping the server's text node", () => {
		const { shadowRoot } = mountIntoShadow(html`<p>${"server-text"}</p>`);
		const paragraph = shadowRoot.querySelector("p")!;
		const serverTextNode = textNodeOf(paragraph);
		expect(serverTextNode.data).toBe("server-text");

		hydrateShadowRoot(html`<p>${"client-text"}</p>`, shadowRoot, null, treeState());

		expect(textNodeOf(paragraph)).toBe(serverTextNode);
		expect(serverTextNode.data).toBe("client-text");
	});

	test("leaves matching text alone: no write, same node", () => {
		const { shadowRoot } = mountIntoShadow(html`<p>${"same-text"}</p>`);
		const serverTextNode = textNodeOf(shadowRoot.querySelector("p")!);
		const writes: Array<string> = [];
		Object.defineProperty(serverTextNode, "data", {
			get: () => "same-text",
			set: (next: string) => {
				writes.push(next);
			},
		});

		hydrateShadowRoot(html`<p>${"same-text"}</p>`, shadowRoot, null, treeState());

		expect(writes).toEqual([]);
	});

	test("repairs a diverged attribute in place", () => {
		const { shadowRoot } = mountIntoShadow(html`<span class="${"server-class"}"></span>`);
		const span = shadowRoot.querySelector("span")!;
		expect(span.getAttribute("class")).toBe("server-class");

		hydrateShadowRoot(html`<span class="${"client-class"}"></span>`, shadowRoot, null, treeState());

		expect(span.getAttribute("class")).toBe("client-class");
	});

	test("leaves a matching attribute alone: no write", () => {
		const { shadowRoot } = mountIntoShadow(html`<span class="${"same-class"}"></span>`);
		const span = shadowRoot.querySelector("span")!;
		const setAttribute = vi.spyOn(span, "setAttribute");

		hydrateShadowRoot(html`<span class="${"same-class"}"></span>`, shadowRoot, null, treeState());

		expect(setAttribute).not.toHaveBeenCalled();
	});

	test("a patch after hydrate refreshes content to the current values", () => {
		const { shadowRoot } = mountIntoShadow(html`<p>${"server-text"}</p>`);
		const instance = hydrateShadowRoot(
			html`<p>${"client-text"}</p>`,
			shadowRoot,
			null,
			treeState(),
		);
		expect(shadowRoot.querySelector("p")?.textContent).toBe("client-text");

		patchInstance(instanceOrThrow(instance), ["refreshed"]);
		expect(shadowRoot.querySelector("p")?.textContent).toBe("refreshed");
	});

	test("a patch after hydrate writes a changed attribute value", () => {
		const { shadowRoot } = mountIntoShadow(html`<span class="${"server-class"}"></span>`);
		const span = shadowRoot.querySelector("span")!;
		const instance = hydrateShadowRoot(
			html`<span class="${"client-class"}"></span>`,
			shadowRoot,
			null,
			treeState(),
		);

		patchInstance(instanceOrThrow(instance), ["updated-class"]);
		expect(span.getAttribute("class")).toBe("updated-class");
	});

	test("hydrates a list whose rows carry a non-content binding", () => {
		//each row's attribute emits a single (unclosed) marker as a top-level sibling of the row, and
		//the row-tail walk must not mistake it for an open content range
		const rows = (labels: Array<string>) =>
			html`<ul>
				${labels.map((label) => html`<li class=${label}>${label}</li>`)}
			</ul>`;
		const { shadowRoot } = mountIntoShadow(rows(["a", "b"]));

		expect(() => hydrateShadowRoot(rows(["a", "b"]), shadowRoot, null, treeState())).not.toThrow();

		const items = shadowRoot.querySelectorAll("li");
		expect(items.length).toBe(2);
		expect(items[0].getAttribute("class")).toBe("a");
		expect(items[1].getAttribute("class")).toBe("b");
	});

	test("hydrates a list with a nested list inside each row", () => {
		//nested rows contribute their own *.* tails; the outer row-tail walk must skip them via
		//the nested content range, not stop at the first one it sees
		const rows = (groups: Array<Array<string>>) =>
			html`<ul>
				${groups.map((group) => html`<li>${group.map((cell) => html`<span>${cell}</span>`)}</li>`)}
			</ul>`;
		const tree = [
			["a", "b"],
			["c", "d"],
		];
		const { shadowRoot } = mountIntoShadow(rows(tree));

		expect(() => hydrateShadowRoot(rows(tree), shadowRoot, null, treeState())).not.toThrow();

		expect(shadowRoot.querySelectorAll("li").length).toBe(2);
		expect(shadowRoot.querySelectorAll("span").length).toBe(4);
	});

	//a reconcile of equal rows paints the same DOM, so only the kept rows array shows the gate held
	test("the first patch with the hydrated list value stops at the change gate", () => {
		const rows = (labels: Array<string>) =>
			html`<ul>
				${labels.map((label) => html`<li>${label}</li>`)}
			</ul>`;
		const { shadowRoot } = mountIntoShadow(rows(["a", "b"]));
		const instance = instanceOrThrow(
			hydrateShadowRoot(rows(["a", "b"]), shadowRoot, null, treeState()),
		);
		const listContent = () =>
			(instance.liveBindings[0] as ContentLiveBinding).content as {
				items: Array<unknown>;
			};
		const hydratedItems = listContent().items;

		patchInstance(instance, rows(["a", "b"]).values);

		expect(listContent().items).toBe(hydratedItems);
	});
});

describe("hydrateInstance: rejects a server range that contradicts the value", () => {
	const contentHole = (value: unknown) => html`<div>${value}</div>`;
	const rows = (labels: Array<string>) =>
		html`<ul>
			${labels.map((label) => html`<li>${label}</li>`)}
		</ul>`;
	const rowLabels = (shadowRoot: ShadowRoot): Array<string> =>
		Array.from(shadowRoot.querySelectorAll("li"), (item) => item.textContent);

	beforeEach(() => {
		vi.spyOn(console, "warn").mockImplementation(() => {});
	});
	afterEach(() => {
		vi.restoreAllMocks();
	});

	test("an empty list value discards every row the server wrote", () => {
		const { shadowRoot } = mountIntoShadow(rows(["a", "b"]));

		hydrateShadowRoot(rows([]), shadowRoot, null, treeState());

		expect(rowLabels(shadowRoot)).toEqual([]);
		expect(console.warn).toHaveBeenCalled();
	});

	test("fewer rows than the server wrote rebuilds the range", () => {
		const { shadowRoot } = mountIntoShadow(rows(["a", "b", "c"]));

		hydrateShadowRoot(rows(["a"]), shadowRoot, null, treeState());

		expect(rowLabels(shadowRoot)).toEqual(["a"]);
	});

	test("more rows than the server wrote rebuilds the range", () => {
		const { shadowRoot } = mountIntoShadow(rows(["a"]));

		hydrateShadowRoot(rows(["a", "b"]), shadowRoot, null, treeState());

		expect(rowLabels(shadowRoot)).toEqual(["a", "b"]);
	});

	test("a branch needing more markers than the server wrote rebuilds the range", () => {
		const { shadowRoot } = mountIntoShadow(contentHole(html`<p>${"x"}</p>`));

		hydrateShadowRoot(
			contentHole(
				html`<p>${"x"}</p>
					<em>${"y"}</em>`,
			),
			shadowRoot,
			null,
			treeState(),
		);

		expect(shadowRoot.querySelector("em")?.textContent).toBe("y");
	});

	test("a diverging branch never consumes the next binding's markers", () => {
		const twoHoles = (branch: TemplateValue, tail: string) =>
			html`<div>${branch}</div>
				<span>${tail}</span>`;
		const { shadowRoot } = mountIntoShadow(twoHoles(html`<p>${"server"}</p>`, "tail"));

		hydrateShadowRoot(
			twoHoles(
				html`<p>${"a"}</p>
					<p>${"b"}</p>`,
				"tail",
			),
			shadowRoot,
			null,
			treeState(),
		);

		expect(shadowRoot.querySelectorAll("div p").length).toBe(2);
		expect(shadowRoot.querySelector("span")?.textContent).toBe("tail");
	});

	test("a text value over a server-rendered list discards the rows", () => {
		const { shadowRoot } = mountIntoShadow(contentHole(["a", "b"]));

		hydrateShadowRoot(contentHole("text"), shadowRoot, null, treeState());

		expect(shadowRoot.querySelector("div")?.textContent).toBe("text");
	});

	test("a root with more bindings than the server's markup is not adopted", () => {
		const { shadowRoot } = mountIntoShadow(html`<p>${"a"}</p>`);

		expect(
			hydrateShadowRoot(
				html`<p>${"a"}</p>
					<p>${"b"}</p>`,
				shadowRoot,
				null,
				treeState(),
			),
		).toBe(HYDRATION_MISMATCH);
	});

	test("text fills a server range that holds no text node at all", () => {
		const { shadowRoot } = mountIntoShadow(contentHole(""));
		const hole = shadowRoot.querySelector("div")!;
		//an empty text hole writes no node, so its markers are adjacent, the shape SSR serializes
		expect(hole.childNodes.length).toBe(2);

		hydrateShadowRoot(contentHole("filled"), shadowRoot, null, treeState());

		expect(hole.textContent).toBe("filled");
		expect(console.warn).not.toHaveBeenCalled();
	});
});

describe("an iterator in a content hole paints as a list", () => {
	const contentHole = (value: unknown) =>
		html`<ul>
			${value}
		</ul>`;
	const row = (label: string) => html`<li>${label}</li>`;
	const rowLabels = (root: ParentNode): Array<string> =>
		Array.from(root.querySelectorAll("li"), (item) => item.textContent);

	afterEach(() => {
		vi.restoreAllMocks();
	});

	test("a generator paints one row per value it yields", () => {
		const rows = function* () {
			yield row("a");
			yield row("b");
		};
		const { shadowRoot } = mountIntoShadow(contentHole(rows()));

		expect(rowLabels(shadowRoot)).toEqual(["a", "b"]);
	});

	test("a patch with a new iterator updates the rows", () => {
		const labels = ["a", "b"];
		const { shadowRoot, instance } = mountIntoShadow(contentHole(labels.values().map(row)));

		patchInstance(instance, contentHole(["c", "b", "a"].values().map(row)).values);

		expect(rowLabels(shadowRoot)).toEqual(["c", "b", "a"]);
	});

	test("a map's values are an iterator, the map itself is not and throws", () => {
		const rowsByKey = new Map([["key", row("a")]]);
		const { shadowRoot } = mountIntoShadow(contentHole(rowsByKey.values()));

		expect(rowLabels(shadowRoot)).toEqual(["a"]);
		expect(() => mountIntoShadow(contentHole(rowsByKey))).toThrow(/expects a string/);
	});

	test("hydration adopts the server's rows", () => {
		const { shadowRoot } = mountIntoShadow(contentHole([row("a"), row("b")]));
		const serverRows = Array.from(shadowRoot.querySelectorAll("li"));

		hydrateShadowRoot(contentHole(["a", "b"].values().map(row)), shadowRoot, null, treeState());

		expect(Array.from(shadowRoot.querySelectorAll("li"))).toEqual(serverRows);
	});

	//the fallback commit reads the hole a second time, after the first read used the iterator up
	test("a server range the rows reject rebuilds them from the first read", () => {
		vi.spyOn(console, "warn").mockImplementation(() => {});
		const { shadowRoot } = mountIntoShadow(contentHole([row("a")]));

		hydrateShadowRoot(contentHole(["a", "b"].values().map(row)), shadowRoot, null, treeState());

		expect(rowLabels(shadowRoot)).toEqual(["a", "b"]);
	});
});
