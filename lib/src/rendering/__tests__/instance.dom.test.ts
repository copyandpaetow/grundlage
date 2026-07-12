import { describe, expect, test } from "vitest";
import { html, TemplateValue } from "../../template";
import { hashValue } from "../../utils/hashing";
import { getParsedTemplate } from "../../parser/html";
import {
	assertNestable,
	hydrateInstance,
	mountInstance,
	patchInstance,
	reconcileInstance,
} from "../instance";

const mountIntoShadow = (value: TemplateValue) => {
	const host = document.createElement("div");
	const shadowRoot = host.attachShadow({ mode: "open" });
	const { instance, fragment } = mountInstance(value);
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
		expect(() => mountInstance(html`<div>${inner}</div>`)).toThrow(
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
			),
		).toThrow(/top level of a component's render output/);
	});
});

describe("mountInstance: fragment + live-binding wiring", () => {
	test("produces a DocumentFragment with the parsed shape", () => {
		const { fragment } = mountInstance(html`<section><p>${"hi"}</p></section>`);
		expect(fragment.querySelector("section")).not.toBeNull();
		expect(fragment.querySelector("p")?.textContent).toContain("hi");
	});

	test("builds one live binding per static binding", () => {
		const value = html`<p class="${"c"}">${"text"}</p>`;
		const { instance } = mountInstance(value);
		expect(instance.liveBindings.length).toBe(
			getParsedTemplate(value.__templateStrings).bindings.length,
		);
	});
});

describe("reconcileInstance: patch vs rebuild", () => {
	test("patches in place when the template hash matches", () => {
		const paragraph = (value: string) => html`<p class="${value}">x</p>`;
		const { instance } = mountInstance(paragraph("a"));
		expect(reconcileInstance(instance, paragraph("b"))).toBeNull();
	});

	test("rebuilds when the structure differs", () => {
		const { instance } = mountInstance(html`<p>${"a"}</p>`);
		expect(
			reconcileInstance(instance, html`<span>${"a"}</span>`),
		).not.toBeNull();
	});
});

describe("patchInstance: change detection", () => {
	test("a changed attribute value is written to the DOM", () => {
		const paragraph = (value: string) => html`<p class="${value}">${"hi"}</p>`;
		const { instance, fragment } = mountInstance(paragraph("before"));
		const element = fragment.querySelector("p")!;
		expect(element.getAttribute("class")).toBe("before");

		patchInstance(instance, paragraph("after").values);
		expect(element.getAttribute("class")).toBe("after");
	});

	test("a changed text expression updates the text node in place", () => {
		const paragraph = (value: string) => html`<p>${value}</p>`;
		const { instance, fragment } = mountInstance(paragraph("first"));
		const element = fragment.querySelector("p")!;
		const original = textNodeOf(element);
		expect(original.data).toBe("first");

		patchInstance(instance, paragraph("second").values);
		expect(textNodeOf(element)).toBe(original);
		expect(original.data).toBe("second");
	});
});

describe("hydrateInstance: trusts the server DOM (seed, don't write)", () => {
	test("does not re-write server-rendered content, and the text node survives", () => {
		const { shadowRoot } = mountIntoShadow(html`<p>${"server-text"}</p>`);
		const paragraph = shadowRoot.querySelector("p")!;
		const serverTextNode = textNodeOf(paragraph);
		expect(serverTextNode.data).toBe("server-text");

		hydrateInstance(html`<p>${"client-text"}</p>`, shadowRoot);

		expect(textNodeOf(paragraph)).toBe(serverTextNode);
		expect(serverTextNode.data).toBe("server-text");
	});

	test("does not overwrite a server-rendered attribute on hydrate", () => {
		const { shadowRoot } = mountIntoShadow(
			html`<span class="${"server-class"}"></span>`,
		);
		const span = shadowRoot.querySelector("span")!;
		expect(span.getAttribute("class")).toBe("server-class");
		span.setAttribute("class", "stale-from-dom");

		hydrateInstance(html`<span class="${"client-class"}"></span>`, shadowRoot);

		expect(span.getAttribute("class")).toBe("stale-from-dom");
	});

	test("a patch after hydrate refreshes content to the current values", () => {
		const { shadowRoot } = mountIntoShadow(html`<p>${"server-text"}</p>`);
		const instance = hydrateInstance(html`<p>${"client-text"}</p>`, shadowRoot);
		expect(shadowRoot.querySelector("p")?.textContent).toBe("server-text");

		patchInstance(instance, ["refreshed"]);
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
		);

		patchInstance(instance, ["updated-class"]);
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

		expect(() => hydrateInstance(rows(["a", "b"]), shadowRoot)).not.toThrow();

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

		expect(() => hydrateInstance(rows(tree), shadowRoot)).not.toThrow();

		expect(shadowRoot.querySelectorAll("li").length).toBe(2);
		expect(shadowRoot.querySelectorAll("span").length).toBe(4);
	});
});
