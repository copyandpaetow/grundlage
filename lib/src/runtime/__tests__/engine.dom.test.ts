import { afterEach, describe, expect, test, vi } from "vitest";
import { html, component } from "../../index";

/*
engine-level invariants that aren't a pure-step property (so they live here, not in vm.dom.test) but are
narrower than the integration oracles: the terminal warns EXACTLY once (the linear recover->fail path
replaces the old nested re-entrancy that could double-warn), and a torn-down generation neither paints
nor resolves a late update() past disconnect. driven through the public component() surface.
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
			component(function* () {
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

	test("a fatal error displays in closed shadow mode (host.shadowRoot is null)", async () => {
		vi.spyOn(console, "warn").mockImplementation(() => {});
		const attachShadow = HTMLElement.prototype.attachShadow;
		let closedRoot: ShadowRoot | undefined;
		vi.spyOn(HTMLElement.prototype, "attachShadow").mockImplementation(
			function (this: HTMLElement, init: ShadowRootInit) {
				closedRoot = attachShadow.call(this, init);
				return closedRoot;
			},
		);

		const element = mount(
			component(
				function* () {
					yield () => {
						throw new Error("closed-boom");
					};
				},
				{ mode: "closed" },
			),
		);
		await sleep();

		expect(element.shadowRoot).toBeNull(); //closed: the host exposes no root
		//...yet the engine still displayed the error, via painter.shadowRoot not host.shadowRoot!
		expect(closedRoot?.textContent).toContain("closed-boom");
		element.remove();
	});

	test("update() after a terminal error is a no-op (the renderer was cleared)", async () => {
		vi.spyOn(console, "warn").mockImplementation(() => {});
		let shouldThrow = true;
		const element = mount(
			component(function* () {
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

	test("reconnect after a fatal error remounts instead of patching the detached error text", async () => {
		vi.spyOn(console, "warn").mockImplementation(() => {});
		let boom = false;
		const element = mount(
			component(function* () {
				yield () => {
					if (boom) throw new Error("late-boom");
					return html`<p>alive</p>`;
				};
			}),
		) as HTMLElement & { update(): Promise<void> };
		await sleep();
		expect(element.shadowRoot?.textContent).toContain("alive");

		boom = true;
		await element.update(); //fatal: the shadow shows the error, the stale instance is dropped
		expect(element.shadowRoot?.textContent).toContain("late-boom");

		boom = false;
		element.remove();
		document.body.appendChild(element); //reconnect restarts the engine on the same painter
		await sleep();
		//same-hash re-render must NOT patch the detached error text; it must remount live DOM
		expect(element.shadowRoot?.textContent).toContain("alive");
		expect(element.shadowRoot?.textContent).not.toContain("late-boom");
		element.remove();
	});
});

describe("dismissed child errors", () => {
	test("outer catching a child error by returning: never fatal, cleanup deferred to disconnect, update() a no-op", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		let cleanupCalls = 0;
		const element = mount(
			component(function* () {
				try {
					yield function* () {
						yield () => {
							throw new Error("child-boom");
						};
					};
				} catch {
					return () => {
						cleanupCalls++;
					};
				}
			}),
		) as HTMLElement & { update(): Promise<void> };
		await sleep();

		//the outer swallowed the error: never a fatal, and cleanup is NOT run yet
		expect(warn).not.toHaveBeenCalled();
		expect(cleanupCalls).toBe(0);

		//the dead child renderer was dropped: update() no-ops (does not re-run/re-throw)
		await element.update();
		expect(warn).not.toHaveBeenCalled();
		expect(cleanupCalls).toBe(0);

		//cleanup runs exactly once, at disconnect
		element.remove();
		await sleep();
		expect(cleanupCalls).toBe(1);
	});
});
