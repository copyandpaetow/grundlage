import { describe, expect, test, vi } from "vitest";
import { html, load, component } from "../index";
import { FORM_EVENTS } from "../forms";

// The closed-mode round-trip needs a real browser: happy-dom has neither attachInternals
// nor declarative-shadow parsing, so skip there and let the chromium project carry it.
// These tests also double as the verification that attachInternals().shadowRoot exposes a
// *declaratively-created* closed root — the platform fact the whole fix rests on.
const canRun =
	typeof HTMLElement.prototype.attachInternals === "function" &&
	typeof (Element.prototype as { setHTMLUnsafe?: unknown }).setHTMLUnsafe ===
		"function";

const sleep = (duration = 0) =>
	new Promise((resolve) => setTimeout(resolve, duration));

let tagId = 0;
const uniqueTag = () => `closed-el-${tagId++}-${Date.now()}`;

// A closed-mode component's SSR output is a host carrying a declarative closed shadow root;
// setHTMLUnsafe is what attaches it. The element is left un-upgraded (tag defined later) so
// each test can drive hydration explicitly, mirroring "server HTML first, JS defines it".
const prerenderClosed = (tag: string, shadowInner: string): HTMLElement => {
	const holder = document.createElement("div");
	document.body.appendChild(holder);
	(holder as unknown as { setHTMLUnsafe(html: string): void }).setHTMLUnsafe(
		`<${tag}><template shadowrootmode="closed">${shadowInner}</template></${tag}>`,
	);
	return holder.firstElementChild as HTMLElement;
};

const closedRootOf = (host: HTMLElement): ShadowRoot =>
	(host as unknown as { internals: ElementInternals }).internals
		.shadowRoot as ShadowRoot;

describe("closed shadow root — hydration + load replay", () => {
	test.skipIf(!canRun)(
		"cold closed component renders into a fresh closed root, absent from host.shadowRoot",
		async () => {
			const tag = uniqueTag();
			customElements.define(
				tag,
				component(
					function* () {
						yield () => html`<p>${"fresh"}</p>`;
					},
					{ mode: "closed" },
				),
			);

			const host = document.createElement(tag);
			document.body.appendChild(host);
			await sleep();

			expect(host.shadowRoot).toBeNull();
			expect(closedRootOf(host).querySelector("p")?.textContent).toBe("fresh");

			host.remove();
		},
	);

	test.skipIf(!canRun)(
		"prerendered closed component hydrates the server DOM instead of re-rendering it",
		async () => {
			// the server node carries a static marker the client template never emits;
			// it survives iff hydration reused the node rather than rebuilding from scratch.
			// content is static so adoption needs no internal hydration markers (which real
			// SSR emits and this hand-rolled markup can't).
			const tag = uniqueTag();
			const host = prerenderClosed(tag, `<p data-server="1">hi</p>`);

			customElements.define(
				tag,
				component(
					function* () {
						yield () => html`<p>hi</p>`;
					},
					{ mode: "closed" },
				),
			);
			customElements.upgrade(host);
			await sleep();

			const paragraph = closedRootOf(host).querySelector("p");
			expect(paragraph?.textContent).toBe("hi");
			expect(paragraph?.hasAttribute("data-server")).toBe(true);

			host.remove();
		},
	);

	test.skipIf(!canRun)(
		"prerendered closed load() replays the server payload instead of re-fetching",
		async () => {
			const tag = uniqueTag();
			const host = prerenderClosed(
				tag,
				`<p>hi</p><script type="application/json" data-ssr>${JSON.stringify("server-value")}</script>`,
			);

			let fetched = false;
			let got: unknown;
			customElements.define(
				tag,
				component(
					function* (host) {
						got = yield load(host, async () => {
							fetched = true;
							return "client-value";
						});
						yield () => html`<p>hi</p>`;
					},
					{ mode: "closed" },
				),
			);
			customElements.upgrade(host);
			await sleep();

			expect(got).toBe("server-value");
			expect(fetched).toBe(false);

			host.remove();
		},
	);

	test.skipIf(!canRun)(
		"closed form component acquires internals exactly once and still fires form callbacks",
		async () => {
			// a second attachInternals() would throw during construction; single-call is
			// proven by successful upgrade + the getter handing back the same memoized object
			const tag = uniqueTag();
			const host = prerenderClosed(tag, `<input />`);
			const attachSpy = vi.spyOn(HTMLElement.prototype, "attachInternals");

			let firstRead: ElementInternals | null | undefined;
			let secondRead: ElementInternals | null | undefined;
			customElements.define(
				tag,
				component(
					function* (host) {
						firstRead = host.internals;
						secondRead = host.internals;
						yield () => html`<template><input /></template>`;
					},
					{ mode: "closed", formAssociated: true },
				),
			);
			customElements.upgrade(host);
			await sleep();

			expect(attachSpy).toHaveBeenCalledTimes(1);
			expect(firstRead).toBeInstanceOf(ElementInternals);
			expect(firstRead).toBe(secondRead);

			const form = document.createElement("form");
			form.appendChild(host);
			document.body.appendChild(form);
			let resets = 0;
			host.addEventListener(FORM_EVENTS.reset, () => resets++);
			form.reset();
			expect(resets).toBe(1);

			attachSpy.mockRestore();
			form.remove();
		},
	);
});
