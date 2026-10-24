import { describe, expect, test, vi } from "vitest";
import { awaited, html, component } from "../../src/index";

const sleep = (duration = 0) =>
	new Promise((resolve) => setTimeout(resolve, duration));

describe("components that yield promises", () => {
	let tagId = 0;
	const uniqueTag = () => `test-async-${tagId++}-${Date.now()}`;

	const mount = (tag: string): HTMLElement => {
		const element = document.createElement(tag);
		document.body.appendChild(element);
		return element;
	};

	const cleanup = (element: HTMLElement) => {
		element.remove();
	};

	test("mounts and paints", async () => {
		const tag = uniqueTag();

		const MyElement = component(function* () {
			yield function* () {
				yield html`<p>async hello</p>`;
			};
		});

		customElements.define(tag, MyElement);
		const element = mount(tag);
		await sleep();

		const p = element.shadowRoot?.querySelector("p");
		expect(p).not.toBeNull();
		expect(p?.textContent).toBe("async hello");

		cleanup(element);
	});

	test("update() paints the new state", async () => {
		const tag = uniqueTag();
		let count = 0;

		const Counter = component(function* () {
			yield function* () {
				yield html`<span>${count}</span>`;
			};
		});

		customElements.define(tag, Counter);
		const element = mount(tag) as InstanceType<typeof Counter>;
		await sleep();

		expect(element.shadowRoot?.querySelector("span")?.textContent).toBe("0");

		count = 5;
		await element.update();
		await sleep();

		expect(element.shadowRoot?.querySelector("span")?.textContent).toBe("5");

		cleanup(element);
	});

	test("yields a promise to await async work before painting", async () => {
		const tag = uniqueTag();
		let data = "loading";

		const MyElement = component(function* () {
			yield new Promise<void>((resolve) => {
				setTimeout(() => {
					data = "loaded";
					resolve();
				}, 10);
			});
			yield function* () {
				yield html`<p>${data}</p>`;
			};
		});

		customElements.define(tag, MyElement);
		const element = mount(tag);

		await sleep(50);

		const p = element.shadowRoot?.querySelector("p");
		expect(p).not.toBeNull();
		expect(p?.textContent).toBe("loaded");

		cleanup(element);
	});

	test("disconnectedCallback cleans up", async () => {
		const tag = uniqueTag();
		let cleaned = false;

		const MyElement = component(function* () {
			yield function* () {
				yield html`<p>temp</p>`;
			};
			return () => {
				cleaned = true;
			};
		});

		customElements.define(tag, MyElement);
		const element = mount(tag);

		await sleep();
		cleanup(element);
		await sleep();

		expect(cleaned).toBe(true);
	});

	test("replaces multiple update generators in sequence", async () => {
		const tag = uniqueTag();

		const MyElement = component(function* () {
			yield function* () {
				yield html`<p>first</p>`;
			};
			yield function* () {
				yield html`<p>second</p>`;
			};
		});

		customElements.define(tag, MyElement);
		const element = mount(tag);
		await sleep();

		expect(element.shadowRoot?.querySelector("p")?.textContent).toBe("second");

		cleanup(element);
	});

	test("yields multiple promises in sequence", async () => {
		const tag = uniqueTag();
		const order: string[] = [];

		const MyElement = component(function* () {
			yield new Promise<void>((resolve) => {
				setTimeout(() => {
					order.push("first");
					resolve();
				}, 10);
			});
			yield new Promise<void>((resolve) => {
				setTimeout(() => {
					order.push("second");
					resolve();
				}, 10);
			});
			yield function* () {
				yield html`<p>${order.join(",")}</p>`;
			};
		});

		customElements.define(tag, MyElement);
		const element = mount(tag);
		await sleep(100);

		expect(order).toEqual(["first", "second"]);
		expect(element.shadowRoot?.querySelector("p")?.textContent).toContain(
			"first,second",
		);

		cleanup(element);
	});

	test("yields a static template", async () => {
		const tag = uniqueTag();

		const MyElement = component(function* () {
			yield html`<p>async static</p>`;
		});

		customElements.define(tag, MyElement);
		const element = mount(tag);
		await sleep();

		expect(element.shadowRoot?.querySelector("p")?.textContent).toBe(
			"async static",
		);

		cleanup(element);
	});

	test("yields a promise then an update generator", async () => {
		const tag = uniqueTag();
		let data = "loading";

		const MyElement = component(function* () {
			yield new Promise<void>((resolve) => {
				setTimeout(() => {
					data = "ready";
					resolve();
				}, 10);
			});
			yield function* () {
				yield html`<p>${data}</p>`;
			};
		});

		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep(50);

		expect(element.shadowRoot?.querySelector("p")?.textContent).toContain(
			"ready",
		);

		data = "updated";
		await element.update();
		await sleep();

		expect(element.shadowRoot?.querySelector("p")?.textContent).toContain(
			"updated",
		);

		cleanup(element);
	});

	test("the body receives the host", async () => {
		const tag = uniqueTag();
		let receivedElement: HTMLElement | null = null;

		const MyElement = component(function* ({ host: el }) {
			receivedElement = el;
			yield function* () {
				yield html`<p>check</p>`;
			};
		});

		customElements.define(tag, MyElement);
		const element = mount(tag);
		await sleep();

		expect(receivedElement).toBe(element);

		cleanup(element);
	});

	test("the cleanup after a yielded promise runs on disconnect", async () => {
		const tag = uniqueTag();
		const cleanupOrder: string[] = [];

		const MyElement = component(function* () {
			yield new Promise<void>((resolve) => setTimeout(resolve, 10));
			yield function* () {
				yield html`<p>content</p>`;
			};
			return () => {
				cleanupOrder.push("cleaned");
			};
		});

		customElements.define(tag, MyElement);
		const element = mount(tag);
		await sleep(50);

		expect(element.shadowRoot?.querySelector("p")?.textContent).toBe("content");

		cleanup(element);
		await sleep();

		expect(cleanupOrder).toEqual(["cleaned"]);
	});
});

describe("error handling", () => {
	let tagId = 0;
	const uniqueTag = () => `test-err-${tagId++}-${Date.now()}`;

	const mount = (tag: string): HTMLElement => {
		const element = document.createElement(tag);
		document.body.appendChild(element);
		return element;
	};

	const cleanup = (element: HTMLElement) => {
		element.remove();
	};

	test("a yielded promise rejecting after disconnect paints nothing and stays silent", async () => {
		const tag = uniqueTag();
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => {});

		customElements.define(
			tag,
			component(function* () {
				yield function* () {
					yield html`<p>first</p>`;
				};
				yield sleep(40).then(() => {
					throw new Error("yielded-promise-rejected");
				});
			}),
		);
		const element = mount(tag);
		await sleep(10);
		expect(element.shadowRoot?.querySelector("p")?.textContent).toBe("first");

		cleanup(element);
		await sleep(80);

		expect(element.shadowRoot?.innerHTML).toBe("<p>first</p>");
		expect(consoleError).not.toHaveBeenCalled();
		consoleError.mockRestore();
	});

	test("sync generator: update generator error is shown in shadow DOM", async () => {
		const tag = uniqueTag();
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => {});

		const MyElement = component(function* () {
			yield function* () {
				throw new Error("sync update generator error");
			};
		});

		customElements.define(tag, MyElement);
		const element = mount(tag);
		await sleep();

		expect(element.shadowRoot?.textContent).toContain(
			"sync update generator error",
		);
		consoleError.mockRestore();
		cleanup(element);
	});

	test("sync generator: error in second yield is shown after the first paint", async () => {
		const tag = uniqueTag();
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => {});

		const MyElement = component(function* () {
			yield function* () {
				yield html`<p>works</p>`;
			};
			yield function* () {
				throw new Error("second yield error");
			};
		});

		customElements.define(tag, MyElement);
		const element = mount(tag);
		await sleep();

		expect(element.shadowRoot?.textContent).toContain("second yield error");
		consoleError.mockRestore();
		cleanup(element);
	});

	test("error in update() is shown in shadow DOM", async () => {
		const tag = uniqueTag();
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => {});
		let shouldThrow = false;

		const MyElement = component(function* () {
			yield function* () {
				if (shouldThrow) throw new Error("update error");
				yield html`<p>ok</p>`;
			};
		});

		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		expect(element.shadowRoot?.querySelector("p")?.textContent).toBe("ok");

		shouldThrow = true;
		await element.update();
		await sleep();

		expect(element.shadowRoot?.textContent).toContain("update error");
		consoleError.mockRestore();
		cleanup(element);
	});

	test("rejected yielded promise is shown in shadow DOM", async () => {
		const tag = uniqueTag();
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => {});

		const MyElement = component(function* () {
			yield Promise.reject(new Error("promise rejection"));
		});

		customElements.define(tag, MyElement);
		const element = mount(tag);
		await sleep();

		expect(element.shadowRoot?.textContent).toContain("promise rejection");
		consoleError.mockRestore();
		cleanup(element);
	});

	test("a rejected yielded promise is catchable with try/catch", async () => {
		//the try/catch form documented next to `yield fetch(url)` must intercept the
		//rejection so the generator can recover, not fail the whole component
		const tag = uniqueTag();
		let caught = false;

		const MyElement = component(function* () {
			try {
				yield Promise.reject(new Error("boom"));
			} catch {
				caught = true;
			}
			yield function* () {
				yield html`<p>recovered</p>`;
			};
		});

		customElements.define(tag, MyElement);
		const element = mount(tag);
		await sleep();

		expect(caught).toBe(true);
		expect(element.shadowRoot?.textContent).toContain("recovered");
		expect(element.shadowRoot?.textContent).not.toContain("boom");

		cleanup(element);
	});

	test("error stops further updates", async () => {
		const tag = uniqueTag();
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => {});

		const MyElement = component(function* () {
			yield function* () {
				throw new Error("fatal");
			};
		});

		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		expect(element.shadowRoot?.textContent).toContain("fatal");

		//further updates should be no-ops since the fatal error stopped the runner
		await element.update();
		await sleep();

		expect(element.shadowRoot?.textContent).toContain("fatal");
		consoleError.mockRestore();
		cleanup(element);
	});

	test("an update generator that yields a promise paints once it settles", async () => {
		const tag = uniqueTag();

		const MyElement = component(function* () {
			yield function* () {
				yield sleep();
				yield html`<p>awaited</p>`;
			};
		});

		customElements.define(tag, MyElement);
		const element = mount(tag);
		await sleep();

		expect(element.shadowRoot?.querySelector("p")?.textContent).toBe("awaited");
		cleanup(element);
	});

	test("an update generator waiting on a promise re-runs on update()", async () => {
		const tag = uniqueTag();
		let runs = 0;

		const MyElement = component(function* () {
			yield function* () {
				runs++;
				yield sleep();
				yield html`<p>pass ${runs}</p>`;
			};
		});

		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();
		expect(element.shadowRoot?.textContent).toContain("pass 1");

		await element.update();
		await sleep();

		expect(runs).toBe(2);
		expect(element.shadowRoot?.textContent).toContain("pass 2");
		cleanup(element);
	});

	test("a promise rejected in an update generator the body cannot catch is fatal and logs one console error", async () => {
		const tag = uniqueTag();
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => {});

		const MyElement = component(function* () {
			yield function* () {
				yield sleep().then(() => {
					throw new Error("run-rejected");
				});
			};
		});

		customElements.define(tag, MyElement);
		const element = mount(tag);
		await sleep();

		expect(element.shadowRoot?.textContent).toContain("run-rejected");
		expect(consoleError).toHaveBeenCalledTimes(1);
		consoleError.mockRestore();
		cleanup(element);
	});

	test("disconnecting before an update generator's promise settles paints nothing", async () => {
		const tag = uniqueTag();

		const MyElement = component(function* () {
			yield function* () {
				yield sleep(20);
				yield html`<p>too-late</p>`;
			};
		});

		customElements.define(tag, MyElement);
		const element = mount(tag);
		cleanup(element);
		await sleep(40);

		expect(element.shadowRoot?.textContent).not.toContain("too-late");
	});
});

describe("a superseded update generator run", () => {
	let tagId = 0;
	const uniqueTag = () => `test-superseded-${tagId++}-${Date.now()}`;

	const mount = (tag: string): HTMLElement => {
		const element = document.createElement(tag);
		document.body.appendChild(element);
		return element;
	};

	const cleanup = (element: HTMLElement) => {
		element.remove();
	};

	test("does not paint when it resolves after a newer call", async () => {
		const tag = uniqueTag();
		let calls = 0;

		const MyElement = component(function* () {
			yield function* () {
				const mine = ++calls;
				yield sleep(mine === 1 ? 40 : 0);
				yield html`<p>call ${mine}</p>`;
			};
		});

		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep(5);
		expect(element.shadowRoot?.textContent).toBe(""); //the first call is still pending

		element.update(); //supersedes it with a call that settles first
		await sleep(10);
		expect(element.shadowRoot?.textContent).toContain("call 2");

		await sleep(60); //the first call resolves late and must be dropped
		expect(element.shadowRoot?.textContent).toContain("call 2");
		expect(element.shadowRoot?.textContent).not.toContain("call 1");
		cleanup(element);
	});

	test("does not fail the component when it rejects after a newer call", async () => {
		const tag = uniqueTag();
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => {});
		let calls = 0;

		const MyElement = component(function* () {
			yield function* () {
				const mine = ++calls;
				if (mine === 1)
					yield sleep(40).then(() => {
						throw new Error("superseded-rejection");
					});
				yield html`<p>call ${mine}</p>`;
			};
		});

		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep(5);

		await element.update();
		expect(element.shadowRoot?.textContent).toContain("call 2");

		await sleep(60);
		//the stale rejection reaches a superseded run: not fatal, not displayed
		expect(element.shadowRoot?.textContent).toContain("call 2");
		expect(element.shadowRoot?.textContent).not.toContain(
			"superseded-rejection",
		);
		expect(consoleError).not.toHaveBeenCalled();
		consoleError.mockRestore();
		cleanup(element);
	});

	test("await update() still resolves when dropping it leaves nothing else to", async () => {
		const tag = uniqueTag();
		let calls = 0;

		const MyElement = component(function* () {
			yield function* () {
				const mine = ++calls;
				yield sleep(mine === 1 ? 40 : 0);
				yield html`<p>call ${mine}</p>`;
			};
		});

		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep(5); //the first call is still pending, the generator still parked at its yield

		await element.update(); //must resolve, and on the current content
		expect(element.shadowRoot?.textContent).toContain("call 2");
		cleanup(element);
	});

	test("a yielded promise is never treated as superseded", async () => {
		//the regression this guard invites: a refire bumps the generation while the generator is
		//parked at `yield promise`, and only that promise's resolution can resume it
		const tag = uniqueTag();
		let release: (value: string) => void = () => {};
		const gate = new Promise<string>((resolve) => {
			release = resolve;
		});
		let runs = 0;
		let resumed = false;

		const MyElement = component(function* () {
			yield function* () {
				yield html`<p>run ${++runs}</p>`;
			};
			const label = yield gate;
			resumed = true;
			yield function* () {
				yield html`<p>${label}</p>`;
			};
		});

		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();
		expect(runs).toBe(1);

		await element.update(); //re-runs the update generator while the body stays parked at its yielded promise
		expect(runs).toBe(2);
		expect(resumed).toBe(false);

		release("resumed");
		await sleep();
		expect(resumed).toBe(true);
		expect(element.shadowRoot?.textContent).toContain("resumed");
		cleanup(element);
	});
});

describe("yield* awaited(promise)", () => {
	let tagId = 0;
	const mountComponent = (generator: Parameters<typeof component>[0]) => {
		const tag = `test-awaited-${tagId++}-${Date.now()}`;
		customElements.define(tag, component(generator));
		const element = document.createElement(tag);
		document.body.appendChild(element);
		return element;
	};

	test("evaluates to the resolved value, in the body and in an update generator", async () => {
		const element = mountComponent(function* () {
			const greeting = yield* awaited(Promise.resolve("hello"));
			yield function* view() {
				const name = yield* awaited(sleep().then(() => "world"));
				yield html`<p>${greeting} ${name}</p>`;
			};
		});
		await sleep(10);
		expect(element.shadowRoot?.textContent).toBe("hello world");
		element.remove();
	});

	test("a rejection throws at the yield*, where a try/catch takes it", async () => {
		const element = mountComponent(function* () {
			try {
				yield* awaited(Promise.reject(new Error("offline")));
			} catch (error) {
				yield html`<p>${(error as Error).message}</p>`;
			}
		});
		await sleep(10);
		expect(element.shadowRoot?.textContent).toBe("offline");
		element.remove();
	});

	test("an update while it waits starts over, so the superseded value never lands", async () => {
		const pending: Array<PromiseWithResolvers<string>> = [];
		const element = mountComponent(function* () {
			yield function* view() {
				const waited = Promise.withResolvers<string>();
				pending.push(waited);
				const value = yield* awaited(waited.promise);
				yield html`<p>${value}</p>`;
			};
		}) as HTMLElement & { update(): Promise<void> };
		await sleep();
		const updated = element.update();
		await sleep();
		pending[0]!.resolve("superseded");
		pending[1]!.resolve("newest");
		await updated;
		await sleep();
		expect(element.shadowRoot?.textContent).toBe("newest");
		element.remove();
	});
});
