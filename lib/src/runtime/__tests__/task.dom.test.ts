import { afterEach, describe, expect, test, vi } from "vitest";
import { component, html } from "../../index";
import { cancelTaskAndRunCleanup, createRenderTask } from "../task";
import { RenderRun } from "../driver";

//what the driver sends back into a generator for each thing it yields or returns, driven through the
//public component() surface

let counter = 0;
const uniqueTag = () => `test-task-${counter++}-${Date.now()}`;
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
	document.body.replaceChildren();
});

describe("the yield position", () => {
	test("a yielded promise resumes the generator with its value", async () => {
		const element = mount(
			component(function* () {
				const value = yield Promise.resolve("resolved");
				yield html`<p>${String(value)}</p>`;
			}),
		);
		await sleep();
		expect(element.shadowRoot?.textContent).toBe("resolved");
	});

	test("a rejected yielded promise is thrown at its yield", async () => {
		const element = mount(
			component(function* () {
				try {
					yield Promise.reject(new Error("rejected"));
				} catch (error) {
					yield html`<p>${(error as Error).message}</p>`;
				}
			}),
		);
		await sleep();
		expect(element.shadowRoot?.textContent).toBe("rejected");
	});

	//a yield inside finally survives return(), so the torn-down generator can still be stepped: only
	//the permit stops the late promise from doing it
	test.each([
		["resolves", (settle: PromiseWithResolvers<unknown>) => settle.resolve(1)],
		[
			"rejects",
			(settle: PromiseWithResolvers<unknown>) =>
				settle.reject(new Error("late")),
		],
	] as const)(
		"a yielded promise that %s after removal does not step the generator again",
		async (_label, finish) => {
			const settle = Promise.withResolvers<unknown>();
			let stepCountAfterRemoval = 0;
			const element = mount(
				component(function* () {
					try {
						yield settle.promise;
					} finally {
						try {
							yield "held open by the finally";
						} catch {
							/* a late rejection would be thrown here */
						}
						stepCountAfterRemoval++;
					}
				}),
			);
			element.remove();
			await sleep();
			finish(settle);
			await sleep();
			expect(stepCountAfterRemoval).toBe(0);
		},
	);

	test.each([
		["a number", 42],
		["an array", [html`<i>a</i>`, html`<i>b</i>`]],
	] as const)("%s is echoed back, not painted", async (_label, value) => {
		let echoed: unknown;
		const element = mount(
			component(function* () {
				echoed = yield value;
				yield html`<p>done</p>`;
			}),
		);
		await sleep();
		expect(echoed).toBe(value);
		expect(element.shadowRoot?.textContent).toBe("done");
	});

	test("a renderable yield evaluates to the host", async () => {
		let yieldedBack: unknown;
		const element = mount(
			component(function* () {
				yieldedBack = yield () => html`<p>x</p>`;
			}),
		);
		await sleep();
		expect(yieldedBack).toBe(element);
	});
});

describe("the return position of a render function", () => {
	test.each([
		["a string", "hello", "hello"],
		["an array", [html`<i>a</i>`, html`<i>b</i>`], "ab"],
	] as const)("%s paints as content", async (_label, produced, text) => {
		const element = mount(
			component(function* () {
				yield () => produced;
			}),
		);
		await sleep();
		expect(element.shadowRoot?.textContent).toBe(text);
	});

	test("undefined paints nothing and warns once about the missing return", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const element = mount(
			component(function* () {
				yield () => undefined;
			}),
		);
		await sleep();
		expect(element.shadowRoot?.textContent).toBe("");
		expect(warn).toHaveBeenCalledOnce();
		expect(warn.mock.calls[0][0]).toContain("explicit return");
	});

	test.each([
		["a plain object", { a: 1 }, "cannot be rendered"],
		["a Map", new Map(), "cannot be rendered"],
		["a symbol", Symbol("x"), "cannot be rendered"],
		["a Date", new Date(), "cannot be rendered"],
		["a plain function", () => {}, "needs the *"],
	] as const)(
		"%s ends the component with a message naming the fix",
		async (_label, produced, message) => {
			vi.spyOn(console, "error").mockImplementation(() => {});
			const element = mount(
				component(function* () {
					yield () => produced;
				}),
			);
			await sleep();
			expect(element.shadowRoot?.textContent).toContain(message);
		},
	);

	test("a generator function installs that body", async () => {
		const element = mount(
			component(function* () {
				yield () =>
					function* () {
						yield html`<p>branch</p>`;
					};
			}),
		);
		await sleep();
		expect(element.shadowRoot?.textContent).toBe("branch");
	});
});

describe("completion", () => {
	test("a returned function is the cleanup and runs on removal", async () => {
		const cleanup = vi.fn();
		const element = mount(
			component(function* () {
				yield html`<p>x</p>`;
				return cleanup;
			}),
		);
		await sleep();
		expect(cleanup).not.toHaveBeenCalled();
		element.remove();
		await sleep();
		expect(cleanup).toHaveBeenCalledOnce();
	});

	test("an implicit return warns about nothing", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		mount(
			component(function* () {
				yield html`<p>x</p>`;
			}),
		);
		await sleep();
		expect(warn).not.toHaveBeenCalled();
	});

	test("a return that is neither a function nor undefined warns", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		mount(
			//the type layer rejects this return, which is what the warning is for
			component(function* () {
				yield html`<p>x</p>`;
				return 42 as unknown as void;
			}),
		);
		await sleep();
		expect(warn).toHaveBeenCalledOnce();
		expect(warn.mock.calls[0][0]).toContain("cleanup function");
	});
});

describe("cancelling a task", () => {
	//the cancel has a sibling task to tear down and a paint to make after this, so a user cleanup
	//that throws is reported rather than propagated
	test("a cleanup that throws does not escape the cancel", () => {
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => {});
		//cancelling never reads the run
		const task = createRenderTask({} as RenderRun, (function* () {})());
		task.cleanup = () => {
			throw new Error("cleanup-threw");
		};

		expect(() => cancelTaskAndRunCleanup(task)).not.toThrow();
		expect(task.cleanup).toBe(null);
		expect(consoleError).toHaveBeenCalledOnce();
	});
});
