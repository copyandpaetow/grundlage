import { describe, expect, test } from "vitest";
import { html, component } from "../../src/index";

//update() resolves once the DOM reflects this call, coalescing with any concurrent update, whether
//the run waits on a promise or not. The two halves that matter: `await update()` waits for a
//waiting run to actually paint, with no trailing `await sleep()` crutch, and an update that
//arrives while a run waits tears that run down and starts a fresh one.
//
//update() re-runs the update generator the body yielded last, never the body, which runs once
//per connection.

const sleep = (duration = 0) =>
	new Promise((resolve) => setTimeout(resolve, duration));

let tagId = 0;
const uniqueTag = () => `test-update-${tagId++}-${Date.now()}`;

const mount = (tag: string): HTMLElement => {
	const element = document.createElement(tag);
	document.body.appendChild(element);
	return element;
};

describe("update() scheduling contract", () => {
	test("await update() resolves only after the async DOM has landed", async () => {
		const tag = uniqueTag();
		let count = 0;

		//async work happens before the yield, so the DOM lands a macrotask later. the
		//old machine resolved update() at the synchronous dispatch boundary — this would
		//then observe the stale count without a trailing sleep
		const Counter = component(function* () {
			yield function* () {
				const snapshot = count;
				yield sleep(10);
				yield html`<span>${snapshot}</span>`;
			};
		});
		customElements.define(tag, Counter);

		const element = mount(tag) as InstanceType<typeof Counter>;
		await sleep(30);
		expect(element.shadowRoot?.querySelector("span")?.textContent).toBe("0");

		count = 5;
		await element.update();
		//no sleep here: the contract guarantees the DOM already reflects the call
		expect(element.shadowRoot?.querySelector("span")?.textContent).toBe("5");

		element.remove();
	});

	test("a synchronous burst of update() calls coalesces into one update", async () => {
		const tag = uniqueTag();
		let runs = 0;
		let count = 0;

		const Counter = component(function* () {
			yield function* () {
				runs++;
				yield html`<span>${count}</span>`;
			};
		});
		customElements.define(tag, Counter);

		const element = mount(tag) as InstanceType<typeof Counter>;
		await sleep();
		expect(runs).toBe(1);

		count = 1;
		element.update();
		element.update();
		await element.update();

		//the mount run plus one for the three coalesced calls
		expect(runs).toBe(2);
		expect(element.shadowRoot?.querySelector("span")?.textContent).toBe("1");

		element.remove();
	});

	test("coalesced callers share one promise and resolve together", async () => {
		const tag = uniqueTag();
		let runs = 0;

		const Counter = component(function* () {
			yield function* () {
				runs++;
				yield html`<span>${runs}</span>`;
			};
		});
		customElements.define(tag, Counter);

		const element = mount(tag) as InstanceType<typeof Counter>;
		await sleep();
		expect(runs).toBe(1);

		await Promise.all([element.update(), element.update(), element.update()]);

		expect(runs).toBe(2);

		element.remove();
	});

	test("an update() arriving mid-flight reflushes exactly once with a fresh pull", async () => {
		const tag = uniqueTag();
		let runs = 0;
		let phase = "a";

		const Component = component(function* () {
			yield function* () {
				runs++;
				const snapshot = phase;
				yield sleep(10);
				yield html`<span>${snapshot}</span>`;
			};
		});
		customElements.define(tag, Component);

		const element = mount(tag) as InstanceType<typeof Component>;
		await sleep(30);
		expect(runs).toBe(1);
		expect(element.shadowRoot?.querySelector("span")?.textContent).toBe("a");

		phase = "b";
		const first = element.update();
		await sleep(); // let the restart begin and park at its yield
		phase = "c";
		const second = element.update(); // mid-flight: tears the waiting run down and starts a fresh one

		await Promise.all([first, second]);

		//the mount (1) plus one run per update() call (2, 3): the mid-flight call tore the waiting
		//run down instead of waiting for it
		expect(runs).toBe(3);
		//the reflush pulled fresh state, so the final value is the latest ("c"), not "b"
		expect(element.shadowRoot?.querySelector("span")?.textContent).toBe("c");

		element.remove();
	});

	test("a conditional update() during a run re-runs once, then stops (no runaway loop)", async () => {
		const tag = uniqueTag();
		let runs = 0;
		let triggerOnce = true;

		//the host is closed over rather than taken as a parameter: a yield carries no contextual
		//type, so an update generator's own parameter list is untyped
		const Component = component(function* ({ host }) {
			yield function* () {
				runs++;
				if (triggerOnce) {
					triggerOnce = false;
					host.update();
				}
				yield html`<span>${runs}</span>`;
			};
		});
		customElements.define(tag, Component);

		const element = mount(tag) as InstanceType<typeof Component>;
		await sleep();

		//the first run triggered exactly one more; the second run's condition is false, so it
		//terminates. A runner is queued at most once, which bounds it to one more run
		expect(runs).toBe(2);
		expect(element.shadowRoot?.querySelector("span")?.textContent).toBe("2");

		element.remove();
	});

	test("an update() during a run resolves after its waiting re-run painted, not before", async () => {
		//the outer's COMPLETED resolves the pending promise, so it has to defer to a pass queued
		//during this one. a synchronous reflush hides the difference (its microtask is already
		//ahead of the resolve in the queue); an async one does not — resolving at COMPLETED would
		//unblock the caller on the first run's DOM, 20ms before the second one paints
		const tag = uniqueTag();
		let runs = 0;
		let promiseFromInsideTheRun: Promise<void> | null = null;

		const Component = component(function* ({ host }) {
			yield function* () {
				const mine = ++runs;
				if (mine === 1) {
					promiseFromInsideTheRun = host.update();
					yield html`<span>${mine}</span>`;
					return;
				}
				yield sleep(20);
				yield html`<span>${mine}</span>`;
			};
		});
		customElements.define(tag, Component);

		const element = mount(tag) as InstanceType<typeof Component>;
		await promiseFromInsideTheRun!;

		expect(runs).toBe(2);
		expect(element.shadowRoot?.querySelector("span")?.textContent).toBe("2");

		element.remove();
	});

	test("an update() during an update resolves after its waiting re-run painted, not before", async () => {
		//the twin of the test above, on the other resolve site: a refire has no yield to resume,
		//so the end of that run resolves the promise. it has to defer to the pass queued
		//during it the same way COMPLETED does
		const tag = uniqueTag();
		let runs = 0;

		const Component = component(function* ({ host }) {
			yield function* () {
				const mine = ++runs;
				if (mine === 2) {
					host.update();
					yield html`<span>${mine}</span>`;
					return;
				}
				if (mine === 3) {
					yield sleep(20);
					yield html`<span>${mine}</span>`;
					return;
				}
				yield html`<span>${mine}</span>`;
			};
		});
		customElements.define(tag, Component);

		const element = mount(tag) as InstanceType<typeof Component>;
		await sleep();

		await element.update();

		expect(runs).toBe(3);
		expect(element.shadowRoot?.querySelector("span")?.textContent).toBe("3");

		element.remove();
	});

	test("update() on a static template current resolves immediately as a no-op", async () => {
		const tag = uniqueTag();

		const Static = component(function* () {
			yield html`<p>static</p>`;
		});
		customElements.define(tag, Static);

		const element = mount(tag) as InstanceType<typeof Static>;
		await sleep();
		expect(element.shadowRoot?.querySelector("p")?.textContent).toBe("static");

		//must resolve (no createCurrent to re-run); awaiting must not hang
		await element.update();
		expect(element.shadowRoot?.querySelector("p")?.textContent).toBe("static");

		element.remove();
	});

	test("update() on a disconnected element resolves immediately", async () => {
		const tag = uniqueTag();
		let runs = 0;

		const Component = component(function* () {
			yield function* () {
				runs++;
				yield html`<span>x</span>`;
			};
		});
		customElements.define(tag, Component);

		const element = mount(tag) as InstanceType<typeof Component>;
		await sleep();
		expect(runs).toBe(1);

		element.remove();
		await element.update(); // not connected: resolves, no run
		expect(runs).toBe(1);
	});

	test("an update generator that throws after a wait still resolves update() and surfaces the error", async () => {
		const tag = uniqueTag();
		let shouldThrow = false;

		const Component = component(function* () {
			yield function* () {
				if (shouldThrow) {
					yield sleep(10);
					throw new Error("async boom");
				}
				yield html`<span>ok</span>`;
			};
		});
		customElements.define(tag, Component);

		const element = mount(tag) as InstanceType<typeof Component>;
		await sleep();
		expect(element.shadowRoot?.querySelector("span")?.textContent).toBe("ok");

		shouldThrow = true;
		//the flush must resolve (not hang) even though the run threw
		await element.update();
		expect(element.shadowRoot?.textContent).toContain("async boom");

		element.remove();
	});

	test("an update() queued by an update generator that throws settles at the body's catch, while the body still waits", async () => {
		const tag = uniqueTag();
		const fallbackText = Promise.withResolvers<string>();
		const queuedUpdates: Array<Promise<void>> = [];

		const Component = component(function* ({ host }) {
			try {
				yield function* () {
					queuedUpdates.push(host.update());
					throw new Error("view failed");
				};
			} catch {
				const text = yield fallbackText.promise;
				yield html`<p>${text}</p>`;
			}
		});
		customElements.define(tag, Component);

		const element = mount(tag);
		let hasUpdateSettled = false;
		void queuedUpdates[0].then(() => {
			hasUpdateSettled = true;
		});
		await sleep();
		expect(hasUpdateSettled).toBe(true);

		fallbackText.resolve("fallback");
		await sleep();
		expect(element.shadowRoot?.querySelector("p")?.textContent).toBe(
			"fallback",
		);

		element.remove();
	});

	test("update() supersedes a waiting run; the stale one cannot clobber it", async () => {
		const tag = uniqueTag();
		let value = "old";

		const Component = component(function* () {
			yield function* () {
				const snapshot = value;
				yield sleep(20);
				yield html`<span>${snapshot}</span>`;
			};
		});
		customElements.define(tag, Component);

		const element = mount(tag) as InstanceType<typeof Component>;
		await sleep(); // the mount's run is parked at its 20ms yield, not yet painted

		value = "new";
		await element.update(); // tears the waiting mount run down, restarts with "new"
		expect(element.shadowRoot?.querySelector("span")?.textContent).toBe("new");

		//the superseded run's promise now settles; its yield must be contained
		await sleep(40);
		expect(element.shadowRoot?.querySelector("span")?.textContent).toBe("new");

		element.remove();
	});
});
