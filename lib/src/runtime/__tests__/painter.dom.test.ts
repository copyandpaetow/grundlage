import { describe, expect, test, vi } from "vitest";
import { html } from "../../template";
import { BaseComponent } from "../../types";
import { createPainter, paint, teardownPainter } from "../painter";

/*
the Painter's DOM-commit jobs (B1 setup, B2 patch-on-shape-match vs replace). the patch/replace and
observer-bracket internals are lifted verbatim from the god-runtime's renderCSR, so the real risk
this file guards is the lifted shape committing correctly through the new struct, not the proven
template machinery (the host-attribute observer bracket is exercised end-to-end by the host-attribute
browser suite; full SSR hydration by the SSR suite at Phase 4).
*/

const makeHost = (): BaseComponent => {
	const host = document.createElement("div");
	host.attachShadow({ mode: "open" });
	return host as unknown as BaseComponent;
};

describe("painter — DOM commit (B1/B2)", () => {
	test("B1: first paint sets up the template into the shadow root", () => {
		const host = makeHost();
		const painter = createPainter(host, host.shadowRoot!, false);

		paint(painter, html`<p>${"a"}</p>`);
		expect(host.shadowRoot?.querySelector("p")?.textContent).toBe("a");
		expect(painter.instance).not.toBeNull();
	});

	test("B2: a same-shape re-paint patches in place (node identity preserved)", () => {
		const host = makeHost();
		const painter = createPainter(host, host.shadowRoot!, false);
		//same tagged-template site → same parsed shape → templateHash match → updateTemplate path
		const render = (value: string) => html`<p>${value}</p>`;

		paint(painter, render("a"));
		const paragraphBefore = host.shadowRoot?.querySelector("p");

		paint(painter, render("b"));
		const paragraphAfter = host.shadowRoot?.querySelector("p");
		expect(paragraphAfter?.textContent).toBe("b");
		expect(paragraphAfter).toBe(paragraphBefore); //patched, not replaced
	});

	test("B2: a different-shape re-paint replaces the children", () => {
		const host = makeHost();
		const painter = createPainter(host, host.shadowRoot!, false);

		paint(painter, html`<p>${"a"}</p>`);
		const paragraph = host.shadowRoot?.querySelector("p");

		paint(painter, html`<section>${"b"}</section>`);
		expect(host.shadowRoot?.querySelector("p")).toBeNull(); //old shape gone
		expect(host.shadowRoot?.querySelector("section")?.textContent).toBe("b");
		expect(paragraph?.isConnected).toBe(false); //replaced, not patched
	});

	test("hydrate commits a host attribute so the client value wins over the server's", () => {
		//host attrs live on the host element, outside the hydrated shadow root, so the
		//client's first-yield value must overwrite what the server serialized
		const host = makeHost();
		host.setAttribute("class", "server-class");
		host.shadowRoot!.innerHTML = "<p>hi</p>";

		const painter = createPainter(host, host.shadowRoot!, true);
		paint(
			painter,
			html`<template class="${"client-class"}"><p>hi</p></template>`,
		);

		expect(host.getAttribute("class")).toBe("client-class");
	});

	test("hydrate does not re-write a host attribute whose server value already matches", () => {
		//the getAttribute compare must skip the write — a false write restarts transitions
		const host = makeHost();
		host.setAttribute("class", "same");
		host.shadowRoot!.innerHTML = "<p>hi</p>";
		const setSpy = vi.spyOn(host, "setAttribute");

		const painter = createPainter(host, host.shadowRoot!, true);
		paint(painter, html`<template class="${"same"}"><p>hi</p></template>`);

		expect(setSpy).not.toHaveBeenCalled();
		expect(host.getAttribute("class")).toBe("same");
	});

	test("hydrate warns when an SSR load() payload goes unclaimed", () => {
		const host = makeHost();
		host.shadowRoot!.innerHTML = "<p>hi</p>";
		const script = document.createElement("script");
		script.setAttribute("type", "application/json");
		script.setAttribute("data-ssr", "");
		script.textContent = JSON.stringify("orphaned");
		host.shadowRoot!.append(script);
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

		const painter = createPainter(host, host.shadowRoot!, true);
		paint(painter, html`<p>hi</p>`);

		expect(warnSpy).toHaveBeenCalledTimes(1);
		warnSpy.mockRestore();
	});

	test("teardownPainter disconnects the observer", () => {
		const host = makeHost();
		const painter = createPainter(host, host.shadowRoot!, false);
		let disconnected = false;
		painter.attributeObserver = {
			disconnect: () => {
				disconnected = true;
			},
		} as unknown as MutationObserver;

		teardownPainter(painter);
		expect(disconnected).toBe(true);
	});
});
