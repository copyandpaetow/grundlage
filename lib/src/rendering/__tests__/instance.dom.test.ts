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

const detachedCarrier = () => ({
	host: document.createElement("div"),
	hostStyleIsBound: false,
	cssPlanMountCounts: null,
});

const mountIntoShadow = (value: TemplateValue) => {
	const carrier = detachedCarrier();
	const shadowRoot = carrier.host.attachShadow({ mode: "open" });
	const { instance, fragment } = mountInstance(value, carrier);
	shadowRoot.appendChild(fragment);
	return { carrier, shadowRoot, instance };
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
		expect(() =>
			mountInstance(html`<div>${inner}</div>`, detachedCarrier()),
		).toThrow(/top level of a component's render output/);
	});

	test("mounting a list whose item is a root template throws", () => {
		const items = [html`<template class="leak"><p>x</p></template>`];
		expect(() =>
			mountInstance(
				html`<ul>
					${items}
				</ul>`,
				detachedCarrier(),
			),
		).toThrow(/top level of a component's render output/);
	});
});

describe("mountInstance: fragment + live-binding wiring", () => {
	test("produces a DocumentFragment with the parsed shape", () => {
		const { fragment } = mountInstance(
			html`<section><p>${"hi"}</p></section>`,
			detachedCarrier(),
		);
		expect(fragment.querySelector("section")).not.toBeNull();
		expect(fragment.querySelector("p")?.textContent).toContain("hi");
	});

	test("builds one live binding per static binding", () => {
		const value = html`<p class="${"c"}">${"text"}</p>`;
		const { instance } = mountInstance(value, detachedCarrier());
		expect(instance.liveBindings.length).toBe(
			getParsedTemplate(value.__templateStrings).bindings.length,
		);
	});
});

describe("reconcileInstance: patch vs rebuild", () => {
	test("patches in place when the template hash matches", () => {
		const paragraph = (value: string) => html`<p class="${value}">x</p>`;
		const { instance } = mountInstance(paragraph("a"), detachedCarrier());
		expect(
			reconcileInstance(instance, paragraph("b"), detachedCarrier()),
		).toBeNull();
	});

	test("rebuilds when the structure differs", () => {
		const { instance } = mountInstance(html`<p>${"a"}</p>`, detachedCarrier());
		expect(
			reconcileInstance(instance, html`<span>${"a"}</span>`, detachedCarrier()),
		).not.toBeNull();
	});
});

describe("patchInstance: change detection", () => {
	test("a changed attribute value is written to the DOM", () => {
		const paragraph = (value: string) => html`<p class="${value}">${"hi"}</p>`;
		const { instance, fragment } = mountInstance(
			paragraph("before"),
			detachedCarrier(),
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
			detachedCarrier(),
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
	const varNameOf = (style: Element): string =>
		style.textContent!.match(/var\((--[^)]+)\)/)![1];
	const normalizeWhitespace = (string: string) =>
		string.replace(/\s+/g, " ").trim();

	test("mount carries the baked sheet in the fragment and stamps the host props", () => {
		const carrier = detachedCarrier();
		const { fragment } = mountInstance(sheet("red"), carrier);
		const styles = fragment.querySelectorAll("style");

		expect(styles).toHaveLength(1);
		expect(normalizeWhitespace(styles[0].textContent!)).toMatch(
			/^p \{ color:var\(--[a-z0-9]+-0\); \}$/,
		);
		expect(
			carrier.host.style.getPropertyValue(varNameOf(styles[0])).trim(),
		).toBe("red");
	});

	test("a patch rewrites the host prop, never the sheet", () => {
		const carrier = detachedCarrier();
		const { instance, fragment } = mountInstance(sheet("red"), carrier);
		const style = fragment.querySelector("style")!;
		const sheetTextNode = style.firstChild as Text;
		const sheetText = sheetTextNode.data;
		const name = varNameOf(style);

		patchInstance(instance, sheet("blue").values);

		expect(style.firstChild).toBe(sheetTextNode);
		expect(sheetTextNode.data).toBe(sheetText);
		expect(carrier.host.style.getPropertyValue(name).trim()).toBe("blue");
	});

	test("an unchanged patch writes nothing", () => {
		const carrier = detachedCarrier();
		const { instance, fragment } = mountInstance(sheet("red"), carrier);
		const name = varNameOf(fragment.querySelector("style")!);
		carrier.host.style.setProperty(name, "canary");

		patchInstance(instance, sheet("red").values);

		expect(carrier.host.style.getPropertyValue(name)).toBe("canary");
	});

	test("hydrate seeds without touching the sheet or host props; a later patch updates props only", () => {
		const { carrier, shadowRoot } = mountIntoShadow(sheet("red"));
		const style = shadowRoot.querySelector("style")!;
		const sheetTextNode = style.firstChild as Text;
		const name = varNameOf(style);
		carrier.host.style.setProperty(name, "canary");

		//hydration always starts with a fresh carrier (the painter creates one per
		//element), so its css mount counts replay from zero and re-derive the
		//server's name sequence — reusing the server carrier would double-count
		const clientCarrier = { ...detachedCarrier(), host: carrier.host };
		const instance = hydrateInstance(sheet("red"), shadowRoot, clientCarrier);
		expect(style.firstChild).toBe(sheetTextNode);
		expect(carrier.host.style.getPropertyValue(name)).toBe("canary");

		patchInstance(instance, sheet("blue").values);
		expect(style.firstChild).toBe(sheetTextNode);
		expect(carrier.host.style.getPropertyValue(name).trim()).toBe("blue");
	});

	test("a style-binding carrier forces the fallback: composed sheet, untouched host", () => {
		//the carrier's root template binds the host style attribute, which would wipe
		//the plan's custom properties — every planned style under it falls back
		const carrier = {
			host: document.createElement("div"),
			hostStyleIsBound: true,
			cssPlanMountCounts: null,
		};
		const { instance, fragment } = mountInstance(sheet("red"), carrier);
		const style = fragment.querySelector("style")!;

		expect(style.textContent).not.toContain("var(");
		expect(normalizeWhitespace(style.textContent!)).toBe("p { color: red; }");
		expect(carrier.host.getAttribute("style")).toBeNull();

		patchInstance(instance, sheet("blue").values);
		expect(normalizeWhitespace(style.textContent!)).toBe("p { color: blue; }");
		expect(carrier.host.getAttribute("style")).toBeNull();
	});

	test("hydrating under a style-binding carrier seeds the fallback gate", () => {
		const serverCarrier = {
			host: document.createElement("div"),
			hostStyleIsBound: true,
			cssPlanMountCounts: null,
		};
		const shadowRoot = serverCarrier.host.attachShadow({ mode: "open" });
		const mounted = mountInstance(sheet("red"), serverCarrier);
		shadowRoot.appendChild(mounted.fragment);
		const style = shadowRoot.querySelector("style")!;
		const serverTextNode = style.firstChild as Text;

		const instance = hydrateInstance(sheet("red"), shadowRoot, serverCarrier);
		expect(style.firstChild).toBe(serverTextNode);

		patchInstance(instance, sheet("blue").values);
		expect(normalizeWhitespace(style.textContent!)).toBe("p { color: blue; }");
	});

	test("the same template mounted twice under one host gets disjoint names", () => {
		const carrier = detachedCarrier();
		const first = mountInstance(sheet("red"), carrier);
		const second = mountInstance(sheet("blue"), carrier);
		const firstStyle = first.fragment.querySelector("style")!;
		const secondStyle = second.fragment.querySelector("style")!;
		const firstName = varNameOf(firstStyle);
		const secondName = varNameOf(secondStyle);

		expect(firstName).not.toBe(secondName);
		expect(carrier.host.style.getPropertyValue(firstName).trim()).toBe("red");
		expect(carrier.host.style.getPropertyValue(secondName).trim()).toBe("blue");
	});

	test("patching one duplicate leaves the other instance's prop untouched", () => {
		const carrier = detachedCarrier();
		const first = mountInstance(sheet("red"), carrier);
		const second = mountInstance(sheet("blue"), carrier);
		const firstName = varNameOf(first.fragment.querySelector("style")!);
		const secondStyle = second.fragment.querySelector("style")!;
		const secondName = varNameOf(secondStyle);
		const secondSheetTextNode = secondStyle.firstChild as Text;

		patchInstance(second.instance, sheet("green").values);

		expect(carrier.host.style.getPropertyValue(firstName).trim()).toBe("red");
		expect(carrier.host.style.getPropertyValue(secondName).trim()).toBe(
			"green",
		);
		//the duplicate's suffixed sheet was written once at mount, then never again
		expect(secondStyle.firstChild).toBe(secondSheetTextNode);
	});

	test("hydration re-derives the duplicate's suffixed names from mount order", () => {
		const serverCarrier = detachedCarrier();
		const shadowRoot = serverCarrier.host.attachShadow({ mode: "open" });
		const first = mountInstance(sheet("red"), serverCarrier);
		shadowRoot.appendChild(first.fragment);
		const second = mountInstance(sheet("blue"), serverCarrier);
		shadowRoot.appendChild(second.fragment);
		const styles = shadowRoot.querySelectorAll("style");
		const secondName = varNameOf(styles[1]);

		const clientCarrier = { ...detachedCarrier(), host: serverCarrier.host };
		hydrateInstance(sheet("red"), shadowRoot, clientCarrier);
		const secondInstance = hydrateInstance(
			sheet("blue"),
			styles[0],
			clientCarrier,
		);

		patchInstance(secondInstance, sheet("green").values);
		expect(serverCarrier.host.style.getPropertyValue(secondName).trim()).toBe(
			"green",
		);
	});
});

describe("hydrateInstance: trusts the server DOM (seed, don't write)", () => {
	test("does not re-write server-rendered content, and the text node survives", () => {
		const { carrier, shadowRoot } = mountIntoShadow(
			html`<p>${"server-text"}</p>`,
		);
		const paragraph = shadowRoot.querySelector("p")!;
		const serverTextNode = textNodeOf(paragraph);
		expect(serverTextNode.data).toBe("server-text");

		hydrateInstance(html`<p>${"client-text"}</p>`, shadowRoot, carrier);

		expect(textNodeOf(paragraph)).toBe(serverTextNode);
		expect(serverTextNode.data).toBe("server-text");
	});

	test("does not overwrite a server-rendered attribute on hydrate", () => {
		const { carrier, shadowRoot } = mountIntoShadow(
			html`<span class="${"server-class"}"></span>`,
		);
		const span = shadowRoot.querySelector("span")!;
		expect(span.getAttribute("class")).toBe("server-class");
		span.setAttribute("class", "stale-from-dom");

		hydrateInstance(
			html`<span class="${"client-class"}"></span>`,
			shadowRoot,
			carrier,
		);

		expect(span.getAttribute("class")).toBe("stale-from-dom");
	});

	test("a patch after hydrate refreshes content to the current values", () => {
		const { carrier, shadowRoot } = mountIntoShadow(
			html`<p>${"server-text"}</p>`,
		);
		const instance = hydrateInstance(
			html`<p>${"client-text"}</p>`,
			shadowRoot,
			carrier,
		);
		expect(shadowRoot.querySelector("p")?.textContent).toBe("server-text");

		patchInstance(instance, ["refreshed"]);
		expect(shadowRoot.querySelector("p")?.textContent).toBe("refreshed");
	});

	test("a patch after hydrate writes a changed attribute value", () => {
		const { carrier, shadowRoot } = mountIntoShadow(
			html`<span class="${"server-class"}"></span>`,
		);
		const span = shadowRoot.querySelector("span")!;
		const instance = hydrateInstance(
			html`<span class="${"client-class"}"></span>`,
			shadowRoot,
			carrier,
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
		const { carrier, shadowRoot } = mountIntoShadow(rows(["a", "b"]));

		expect(() =>
			hydrateInstance(rows(["a", "b"]), shadowRoot, carrier),
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
		const { carrier, shadowRoot } = mountIntoShadow(rows(tree));

		expect(() =>
			hydrateInstance(rows(tree), shadowRoot, carrier),
		).not.toThrow();

		expect(shadowRoot.querySelectorAll("li").length).toBe(2);
		expect(shadowRoot.querySelectorAll("span").length).toBe(4);
	});
});
