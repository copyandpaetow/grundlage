import { describe, expect, test } from "vitest";
import { html, component } from "../../../index";

//happy-dom resolves no :host inheritance, so only the text is checked there
const isRealBrowser = typeof (window as { happyDOM?: unknown }).happyDOM === "undefined";

describe("a dynamic :host rule", () => {
	let tagIndex = 0;

	const mountProbe = () => {
		const tagName = `test-host-rule-${tagIndex++}`;
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
		const stylesOf = () => Array.from(host.shadowRoot!.querySelectorAll("style"));
		const innerOf = () => host.shadowRoot!.querySelector(".inner")!;
		return { host, values, stylesOf, innerOf };
	};

	test("a changed :host value restyles the host and reaches the shadow tree", async () => {
		const { host, values, stylesOf, innerOf } = mountProbe();
		await host.update();
		for (const offset of [2, 3]) {
			values.offset = offset;
			await host.update();
			expect(stylesOf()[0].textContent).toContain(`--offset: ${offset}px;`);
			if (isRealBrowser) {
				expect(getComputedStyle(innerOf()).getPropertyValue("--offset")).toBe(`${offset}px`);
			}
		}
		host.remove();
	});

	test("a change to a child rule leaves the :host rule's <style> alone", async () => {
		const { host, values, stylesOf } = mountProbe();
		await host.update();
		const [hostStyle, innerStyle] = stylesOf();
		const hostText = hostStyle.firstChild;

		values.inner = 5;
		await host.update();

		expect(hostStyle.firstChild).toBe(hostText);
		expect(innerStyle.textContent).toContain("--inner: 5px;");
		host.remove();
	});
});
