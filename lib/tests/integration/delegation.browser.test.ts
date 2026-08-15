import { describe, expect, test, vi } from "vitest";
import { html, component } from "../../src/index";
import { BaseComponent, ComponentProps } from "../../src/types";

//a render function may return a generator function, so a component can swap which body runs — two
//setup and cleanup pairs sharing one shadow root — where a plainly yielded generator can only be
//the one installed at mount. The branch is re-chosen on every update() because the outer's refire
//record is the render function, not the generator it installed.

const sleep = (duration = 0) =>
	new Promise((resolve) => setTimeout(resolve, duration));

let tagId = 0;
const uniqueTag = (prefix: string) =>
	`test-delegation-${prefix}-${tagId++}-${Date.now()}`;

const mount = (
	definition: CustomElementConstructor,
	prefix: string,
): HTMLElement & { update(): Promise<void> } => {
	const tag = uniqueTag(prefix);
	customElements.define(tag, definition);
	const element = document.createElement(tag);
	document.body.appendChild(element);
	return element as HTMLElement & { update(): Promise<void> };
};

describe("a render function returning a generator function", () => {
	test("switching the branch swaps the body", async () => {
		let isEditing = false;
		const readOnlyBody = function* () {
			yield () => html`<p>read only</p>`;
		};
		const editorBody = function* () {
			yield () => html`<textarea>draft</textarea>`;
		};
		const element = mount(
			component(function* () {
				yield () => (isEditing ? editorBody : readOnlyBody);
			}),
			"switch",
		);
		await sleep();
		expect(element.shadowRoot?.querySelector("p")?.textContent).toBe(
			"read only",
		);

		isEditing = true;
		await element.update();
		expect(element.shadowRoot?.querySelector("p")).toBeNull();
		expect(element.shadowRoot?.querySelector("textarea")?.textContent).toBe(
			"draft",
		);

		isEditing = false;
		await element.update();
		expect(element.shadowRoot?.querySelector("textarea")).toBeNull();
		expect(element.shadowRoot?.querySelector("p")?.textContent).toBe(
			"read only",
		);
		element.remove();
	});

	test("the old branch's cleanup runs before the new branch's setup", async () => {
		const order: Array<string> = [];
		let isEditing = false;
		const readOnlyBody = function* () {
			order.push("read-only setup");
			yield () => html`<p>read only</p>`;
			return () => order.push("read-only cleanup");
		};
		const editorBody = function* () {
			order.push("editor setup");
			yield () => html`<textarea></textarea>`;
			return () => order.push("editor cleanup");
		};
		const element = mount(
			component(function* () {
				yield () => (isEditing ? editorBody : readOnlyBody);
			}),
			"cleanup-order",
		);
		await sleep();
		expect(order).toEqual(["read-only setup"]);

		isEditing = true;
		await element.update();
		expect(order).toEqual([
			"read-only setup",
			"read-only cleanup",
			"editor setup",
		]);

		element.remove();
		await sleep();
		expect(order).toEqual([
			"read-only setup",
			"read-only cleanup",
			"editor setup",
			"editor cleanup",
		]);
	});

	test("staying on the same branch still restarts it", async () => {
		//the documented teardown cost: the branch is re-installed, not refired, exactly as a
		//plainly yielded generator is re-run on every update()
		let setups = 0;
		let cleanups = 0;
		const onlyBody = function* () {
			setups++;
			yield () => html`<p>${setups}</p>`;
			return () => {
				cleanups++;
			};
		};
		const element = mount(
			component(function* () {
				yield () => onlyBody;
			}),
			"same-branch",
		);
		await sleep();
		expect(setups).toBe(1);
		expect(cleanups).toBe(0);

		await element.update();
		expect(setups).toBe(2);
		expect(cleanups).toBe(1);
		expect(element.shadowRoot?.querySelector("p")?.textContent).toBe("2");
		element.remove();
	});

	test("the outer generator is never stepped again by a branch switch", async () => {
		let timesResumedPastTheYield = 0;
		let isEditing = false;
		const element = mount(
			component(function* () {
				yield () =>
					isEditing
						? function* () {
								yield () => html`<p>editor</p>`;
							}
						: function* () {
								yield () => html`<p>reader</p>`;
							};
				timesResumedPastTheYield++;
			}),
			"outer-once",
		);
		await sleep();
		expect(timesResumedPastTheYield).toBe(1);

		isEditing = true;
		await element.update();
		await element.update();
		expect(timesResumedPastTheYield).toBe(1);
		expect(element.shadowRoot?.querySelector("p")?.textContent).toBe("editor");
		element.remove();
	});

	//the complement of the test above: the outer is stepped by a refire's install exactly when it is
	//still parked at the yield, which a pending first render leaves it doing
	test("a refire that installs while the first render is still pending resumes the outer", async () => {
		let renderCallCount = 0;
		let receivedFromTheYield: unknown;
		const element = mount(
			component(function* ({ host }: ComponentProps) {
				receivedFromTheYield = yield () => {
					renderCallCount++;
					if (renderCallCount === 1)
						return sleep(80).then(() => html`<p>slow</p>`);
					return function* () {
						yield html`<p>branch</p>`;
					};
				};
				expect(receivedFromTheYield).toBe(host);
			}),
			"refire-install-while-pending",
		);
		await sleep();
		expect(renderCallCount).toBe(1);
		expect(element.shadowRoot?.textContent).toBe("");

		await element.update();
		expect(renderCallCount).toBe(2);
		expect(element.shadowRoot?.querySelector("p")?.textContent).toBe("branch");
		expect(receivedFromTheYield).toBe(element);
		element.remove();
	});

	test("a branch returning a generator from an inner task is rejected", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const element = mount(
			component(function* () {
				yield () =>
					function* () {
						//one level only: the inner may not introduce another generator, by yield
						//or by return
						yield () =>
							function* () {
								yield () => html`<p>too deep</p>`;
							};
					};
			}),
			"too-deep",
		);
		await sleep();

		expect(element.shadowRoot?.textContent).toContain("grundlage");
		expect(warn).toHaveBeenCalledTimes(1);
		element.remove();
		vi.restoreAllMocks();
	});

	test("a branch's error is thrown into the outer at its yield", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		let caught: unknown;
		const element = mount(
			component(function* () {
				try {
					yield () =>
						function* () {
							yield () => {
								throw new Error("branch-boom");
							};
						};
				} catch (error) {
					caught = error;
				}
			}),
			"branch-throw",
		);
		await sleep();

		expect((caught as Error)?.message).toBe("branch-boom");
		expect(warn).not.toHaveBeenCalled(); //the outer swallowed it: never fatal
		element.remove();
		vi.restoreAllMocks();
	});

	test("an async branch resolves before the outer completes", async () => {
		const element = mount(
			component(function* () {
				yield () =>
					async function* () {
						const label = await Promise.resolve("loaded");
						yield () => html`<p>${label}</p>`;
					};
			}),
			"async-branch",
		);
		await sleep();

		expect(element.shadowRoot?.querySelector("p")?.textContent).toBe("loaded");
		element.remove();
	});

	test("an async render function may resolve to a generator function", async () => {
		const element = mount(
			component(function* () {
				yield async () => {
					await Promise.resolve();
					return function* () {
						yield () => html`<p>late branch</p>`;
					};
				};
			}),
			"async-to-branch",
		);
		await sleep();

		expect(element.shadowRoot?.querySelector("p")?.textContent).toBe(
			"late branch",
		);
		element.remove();
	});

	test("the branch receives the host on every switch", async () => {
		const hosts: Array<BaseComponent> = [];
		let isEditing = false;
		const body = function* ({ host }: ComponentProps) {
			hosts.push(host);
			yield () => html`<p>x</p>`;
		};
		const other = function* ({ host }: ComponentProps) {
			hosts.push(host);
			yield () => html`<p>y</p>`;
		};
		const element = mount(
			component(function* () {
				yield () => (isEditing ? other : body);
			}),
			"host-arg",
		);
		await sleep();

		isEditing = true;
		await element.update();
		expect(hosts).toHaveLength(2);
		expect(hosts[0]).toBe(element);
		expect(hosts[1]).toBe(element);
		element.remove();
	});

	test("two hosts using the same delegating component stay independent", async () => {
		const editorBody = function* () {
			yield () => html`<p>editor</p>`;
		};
		const readerBody = function* () {
			yield () => html`<p>reader</p>`;
		};
		const tag = uniqueTag("independent");
		customElements.define(
			tag,
			component(
				function* ({ host }) {
					yield () => (host.hasAttribute("editing") ? editorBody : readerBody);
				},
				{ props: { editing: Boolean } },
			),
		);
		const first = document.createElement(tag) as HTMLElement & {
			update(): Promise<void>;
		};
		const second = document.createElement(tag) as HTMLElement & {
			update(): Promise<void>;
		};
		document.body.append(first, second);
		await sleep();
		expect(first.shadowRoot?.querySelector("p")?.textContent).toBe("reader");
		expect(second.shadowRoot?.querySelector("p")?.textContent).toBe("reader");

		first.setAttribute("editing", "");
		await sleep();
		expect(first.shadowRoot?.querySelector("p")?.textContent).toBe("editor");
		expect(second.shadowRoot?.querySelector("p")?.textContent).toBe("reader");
		first.remove();
		second.remove();
	});

	test("a branch of `null` clears the body, and switching back reinstalls it", async () => {
		//the return is content, so the no-body branch is the same `null` a content hole takes
		let hasBody = true;
		let setups = 0;
		let cleanups = 0;
		const body = function* () {
			setups++;
			yield () => html`<p>body</p>`;
			return () => {
				cleanups++;
			};
		};
		const element = mount(
			component(function* () {
				yield () => (hasBody ? body : null);
			}),
			"null-branch",
		);
		await sleep();
		expect(element.shadowRoot?.querySelector("p")?.textContent).toBe("body");

		hasBody = false;
		await element.update();
		expect(element.shadowRoot?.querySelector("p")).toBeNull();
		//painting `null` is the outer taking the content back, so the branch is torn down then
		//and there — not deferred to the next install or to disconnect
		expect(cleanups).toBe(1);

		hasBody = true;
		await element.update();
		expect(element.shadowRoot?.querySelector("p")?.textContent).toBe("body");
		expect(setups).toBe(2);
		expect(cleanups).toBe(1);
		element.remove();
	});

	test("a branch that forgot its `*` is a plain function, and fails", async () => {
		vi.spyOn(console, "warn").mockImplementation(() => {});
		const element = mount(
			component(function* () {
				yield () => () => html`<p>missing the star</p>`;
			}),
			"missing-star",
		);
		await sleep();

		expect(element.shadowRoot?.querySelector("p")).toBeNull();
		expect(element.shadowRoot?.textContent).toContain("grundlage");
		element.remove();
		vi.restoreAllMocks();
	});
});
