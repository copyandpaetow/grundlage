import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { BaseComponent } from "../../types";
import { html, TemplateValue } from "../../template";
import { hashValue } from "../../utils/hashing";
import { getParsedTemplate } from "../../parser/html";
import {
	assertNestable,
	hydrateInstance,
	mountInstance,
	patchInstance,
	reconcileInstance,
	refreshStyleSheetsAfterMove,
} from "../instance";
import { StyleSheetMoveState } from "../bindings/types";

//a div stands in for the component element; the css fast path never touches the host
const createHost = () =>
	document.createElement("div") as unknown as BaseComponent;

const moveState = (): StyleSheetMoveState => ({
	needsStyleSheetRefreshOnMove: false,
	needsRerenderAfterMove: false,
});

//the host must be connected: a detached <style> has no sheet, so the CSSOM lane never engages
const mountIntoShadow = (value: TemplateValue) => {
	const host = createHost();
	document.body.appendChild(host as unknown as Element);
	const shadowRoot = host.attachShadow({ mode: "open" });
	const { instance, fragment } = mountInstance(value, moveState());
	shadowRoot.appendChild(fragment);
	return { host, shadowRoot, instance };
};

const textNodeOf = (element: Element): Text =>
	Array.from(element.childNodes).find(
		(node) => node.nodeType === Node.TEXT_NODE,
	) as Text;

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

describe("assertNestable: host binding requirement", () => {
	test("throws when a root template with host bindings is nested", () => {
		const value = html`<template id="${"missing-host"}"><p>hi</p></template>`;
		expect(
			getParsedTemplate(value.__templateStrings).hostBindingCount,
		).toBeGreaterThan(0);
		expect(() => assertNestable(value)).toThrow(
			/top level of a component's render output/,
		);
	});

	test("does not throw for a template without host bindings", () => {
		const value = html`<p>${"x"}</p>`;
		expect(() => assertNestable(value)).not.toThrow();
	});

	test("mounting a parent whose content is a nested root template throws", () => {
		const inner = html`<template class="leak"><p>x</p></template>`;
		expect(() => mountInstance(html`<div>${inner}</div>`, moveState())).toThrow(
			/top level of a component's render output/,
		);
	});

	test("mounting a list whose item is a root template throws", () => {
		const items = [html`<template class="leak"><p>x</p></template>`];
		expect(() =>
			mountInstance(
				html`<ul>
					${items}
				</ul>`,
				moveState(),
			),
		).toThrow(/top level of a component's render output/);
	});
});

describe("mountInstance: fragment + live-binding wiring", () => {
	test("produces a DocumentFragment with the parsed shape", () => {
		const { fragment } = mountInstance(
			html`<section><p>${"hi"}</p></section>`,
			moveState(),
		);
		expect(fragment.querySelector("section")).not.toBeNull();
		expect(fragment.querySelector("p")?.textContent).toContain("hi");
	});

	test("builds one live binding per static binding", () => {
		const value = html`<p class="${"c"}">${"text"}</p>`;
		const { instance } = mountInstance(value, moveState());
		expect(instance.liveBindings.length).toBe(
			getParsedTemplate(value.__templateStrings).bindings.length,
		);
	});
});

describe("reconcileInstance: patch vs rebuild", () => {
	test("patches in place when the template hash matches", () => {
		const paragraph = (value: string) => html`<p class="${value}">x</p>`;
		const { instance } = mountInstance(paragraph("a"), moveState());
		expect(reconcileInstance(instance, paragraph("b"), moveState())).toBeNull();
	});

	test("rebuilds when the structure differs", () => {
		const { instance } = mountInstance(html`<p>${"a"}</p>`, moveState());
		expect(
			reconcileInstance(instance, html`<span>${"a"}</span>`, moveState()),
		).not.toBeNull();
	});
});

describe("patchInstance: change detection", () => {
	test("a changed attribute value is written to the DOM", () => {
		const paragraph = (value: string) => html`<p class="${value}">${"hi"}</p>`;
		const { instance, fragment } = mountInstance(
			paragraph("before"),
			moveState(),
		);
		const element = fragment.querySelector("p")!;
		expect(element.getAttribute("class")).toBe("before");

		patchInstance(instance, paragraph("after").values);
		expect(element.getAttribute("class")).toBe("after");
	});

	test("a changed text expression updates the text node in place", () => {
		const paragraph = (value: string) => html`<p>${value}</p>`;
		const { instance, fragment } = mountInstance(
			paragraph("first"),
			moveState(),
		);
		const element = fragment.querySelector("p")!;
		const original = textNodeOf(element);
		expect(original.data).toBe("first");

		patchInstance(instance, paragraph("second").values);
		expect(textNodeOf(element)).toBe(original);
		expect(original.data).toBe("second");
	});
});

describe("raw content with a css plan", () => {
	const sheet = (color: string) =>
		html`<style>
			p {
				color: ${color};
			}
		</style>`;
	const normalizeWhitespace = (string: string) =>
		string.replace(/\s+/g, " ").trim();
	const declarationOf = (style: HTMLStyleElement): CSSStyleDeclaration =>
		(style.sheet!.cssRules[0] as CSSStyleRule).style;

	test("mount composes the literal sheet into the detached fragment", () => {
		const { fragment } = mountInstance(sheet("red"), moveState());
		const styles = fragment.querySelectorAll("style");

		expect(styles).toHaveLength(1);
		expect(normalizeWhitespace(styles[0].textContent!)).toBe(
			"p { color: red; }",
		);
	});

	test("a connected patch updates the declaration through the sheet, never the text", () => {
		const { host, shadowRoot, instance } = mountIntoShadow(sheet("red"));
		const style = shadowRoot.querySelector("style")!;
		const sheetTextNode = style.firstChild as Text;
		const sheetText = sheetTextNode.data;

		patchInstance(instance, sheet("blue").values);

		expect(style.firstChild).toBe(sheetTextNode);
		expect(sheetTextNode.data).toBe(sheetText);
		expect(declarationOf(style).getPropertyValue("color")).toBe("blue");
		expect(host.getAttribute("style")).toBeNull();
	});

	test("an unchanged patch writes nothing", () => {
		const { shadowRoot, instance } = mountIntoShadow(sheet("red"));
		const style = shadowRoot.querySelector("style")!;
		//first patch resolves the sheet; same values, so the hash gate must skip.
		//The marker must be a valid value — setProperty drops invalid ones
		patchInstance(instance, sheet("red").values);
		declarationOf(style).setProperty("color", "teal");

		patchInstance(instance, sheet("red").values);

		expect(declarationOf(style).getPropertyValue("color")).toBe("teal");
	});

	test("a patch while detached rewrites the composed text", () => {
		const { instance, fragment } = mountInstance(sheet("red"), moveState());
		const style = fragment.querySelector("style")!;

		patchInstance(instance, sheet("blue").values);

		expect(normalizeWhitespace(style.textContent!)).toBe("p { color: blue; }");
	});

	test("hydrate seeds without touching the sheet; a later patch goes through CSSOM", () => {
		const { shadowRoot } = mountIntoShadow(sheet("red"));
		const style = shadowRoot.querySelector("style")!;
		const sheetTextNode = style.firstChild as Text;

		const instance = hydrateInstance(
			sheet("red"),
			shadowRoot,
			null,
			moveState(),
		);
		expect(style.firstChild).toBe(sheetTextNode);

		patchInstance(instance!, sheet("blue").values);
		expect(style.firstChild).toBe(sheetTextNode);
		expect(declarationOf(style).getPropertyValue("color")).toBe("blue");
	});

	test("duplicate instances own private sheets and never interfere", () => {
		const host = createHost();
		document.body.appendChild(host as unknown as Element);
		const shadowRoot = host.attachShadow({ mode: "open" });
		const state = moveState();
		const first = mountInstance(sheet("red"), state);
		shadowRoot.appendChild(first.fragment);
		const second = mountInstance(sheet("blue"), state);
		shadowRoot.appendChild(second.fragment);
		const styles = shadowRoot.querySelectorAll("style");

		patchInstance(second.instance, sheet("green").values);

		expect(normalizeWhitespace(styles[0].textContent!)).toBe(
			"p { color: red; }",
		);
		expect(declarationOf(styles[0]).getPropertyValue("color")).toBe("red");
		expect(declarationOf(styles[1]).getPropertyValue("color")).toBe("green");
	});

	test("a moved style is refreshed from its orphaned sheet", () => {
		const { shadowRoot, instance } = mountIntoShadow(sheet("red"));
		patchInstance(instance, sheet("blue").values);
		const style = shadowRoot.querySelector("style")!;

		//a plain re-append reparses the sheet from the stale mount-time text
		const wrapper = document.createElement("div");
		shadowRoot.appendChild(wrapper);
		wrapper.append(
			...Array.from(shadowRoot.childNodes).filter((node) => node !== wrapper),
		);
		expect(declarationOf(style).getPropertyValue("color")).toBe("red");

		refreshStyleSheetsAfterMove(instance);
		expect(declarationOf(style).getPropertyValue("color")).toBe("blue");

		patchInstance(instance, sheet("green").values);
		expect(declarationOf(style).getPropertyValue("color")).toBe("green");
	});

	test("a moved style whose reparse breaks the plan structure demotes and flags a re-render", () => {
		const { shadowRoot, instance } = mountIntoShadow(sheet("red"));
		patchInstance(instance, sheet("blue").values); //resolve the CSSOM sheet
		const style = shadowRoot.querySelector("style")!;

		//a reparse yielding a different rule count than the compiled plan recorded makes the
		//after-move rebind bail; the leaf has no host, so it flags the shared move state instead
		style.textContent = "p { color: red; } a { color: blue; }";
		const wrapper = document.createElement("div");
		shadowRoot.appendChild(wrapper);
		wrapper.append(
			...Array.from(shadowRoot.childNodes).filter((node) => node !== wrapper),
		);

		expect(instance.moveState.needsRerenderAfterMove).toBe(false);
		refreshStyleSheetsAfterMove(instance);
		expect(instance.moveState.needsRerenderAfterMove).toBe(true);

		//the demote is real: the next patch recomposes the whole sheet on the text lane
		patchInstance(instance, sheet("green").values);
		expect(normalizeWhitespace(style.textContent!)).toBe("p { color: green; }");
	});

	test("switching a branch away removes the style element with the branch", () => {
		const wrap = (inner: unknown) => html`<div>${inner}</div>`;
		const { instance, fragment } = mountInstance(
			wrap(sheet("red")),
			moveState(),
		);
		expect(fragment.querySelector("style")).not.toBeNull();

		patchInstance(instance, wrap(null).values);

		expect(fragment.querySelector("style")).toBeNull();
	});

	test("removing a list row removes its style element", () => {
		const wrap = (items: Array<unknown>) => html`<div>${items}</div>`;
		const { instance, fragment } = mountInstance(
			wrap([sheet("red")]),
			moveState(),
		);
		expect(fragment.querySelector("style")).not.toBeNull();

		patchInstance(instance, wrap([]).values);

		expect(fragment.querySelector("style")).toBeNull();
	});
});

describe("hydrateInstance: adopts the server DOM, repairing text that diverged", () => {
	test("repairs diverged text in place, keeping the server's text node", () => {
		const { shadowRoot } = mountIntoShadow(html`<p>${"server-text"}</p>`);
		const paragraph = shadowRoot.querySelector("p")!;
		const serverTextNode = textNodeOf(paragraph);
		expect(serverTextNode.data).toBe("server-text");

		hydrateInstance(
			html`<p>${"client-text"}</p>`,
			shadowRoot,
			null,
			moveState(),
		);

		expect(textNodeOf(paragraph)).toBe(serverTextNode);
		expect(serverTextNode.data).toBe("client-text");
	});

	test("leaves matching text alone: no write, same node", () => {
		const { shadowRoot } = mountIntoShadow(html`<p>${"same-text"}</p>`);
		const serverTextNode = textNodeOf(shadowRoot.querySelector("p")!);
		const writes: Array<string> = [];
		Object.defineProperty(serverTextNode, "data", {
			get: () => "same-text",
			set: (next: string) => writes.push(next),
		});

		hydrateInstance(html`<p>${"same-text"}</p>`, shadowRoot, null, moveState());

		expect(writes).toEqual([]);
	});

	test("does not overwrite a server-rendered attribute on hydrate", () => {
		const { shadowRoot } = mountIntoShadow(
			html`<span class="${"server-class"}"></span>`,
		);
		const span = shadowRoot.querySelector("span")!;
		expect(span.getAttribute("class")).toBe("server-class");
		span.setAttribute("class", "stale-from-dom");

		hydrateInstance(
			html`<span class="${"client-class"}"></span>`,
			shadowRoot,
			null,
			moveState(),
		);

		expect(span.getAttribute("class")).toBe("stale-from-dom");
	});

	test("a patch after hydrate refreshes content to the current values", () => {
		const { shadowRoot } = mountIntoShadow(html`<p>${"server-text"}</p>`);
		const instance = hydrateInstance(
			html`<p>${"client-text"}</p>`,
			shadowRoot,
			null,
			moveState(),
		);
		expect(shadowRoot.querySelector("p")?.textContent).toBe("client-text");

		patchInstance(instance!, ["refreshed"]);
		expect(shadowRoot.querySelector("p")?.textContent).toBe("refreshed");
	});

	test("a patch after hydrate writes a changed attribute value", () => {
		const { shadowRoot } = mountIntoShadow(
			html`<span class="${"server-class"}"></span>`,
		);
		const span = shadowRoot.querySelector("span")!;
		const instance = hydrateInstance(
			html`<span class="${"client-class"}"></span>`,
			shadowRoot,
			null,
			moveState(),
		);

		patchInstance(instance!, ["updated-class"]);
		expect(span.getAttribute("class")).toBe("updated-class");
	});

	test("hydrates a list whose rows carry a non-content binding", () => {
		//each row's attribute emits a single (unclosed) marker as a top-level sibling of the row —
		//the row-tail walk must not mistake it for an open content range
		const rows = (labels: Array<string>) =>
			html`<ul>
				${labels.map((label) => html`<li class=${label}>${label}</li>`)}
			</ul>`;
		const { shadowRoot } = mountIntoShadow(rows(["a", "b"]));

		expect(() =>
			hydrateInstance(rows(["a", "b"]), shadowRoot, null, moveState()),
		).not.toThrow();

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
				${groups.map(
					(group) =>
						html`<li>${group.map((cell) => html`<span>${cell}</span>`)}</li>`,
				)}
			</ul>`;
		const tree = [
			["a", "b"],
			["c", "d"],
		];
		const { shadowRoot } = mountIntoShadow(rows(tree));

		expect(() =>
			hydrateInstance(rows(tree), shadowRoot, null, moveState()),
		).not.toThrow();

		expect(shadowRoot.querySelectorAll("li").length).toBe(2);
		expect(shadowRoot.querySelectorAll("span").length).toBe(4);
	});
});

describe("hydrateInstance: rejects a server range that contradicts the value", () => {
	const contentHole = (value: unknown) => html`<div>${value}</div>`;
	const rows = (labels: Array<string>) =>
		html`<ul>
			${labels.map((label) => html`<li>${label}</li>`)}
		</ul>`;
	const rowLabels = (shadowRoot: ShadowRoot): Array<string> =>
		Array.from(shadowRoot.querySelectorAll("li"), (item) => item.textContent!);

	beforeEach(() => {
		vi.spyOn(console, "warn").mockImplementation(() => {});
	});
	afterEach(() => {
		vi.restoreAllMocks();
	});

	test("an empty list value discards every row the server wrote", () => {
		const { shadowRoot } = mountIntoShadow(rows(["a", "b"]));

		hydrateInstance(rows([]), shadowRoot, null, moveState());

		expect(rowLabels(shadowRoot)).toEqual([]);
		expect(console.warn).toHaveBeenCalled();
	});

	test("fewer rows than the server wrote re-renders the range", () => {
		const { shadowRoot } = mountIntoShadow(rows(["a", "b", "c"]));

		hydrateInstance(rows(["a"]), shadowRoot, null, moveState());

		expect(rowLabels(shadowRoot)).toEqual(["a"]);
	});

	test("more rows than the server wrote re-renders the range", () => {
		const { shadowRoot } = mountIntoShadow(rows(["a"]));

		hydrateInstance(rows(["a", "b"]), shadowRoot, null, moveState());

		expect(rowLabels(shadowRoot)).toEqual(["a", "b"]);
	});

	test("a branch needing more markers than the server wrote re-renders the range", () => {
		const { shadowRoot } = mountIntoShadow(contentHole(html`<p>${"x"}</p>`));

		hydrateInstance(
			contentHole(
				html`<p>${"x"}</p>
					<em>${"y"}</em>`,
			),
			shadowRoot,
			null,
			moveState(),
		);

		expect(shadowRoot.querySelector("em")?.textContent).toBe("y");
	});

	test("a diverging branch never consumes the next binding's markers", () => {
		const twoHoles = (branch: TemplateValue, tail: string) =>
			html`<div>${branch}</div>
				<span>${tail}</span>`;
		const { shadowRoot } = mountIntoShadow(
			twoHoles(html`<p>${"server"}</p>`, "tail"),
		);

		hydrateInstance(
			twoHoles(
				html`<p>${"a"}</p>
					<p>${"b"}</p>`,
				"tail",
			),
			shadowRoot,
			null,
			moveState(),
		);

		expect(shadowRoot.querySelectorAll("div p").length).toBe(2);
		expect(shadowRoot.querySelector("span")?.textContent).toBe("tail");
	});

	test("a text value over a server-rendered list discards the rows", () => {
		const { shadowRoot } = mountIntoShadow(contentHole(["a", "b"]));

		hydrateInstance(contentHole("text"), shadowRoot, null, moveState());

		expect(shadowRoot.querySelector("div")?.textContent).toBe("text");
	});

	test("a root with more bindings than the server's markup is not adopted", () => {
		const { shadowRoot } = mountIntoShadow(html`<p>${"a"}</p>`);

		expect(
			hydrateInstance(
				html`<p>${"a"}</p>
					<p>${"b"}</p>`,
				shadowRoot,
				null,
				moveState(),
			),
		).toBeNull();
	});

	test("text fills a server range that holds no text node at all", () => {
		const { shadowRoot } = mountIntoShadow(contentHole(""));
		//the SSR shape: an empty text hole writes nothing between its markers
		shadowRoot.querySelector("div")!.childNodes[1].remove();

		hydrateInstance(contentHole("filled"), shadowRoot, null, moveState());

		expect(shadowRoot.querySelector("div")?.textContent).toBe("filled");
		expect(console.warn).not.toHaveBeenCalled();
	});
});
