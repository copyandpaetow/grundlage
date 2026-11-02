import { describe, expect, test } from "vitest";
import { html, component } from "../../../index";

//WebKit serves a host's style from before a setProperty on a rule that matches it, so such a rule
//is re-inserted after a change; every other rule keeps its object
//happy-dom resolves no :host inheritance, so only the rule objects are checked there
const isRealBrowser =
	typeof (window as { happyDOM?: unknown }).happyDOM === "undefined";

describe("re-inserting a changed rule that can match the host", () => {
	let tagIndex = 0;

	const mountProbe = () => {
		const tagName = `test-host-reinsertion-${tagIndex++}`;
		const values = { offset: 1, inner: 1 };
		customElements.define(
			tagName,
			component(function* () {
				yield function* view() {
					yield html`<style>
							:host {
								display: block;
								--offset: ${values.offset}px;
							}
							.inner {
								--inner: ${values.inner}px;
							}
						</style>
						<div class="inner"></div>`;
				};
			}),
		);
		const host = document.createElement(tagName) as HTMLElement & {
			update(): Promise<void>;
		};
		document.body.append(host);
		const sheetOf = () => host.shadowRoot!.querySelector("style")!.sheet!;
		const innerOf = () => host.shadowRoot!.querySelector(".inner")!;
		return { host, values, sheetOf, innerOf };
	};

	test("a changed :host value replaces the :host rule and reaches the shadow tree", async () => {
		const { host, values, sheetOf, innerOf } = mountProbe();
		await host.update();
		const [hostRuleBefore, innerRuleBefore] = Array.from(sheetOf().cssRules);
		for (const offset of [2, 3]) {
			values.offset = offset;
			await host.update();
			if (isRealBrowser)
				expect(getComputedStyle(innerOf()).getPropertyValue("--offset")).toBe(
					`${offset}px`,
				);
		}
		expect(sheetOf().cssRules[0]).not.toBe(hostRuleBefore);
		expect(sheetOf().cssRules[1]).toBe(innerRuleBefore);
		host.remove();
	});

	test("an unchanged :host value leaves the :host rule in place", async () => {
		const { host, values, sheetOf } = mountProbe();
		await host.update();
		const hostRuleBefore = sheetOf().cssRules[0];
		values.inner = 5;
		await host.update();
		expect(sheetOf().cssRules[0]).toBe(hostRuleBefore);
		host.remove();
	});
});
