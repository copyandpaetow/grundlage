import { afterEach, describe, expect, test, vi } from "vitest";
import { component, html } from "../../index";
import { createRun, tearDownRun } from "../run";
import { ComponentRunner } from "../driver";

//what the driver sends back into a generator for each thing it yields or returns, driven through the
//public component() surface

let counter = 0;
const uniqueTag = () => `test-run-${counter++}-${Date.now()}`;
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

	test("a template yield evaluates to the host", async () => {
		let yieldedBack: unknown;
		const element = mount(
			component(function* () {
				yieldedBack = yield html`<p>x</p>`;
			}),
		);
		await sleep();
		expect(yieldedBack).toBe(element);
	});
});

describe("the body waits at an update generator yield for the first run that finishes", () => {
	test("an update during the first run restarts it, and the body resumes with the newer run's value", async () => {
		const gates: Array<PromiseWithResolvers<string>> = [];
		const received: Array<unknown> = [];
		const element = mount(
			component(function* () {
				received.push(
					yield function* () {
						const gate = Promise.withResolvers<string>();
						gates.push(gate);
						yield html`<p>run ${gates.length}</p>`;
						return `${yield gate.promise} from run ${gates.length}`;
					},
				);
			}),
		) as HTMLElement & { update(): Promise<void> };
		await sleep();
		void element.update();
		await sleep();
		gates[0].resolve("dropped");
		await sleep();
		expect(received).toEqual([]);
		gates[1].resolve("kept");
		await sleep();
		expect(received).toEqual(["kept from run 2"]);
	});

	test("an error after a wait in the first run is thrown at the update generator yield", async () => {
		const element = mount(
			component(function* () {
				try {
					yield function* () {
						yield sleep();
						throw new Error("late");
					};
				} catch (error) {
					yield html`<p>caught ${(error as Error).message}</p>`;
				}
			}),
		);
		await sleep(10);
		expect(element.shadowRoot?.textContent).toBe("caught late");
	});

	test("an error from a later run ends the component, even with the body inside a try", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		let shouldThrow = false;
		const element = mount(
			component(function* () {
				yield function* () {
					if (shouldThrow) throw new Error("later");
					yield html`<p>ok</p>`;
				};
				try {
					yield Promise.withResolvers().promise;
				} catch {
					yield html`<p>caught</p>`;
				}
			}),
		) as HTMLElement & { update(): Promise<void> };
		await sleep();
		shouldThrow = true;
		await element.update();
		await sleep();
		expect(element.shadowRoot?.textContent).toContain("later");
		expect(element.shadowRoot?.textContent).not.toContain("caught");
	});
	test("an update generator yielding another is refused past its own catch, into the waiting body", async () => {
		const element = mount(
			component(function* () {
				try {
					yield function* () {
						try {
							yield function* () {};
						} catch {
							yield html`<p>caught by the update generator</p>`;
						}
					};
				} catch (error) {
					yield html`<p>${(error as Error).message}</p>`;
				}
			}),
		);
		await sleep();
		expect(element.shadowRoot?.textContent).toContain(
			"One level of nesting only",
		);
	});
});

describe("a paint error is thrown at the yield that painted", () => {
	test("the body catches its own template's paint error", async () => {
		const element = mount(
			component(function* () {
				try {
					yield html`<p>${{} as never}</p>`;
				} catch {
					yield html`<p>caught</p>`;
				}
			}),
		);
		await sleep();
		expect(element.shadowRoot?.textContent).toBe("caught");
	});

	test("an update generator catches its own paint error and runs again on the next update", async () => {
		let value: unknown = {};
		const element = mount(
			component(function* () {
				yield function* () {
					try {
						yield html`<p>${value as never}</p>`;
					} catch {
						yield html`<p>fallback</p>`;
					}
				};
			}),
		) as HTMLElement & { update(): Promise<void> };
		await sleep();
		expect(element.shadowRoot?.textContent).toBe("fallback");
		value = "fixed";
		await element.update();
		expect(element.shadowRoot?.textContent).toBe("fixed");
	});
});

describe("a yield that is not a template, an update generator, a promise or a load()", () => {
	test.each([
		["an arrow function", () => html`<p>x</p>`],
		["an async arrow function", async () => html`<p>x</p>`],
		["an async generator function", async function* () {}],
		["a number", 42],
		["a string", "Loading…"],
		["an array of templates", [html`<i>a</i>`, html`<i>b</i>`]],
		["undefined", undefined],
		["a thenable that is not a promise", { then: () => {} }],
	] as const)(
		"%s ends the component with a message naming the four",
		async (_label, yielded) => {
			vi.spyOn(console, "error").mockImplementation(() => {});
			const element = mount(
				component(function* () {
					yield yielded as never;
				}),
			);
			await sleep();
			expect(element.shadowRoot?.textContent).toContain(
				"a component yields a template, an update generator, a promise or a load()",
			);
		},
	);
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

describe("tearing down a generator", () => {
	test("a promise yielded in finally is awaited, and the block runs to its end", async () => {
		const original = Promise.withResolvers<unknown>();
		const received: Array<unknown> = [];
		const element = mount(
			component(function* () {
				try {
					yield original.promise;
				} finally {
					received.push(yield Promise.resolve("saved"));
				}
			}),
		);
		element.remove();
		await sleep();
		expect(received).toEqual(["saved"]);
	});

	//only the permit stops the promise the generator was parked on from stepping it a second time
	test.each([
		["resolves", (settle: PromiseWithResolvers<unknown>) => settle.resolve(1)],
		[
			"rejects",
			(settle: PromiseWithResolvers<unknown>) =>
				settle.reject(new Error("late")),
		],
	] as const)(
		"the parked promise that %s after removal does not step the teardown",
		async (_label, finish) => {
			const original = Promise.withResolvers<unknown>();
			const held = Promise.withResolvers<unknown>();
			const received: Array<unknown> = [];
			const element = mount(
				component(function* () {
					try {
						yield original.promise;
					} finally {
						try {
							received.push(yield held.promise);
						} catch (error) {
							received.push(error);
						}
					}
				}),
			);
			element.remove();
			await sleep();
			finish(original);
			await sleep();
			expect(received).toEqual([]);
			held.resolve("held");
			await sleep();
			expect(received).toEqual(["held"]);
		},
	);

	test("a new update generator run cuts the old run's teardown off and warns", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		let finishedTeardownCount = 0;
		const element = mount(
			component(function* () {
				yield function* () {
					try {
						yield html`<p>first run</p>`;
						yield Promise.withResolvers().promise;
					} finally {
						yield sleep();
						finishedTeardownCount++;
					}
				};
			}),
		);
		await sleep();
		//not awaited: the replacing run parks too, so it never settles
		void (element as HTMLElement & { update(): Promise<void> }).update();
		await sleep(5);
		expect(finishedTeardownCount).toBe(0);
		expect(warn).toHaveBeenCalledOnce();
		expect(warn.mock.calls[0][0]).toContain("a new run started");
	});

	test("a template yielded in finally is reported and ends the teardown", async () => {
		//happy-dom has no reportError, so the report falls back to console.error
		const reported = vi.spyOn(console, "error").mockImplementation(() => {});
		let ranPastTheTemplate = false;
		const element = mount(
			component(function* () {
				try {
					yield Promise.withResolvers().promise;
				} finally {
					yield html`<p>gone</p>`;
					ranPastTheTemplate = true;
				}
			}),
		);
		element.remove();
		await sleep();
		expect(ranPastTheTemplate).toBe(false);
		expect(reported).toHaveBeenCalledOnce();
		expect(String(reported.mock.calls[0][0])).toContain("yields only promises");
	});
});

describe("tearing down a run", () => {
	//the teardown has a sibling run to tear down and a paint to make after this, so a user cleanup
	//that throws is reported rather than propagated
	test("a cleanup that throws does not escape the teardown", () => {
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => {});
		//the runner is read only when a finally block yields
		const run = createRun({} as ComponentRunner, (function* () {})());
		run.cleanup = () => {
			throw new Error("cleanup-threw");
		};

		expect(() => tearDownRun(run)).not.toThrow();
		expect(run.cleanup).toBe(null);
		expect(consoleError).toHaveBeenCalledOnce();
	});
});
