import { describe, expect, test } from "vitest";
import { html, component } from "../../src/index";

/*
The update() scheduling contract (ADR-0003): update() resolves once the DOM reflects this
call, coalescing with any concurrent update, across sync AND async renders. These tests pin
the contract the old "flip IDLE in finally" machine could not honor — most importantly that
`await update()` waits for an async render to actually land (no trailing `await sleep()`
crutch), and that mid-flight updates coalesce into a single deferred reflush instead of
restarting the in-flight render.

update() re-runs the CURRENT source, not the root. So a re-runnable source is what the root
yields: a render function (re-called) or a generator function (restarted). The root itself
runs once per connection.
*/

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

		// async work happens BEFORE the yield, so the DOM lands a macrotask later. the
		// old machine resolved update() at the synchronous dispatch boundary — this would
		// then observe the stale count without a trailing sleep
		const Counter = component(function* () {
			yield async function* () {
				const snapshot = count;
				await sleep(10);
				yield () => html`<span>${snapshot}</span>`;
			};
		});
		customElements.define(tag, Counter);

		const element = mount(tag) as InstanceType<typeof Counter>;
		await sleep(30);
		expect(element.shadowRoot?.querySelector("span")?.textContent).toBe("0");

		count = 5;
		await element.update();
		// NO sleep here: the contract guarantees the DOM already reflects the call
		expect(element.shadowRoot?.querySelector("span")?.textContent).toBe("5");

		element.remove();
	});

	test("a synchronous burst of update() calls coalesces into one re-render", async () => {
		const tag = uniqueTag();
		let renders = 0;
		let count = 0;

		const Counter = component(function* () {
			yield () => {
				renders++;
				return html`<span>${count}</span>`;
			};
		});
		customElements.define(tag, Counter);

		const element = mount(tag) as InstanceType<typeof Counter>;
		await sleep();
		expect(renders).toBe(1);

		count = 1;
		element.update();
		element.update();
		await element.update();

		// three calls, one re-render
		expect(renders).toBe(2);
		expect(element.shadowRoot?.querySelector("span")?.textContent).toBe("1");

		element.remove();
	});

	test("coalesced callers share one promise and resolve together", async () => {
		const tag = uniqueTag();
		let renders = 0;

		const Counter = component(function* () {
			yield () => {
				renders++;
				return html`<span>${renders}</span>`;
			};
		});
		customElements.define(tag, Counter);

		const element = mount(tag) as InstanceType<typeof Counter>;
		await sleep();
		expect(renders).toBe(1);

		await Promise.all([element.update(), element.update(), element.update()]);

		expect(renders).toBe(2);

		element.remove();
	});

	test("an update() arriving mid-flight reflushes exactly once with a fresh pull", async () => {
		const tag = uniqueTag();
		let renders = 0;
		let phase = "a";

		const Component = component(function* () {
			yield async function* () {
				renders++;
				const snapshot = phase;
				await sleep(10);
				yield () => html`<span>${snapshot}</span>`;
			};
		});
		customElements.define(tag, Component);

		const element = mount(tag) as InstanceType<typeof Component>;
		await sleep(30);
		expect(renders).toBe(1);
		expect(element.shadowRoot?.querySelector("span")?.textContent).toBe("a");

		phase = "b";
		const first = element.update();
		await sleep(); // let the restart begin and park at its await (RENDERING)
		phase = "c";
		const second = element.update(); // RENDERING -> sets dirty, does NOT restart

		await Promise.all([first, second]);

		// init(1) + restart(2) + one deferred reflush(3). NOT four — the mid-flight call
		// did not spin up its own render
		expect(renders).toBe(3);
		// the reflush pulled fresh state, so the final value is the latest ("c"), not "b"
		expect(element.shadowRoot?.querySelector("span")?.textContent).toBe("c");

		element.remove();
	});

	test("a conditional render-time update reflushes once, then stops (no runaway loop)", async () => {
		const tag = uniqueTag();
		let renders = 0;
		let triggerOnce = true;

		const Component = component(function* () {
			yield (host) => {
				renders++;
				if (triggerOnce) {
					triggerOnce = false;
					host.update();
				}
				return html`<span>${renders}</span>`;
			};
		});
		customElements.define(tag, Component);

		const element = mount(tag) as InstanceType<typeof Component>;
		await sleep();

		// initial render triggered exactly one reflush; the second render's condition is
		// false, so it terminates. dirty being a single bit bounds it to one reflush
		expect(renders).toBe(2);
		expect(element.shadowRoot?.querySelector("span")?.textContent).toBe("2");

		element.remove();
	});

	test("a render-time update() resolves after its ASYNC reflush painted, not before", async () => {
		// the outer's COMPLETED resolves the pending promise, so it has to defer to a pass queued
		// DURING this one. a synchronous reflush hides the difference (its microtask is already
		// ahead of the resolve in the queue); an async one does not — resolving at COMPLETED would
		// unblock the caller on the FIRST render's DOM, 20ms before the second one paints
		const tag = uniqueTag();
		let renders = 0;
		let promiseFromInsideTheRender: Promise<void> | null = null;

		const Component = component(function* () {
			yield (host) => {
				const mine = ++renders;
				if (mine === 1) {
					promiseFromInsideTheRender = host.update();
					return html`<span>${mine}</span>`;
				}
				return sleep(20).then(() => html`<span>${mine}</span>`);
			};
		});
		customElements.define(tag, Component);

		const element = mount(tag) as InstanceType<typeof Component>;
		await promiseFromInsideTheRender!;

		expect(renders).toBe(2);
		expect(element.shadowRoot?.querySelector("span")?.textContent).toBe("2");

		element.remove();
	});

	test("a render-time update() during a REFIRE resolves after its async reflush painted, not before", async () => {
		// the twin of the test above, on the other resolve site: a refire has no yield to resume,
		// so the render lane's PAINT resolves the promise. it has to defer to the pass queued
		// during it the same way COMPLETED does
		const tag = uniqueTag();
		let renders = 0;

		const Component = component(function* () {
			yield (host) => {
				const mine = ++renders;
				if (mine === 2) {
					host.update();
					return html`<span>${mine}</span>`;
				}
				if (mine === 3) return sleep(20).then(() => html`<span>${mine}</span>`);
				return html`<span>${mine}</span>`;
			};
		});
		customElements.define(tag, Component);

		const element = mount(tag) as InstanceType<typeof Component>;
		await sleep();

		await element.update();

		expect(renders).toBe(3);
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

		// must resolve (no createCurrent to re-run); awaiting must not hang
		await element.update();
		expect(element.shadowRoot?.querySelector("p")?.textContent).toBe("static");

		element.remove();
	});

	test("update() on a disconnected element resolves immediately", async () => {
		const tag = uniqueTag();
		let renders = 0;

		const Component = component(function* () {
			yield () => {
				renders++;
				return html`<span>x</span>`;
			};
		});
		customElements.define(tag, Component);

		const element = mount(tag) as InstanceType<typeof Component>;
		await sleep();
		expect(renders).toBe(1);

		element.remove();
		await element.update(); // not connected: resolves, no re-render
		expect(renders).toBe(1);
	});

	test("an async render that throws still resolves update() and surfaces the error", async () => {
		const tag = uniqueTag();
		let shouldThrow = false;

		const Component = component(function* () {
			yield async function* () {
				if (shouldThrow) {
					await sleep(10);
					throw new Error("async boom");
				}
				yield () => html`<span>ok</span>`;
			};
		});
		customElements.define(tag, Component);

		const element = mount(tag) as InstanceType<typeof Component>;
		await sleep();
		expect(element.shadowRoot?.querySelector("span")?.textContent).toBe("ok");

		shouldThrow = true;
		// the flush must resolve (not hang) even though the render rejected
		await element.update();
		expect(element.shadowRoot?.textContent).toContain("async boom");

		element.remove();
	});

	test("update() supersedes an in-flight render; the stale one cannot clobber it", async () => {
		const tag = uniqueTag();
		let value = "old";

		const Component = component(function* () {
			yield async function* () {
				const snapshot = value;
				await sleep(20);
				yield () => html`<span>${snapshot}</span>`;
			};
		});
		customElements.define(tag, Component);

		const element = mount(tag) as InstanceType<typeof Component>;
		await sleep(); // mount's render is parked at its 20ms await, not yet landed

		value = "new";
		await element.update(); // cancels the in-flight mount render, restarts with "new"
		expect(element.shadowRoot?.querySelector("span")?.textContent).toBe("new");

		// the superseded render's await now fires; its yield must be contained
		await sleep(40);
		expect(element.shadowRoot?.querySelector("span")?.textContent).toBe("new");

		element.remove();
	});
});
