import { afterEach, describe, expect, test, vi } from "vitest";
import { component, html } from "../index";

let tagId = 0;
const uniqueTag = () => `endless-steps-${tagId++}-${Date.now()}`;

afterEach(() => {
	vi.restoreAllMocks();
});

describe("a generator that never waits", () => {
	test("ends through the fatal path instead of hanging the page", () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		const tag = uniqueTag();
		customElements.define(
			tag,
			component(function* () {
				while (true) yield html`<p>again</p>`;
			}),
		);
		const host = document.createElement(tag);
		document.body.appendChild(host);

		expect(host.shadowRoot!.textContent).toContain("without waiting");

		host.remove();
	});
});
