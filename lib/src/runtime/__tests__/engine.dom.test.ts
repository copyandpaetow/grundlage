import { afterEach, describe, expect, test, vi } from "vitest";
import { html, render } from "../../index";

/*
engine-level invariants that aren't a pure-step property (so they live here, not in vm.dom.test) but are
narrower than the integration oracles: the terminal warns EXACTLY once (the linear recover->fail path
replaces the old nested re-entrancy that could double-warn), and a torn-down generation neither paints
nor resolves a late update() past disconnect. driven through the public render() surface.
*/

let counter = 0;
const uniqueTag = () => `test-engine-${counter++}-${Date.now()}`;
const sleep = (duration = 0) =>
	new Promise((resolve) => setTimeout(resolve, duration));

const mount = (constructor: CustomElementConstructor): HTMLElement => {
	const tag = uniqueTag();
	customElements.define(tag, constructor);
	const element = document.createElement(tag);
	document.body.appendChild(element);
	return element;
};

afterEach(() => {
	vi.restoreAllMocks();
});

describe("engine terminal", () => {
	test("an uncaught error warns exactly once", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const element = mount(
			render(function* () {
				yield function* () {
					yield () => {
						throw new Error("once");
					};
				};
			}),
		);
		await sleep();

		expect(element.shadowRoot?.textContent).toContain("once");
		expect(warn).toHaveBeenCalledTimes(1);
		element.remove();
	});

	test("update() after a terminal error is a no-op (the renderer was cleared)", async () => {
		vi.spyOn(console, "warn").mockImplementation(() => {});
		let shouldThrow = true;
		const element = mount(
			render(function* () {
				yield () => {
					if (shouldThrow) throw new Error("boom");
					return html`<p>recovered</p>`;
				};
			}),
		) as HTMLElement & { update(): Promise<void> };
		await sleep();
		expect(element.shadowRoot?.textContent).toContain("boom");

		shouldThrow = false;
		await element.update(); //must resolve (not hang) and must NOT re-render
		expect(element.shadowRoot?.textContent).toContain("boom");
		element.remove();
	});
});
