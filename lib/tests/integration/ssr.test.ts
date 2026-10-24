//must come first — parser/html.ts runs `document.createElement` at module load
import "./ssr-setup";

import { afterEach, describe, expect, test, vi } from "vitest";
import { html, component, prop } from "../../src/index";
import { ComponentConstructor } from "../../src/types";

const flushMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0));

let nextTagId = 0;
const uniqueTag = () => `ssr-node-${nextTagId++}-${Date.now()}`;

const mount = async (tag: string, ComponentClass: ComponentConstructor) => {
	customElements.define(tag, ComponentClass);
	const element = document.createElement(tag) as InstanceType<
		typeof ComponentClass
	>;
	document.body.appendChild(element);
	//let synchronous generators reach their first yield
	await flushMicrotasks();
	return element;
};

const trackedElements: Array<HTMLElement> = [];
afterEach(() => {
	while (trackedElements.length) trackedElements.pop()!.remove();
});

const track = <T extends HTMLElement>(element: T): T => {
	trackedElements.push(element);
	return element;
};

describe("SSR: server stops at the first paint", () => {
	test("the server-environment check fires in this node test process", () => {
		expect(typeof window).toBe("undefined");
	});

	test("synchronous generator with multiple yields paints only the first one", async () => {
		const tag = uniqueTag();
		let yieldCount = 0;

		const Component = component(function* () {
			yieldCount++;
			yield function* () {
				yield html`<p>first</p>`;
			};
			yieldCount++;
			yield function* () {
				yield html`<p>second</p>`;
			};
			yieldCount++;
			yield function* () {
				yield html`<p>third</p>`;
			};
		});

		const element = track(await mount(tag, Component));

		expect(yieldCount).toBe(1);
		const paragraphs = element.shadowRoot!.querySelectorAll("p");
		expect(paragraphs.length).toBe(1);
		expect(paragraphs[0].textContent).toBe("first");
	});

	test("statements after the first yield do not execute on the server", async () => {
		const tag = uniqueTag();
		let postYieldRan = false;

		const Component = component(function* () {
			yield function* () {
				yield html`<p>only</p>`;
			};
			postYieldRan = true;
		});

		track(await mount(tag, Component));

		expect(postYieldRan).toBe(false);
	});

	test("outer generator yielding a static template paints and stops", async () => {
		//a static template installs through a different path than an update generator, so the cancel is
		//pinned separately here
		const tag = uniqueTag();
		let postYieldRan = false;

		const Component = component(function* () {
			yield html`<p>static</p>`;
			postYieldRan = true;
			yield html`<p>after</p>`;
		});

		const element = track(await mount(tag, Component));

		expect(element.shadowRoot!.textContent).toContain("static");
		expect(element.shadowRoot!.textContent).not.toContain("after");
		expect(postYieldRan).toBe(false);
	});

	test("an update generator yield runs exactly once", async () => {
		const tag = uniqueTag();
		let runCount = 0;
		let postYieldRan = false;

		const Component = component(function* () {
			yield function* () {
				runCount++;
				yield html`<p>run ${runCount}</p>`;
			};
			postYieldRan = true;
		});

		const element = track(await mount(tag, Component));

		expect(runCount).toBe(1);
		expect(postYieldRan).toBe(false);
		expect(element.shadowRoot!.textContent).toContain("run 1");
	});

	test("nested generator function: SSR descends into the inner and stops at its first yield", async () => {
		const tag = uniqueTag();
		let innerYields = 0;

		const Component = component(function* () {
			yield function* inner() {
				innerYields++;
				yield html`<p>inner-first</p>`;
				innerYields++;
				yield html`<p>inner-second</p>`;
			};
		});

		const element = track(await mount(tag, Component));

		expect(innerYields).toBe(1);
		expect(element.shadowRoot!.textContent).toContain("inner-first");
		expect(element.shadowRoot!.textContent).not.toContain("inner-second");
	});

	test("an async inner still wins the markup over the parent's own later yield", async () => {
		//the second enforcement point of "the first paint wins": stopping at the first paint is
		//not enough, the parent must not be resumed past an install whose branch has not painted yet
		const tag = uniqueTag();

		const Component = component(function* () {
			yield function* inner() {
				yield Promise.resolve();
				yield html`<p>inner-async</p>`;
			};
			yield html`<p>parent-took-over</p>`;
		});

		const element = track(await mount(tag, Component));
		await flushMicrotasks();

		expect(element.shadowRoot!.textContent).toContain("inner-async");
		expect(element.shadowRoot!.textContent).not.toContain("parent-took-over");
	});

	test("async work before the first yield resolves, then the first yield paints", async () => {
		//the first template depends on the await — SSR can't skip it
		const tag = uniqueTag();
		let postYieldRan = false;

		const Component = component(function* () {
			const data = yield Promise.resolve("from-server");
			yield function* () {
				yield html`<p>${data as string}</p>`;
			};
			postYieldRan = true;
		});

		const element = track(await mount(tag, Component));
		await flushMicrotasks();

		expect(element.shadowRoot!.textContent).toContain("from-server");
		expect(postYieldRan).toBe(false);
	});

	test("attribute changes do not trigger update() on the server (no MutationObserver allocated)", async () => {
		const tag = uniqueTag();
		let runCount = 0;

		const Component = component(function* ({ host }) {
			runCount++;
			yield function* () {
				yield html`<span>${host.getAttribute("data-label") ?? "none"}</span>`;
			};
		});

		const element = track(await mount(tag, Component));
		expect(runCount).toBe(1);

		element.setAttribute("data-label", "updated");
		await flushMicrotasks();

		//no observer on the server → setAttribute can't trigger update()
		expect(runCount).toBe(1);
		expect(element.shadowRoot!.textContent).toContain("none");
	});

	test("calling update() manually after SSR has stopped is a no-op", async () => {
		const tag = uniqueTag();
		let runCount = 0;

		const Component = component(function* () {
			runCount++;
			yield function* () {
				yield html`<p>${runCount}</p>`;
			};
		});

		const element = track(await mount(tag, Component));
		const initialCount = runCount;

		await (element as unknown as { update: () => Promise<void> }).update();
		await flushMicrotasks();

		expect(runCount).toBe(initialCount);
		expect(element.shadowRoot!.textContent).toContain(String(initialCount));
	});

	test("update() called from inside the first update generator run does not re-run it (infinite-loop guard)", async () => {
		//without the server guard in update() the update generator re-runs, which schedules another
		//update, forever. Runs are counted, since generator iterations are bounded by the cancel
		const tag = uniqueTag();
		let runCount = 0;

		const Component = component(function* ({ host }) {
			yield function* () {
				runCount++;
				queueMicrotask(() => host.update());
				yield html`<p>only</p>`;
			};
		});

		track(await mount(tag, Component));
		//extra flushes give a broken guard room to loop before the assertion, where it hangs to the
		//vitest timeout instead
		await flushMicrotasks();
		await flushMicrotasks();

		expect(runCount).toBe(1);
	});

	test("setProp on the server applies the attribute but does not trigger an update", async () => {
		//the two halves split across the boundary: the attribute binding still writes, which
		//serialization needs, while update() is gated
		const tag = uniqueTag();
		let runCount = 0;

		const Component = component(function* ({ host }) {
			runCount++;
			yield function* () {
				yield html`<span
					>${host.getAttribute("data-value") ?? "missing"}</span
				>`;
			};
		});

		const element = track(await mount(tag, Component));
		expect(runCount).toBe(1);

		(
			element as unknown as {
				setProp: (name: string, value: unknown) => void;
			}
		).setProp("data-value", "after");
		await flushMicrotasks();

		expect(element.getAttribute("data-value")).toBe("after");
		expect(runCount).toBe(1);
		//shadow still reflects the first-yield evaluation — update never re-ran
		expect(element.shadowRoot!.textContent).toContain("missing");
	});

	test("disconnect after SSR does not throw despite the never-allocated MutationObserver", async () => {
		//a throw in disconnectedCallback breaks serialization-batch teardown, which the optional
		//chaining there is the net for
		const tag = uniqueTag();

		const Component = component(function* () {
			yield function* () {
				yield html`<p>hi</p>`;
			};
		});

		const element = await mount(tag, Component);
		//no track(): disconnect is driven by hand here
		expect(() => element.remove()).not.toThrow();
		//disconnectedCallback awaits one microtask before teardown
		await flushMicrotasks();
		await flushMicrotasks();
	});

	test("rejecting Promise before the first paint surfaces the error and stops the generator", async () => {
		//the error routes to the shared fatal display, which writes into the shadow root
		//the fatal display logs, so the console error is silenced here
		const tag = uniqueTag();
		let postYieldRan = false;
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => {});

		const Component = component(function* () {
			yield Promise.reject(new Error("boom"));
			yield function* () {
				yield html`<p>never</p>`;
			};
			postYieldRan = true;
		});

		const element = track(await mount(tag, Component));
		await flushMicrotasks();
		await flushMicrotasks();

		expect(element.shadowRoot!.textContent).toContain("boom");
		expect(postYieldRan).toBe(false);
		expect(consoleError).toHaveBeenCalled();
		consoleError.mockRestore();
	});

	test("user finally block runs on server (cancelGenerator calls .return())", async () => {
		//server-side cleanup is observed by the generator even though the returned cleanup function is
		//discarded
		const tag = uniqueTag();
		let finallyRan = false;
		let cleanupReturnInvoked = false;

		const Component = component(function* () {
			try {
				yield function* () {
					yield html`<p>guarded</p>`;
				};
			} finally {
				finallyRan = true;
				//a dormant probe: capturing this on the server would land the side effect at teardown
				return () => {
					cleanupReturnInvoked = true;
				};
			}
		});

		track(await mount(tag, Component));

		expect(finallyRan).toBe(true);
		//cancelGenerator discards the .return() result — intentional on the server
		expect(cleanupReturnInvoked).toBe(false);
	});

	test("the body's finally runs on the server when its update generator queued an update and threw", async () => {
		//the catch drops the update generator, and the update it queued goes with it, so nothing defers
		//the stop past the fallback's paint
		const tag = uniqueTag();
		let finallyRan = false;

		const Component = component(function* ({ host }) {
			try {
				try {
					yield function* () {
						host.update();
						throw new Error("update generator failed");
					};
				} catch {
					yield html`<p>fallback</p>`;
				}
			} finally {
				finallyRan = true;
			}
		});

		const element = track(await mount(tag, Component));
		await flushMicrotasks();

		expect(element.shadowRoot!.textContent).toContain("fallback");
		expect(finallyRan).toBe(true);
	});

	test("server-side try/catch recovers by yielding a fallback (silent, no warn)", async () => {
		//SSR now bubbles errors like CSR: a recoverable inner error lets the outer catch yield a
		//fallback, so the server emits the same content the client would: no hydration mismatch and no
		//warning
		const tag = uniqueTag();
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

		const Component = component(function* () {
			try {
				yield function* () {
					{
						throw new Error("inner-failed");
					}
				};
			} catch {
				yield function* () {
					yield html`<p>fallback</p>`;
				};
			}
		});

		const element = track(await mount(tag, Component));

		expect(element.shadowRoot?.querySelector("p")?.textContent).toBe(
			"fallback",
		);
		expect(warnSpy).not.toHaveBeenCalled();
		warnSpy.mockRestore();
	});

	test("two components on the same page each stop at their own first yield", async () => {
		const firstTag = uniqueTag();
		const secondTag = uniqueTag();
		let firstYields = 0;
		let secondYields = 0;

		const First = component(function* () {
			firstYields++;
			yield function* () {
				yield html`<p>first-a</p>`;
			};
			firstYields++;
			yield function* () {
				yield html`<p>first-b</p>`;
			};
		});

		const Second = component(function* () {
			secondYields++;
			yield function* () {
				yield html`<p>second-a</p>`;
			};
			secondYields++;
			yield function* () {
				yield html`<p>second-b</p>`;
			};
		});

		const firstElement = track(await mount(firstTag, First));
		const secondElement = track(await mount(secondTag, Second));

		expect(firstYields).toBe(1);
		expect(secondYields).toBe(1);
		expect(firstElement.shadowRoot!.textContent).toContain("first-a");
		expect(secondElement.shadowRoot!.textContent).toContain("second-a");
	});

	test("getHTML produces declarative shadow DOM with the first-yield content", async () => {
		//mirrors the call path the plugin uses in production builds
		const tag = uniqueTag();

		const Component = component(function* () {
			yield function* () {
				yield html`<p>serialized-first</p>`;
			};
			yield function* () {
				yield html`<p>serialized-second</p>`;
			};
		});

		track(await mount(tag, Component));
		const serialized = (
			document.body as unknown as {
				getHTML(options: { serializableShadowRoots: boolean }): string;
			}
		).getHTML({ serializableShadowRoots: true });

		expect(serialized).toContain("template");
		expect(serialized).toContain("shadowrootmode");
		expect(serialized).toContain("serialized-first");
		expect(serialized).not.toContain("serialized-second");
	});

	test("host (root template) attributes from the first yield reach the host element", async () => {
		//root-template attributes live on the host rather than the shadow root, so the server has to
		//apply them before getHTML serializes
		const tag = uniqueTag();

		const Component = component(function* () {
			yield function* () {
				yield html`<template class="${"server-class"}" data-x="${"server-x"}">
					<p>body</p>
				</template>`;
			};
		});

		const element = track(await mount(tag, Component));
		expect(element.getAttribute("class")).toBe("server-class");
		expect(element.getAttribute("data-x")).toBe("server-x");
	});

	test("a host binding writing the component's own prop reaches the server markup it paints", async () => {
		const tag = uniqueTag();
		let runCount = 0;

		const Component = component(
			function* () {
				yield function* ({ theme }) {
					runCount++;
					yield html`<template theme=${"dark"}><p>${theme}</p></template>`;
				};
			},
			{ props: { theme: prop.attribute(String, "light") } },
		);

		const element = track(await mount(tag, Component));
		await flushMicrotasks();

		expect(element.getAttribute("theme")).toBe("dark");
		expect(element.shadowRoot!.querySelector("p")!.textContent).toBe("dark");
		expect(runCount).toBe(2);
	});

	test("a synchronous update() during the server render re-runs the update generator before it ends", async () => {
		const tag = uniqueTag();
		let runCount = 0;

		const Component = component(function* ({ host }) {
			yield function* () {
				runCount++;
				if (runCount === 1) host.update();
				yield html`<p>call ${runCount}</p>`;
			};
		});

		const element = track(await mount(tag, Component));
		await flushMicrotasks();

		expect(runCount).toBe(2);
		expect(element.shadowRoot!.querySelector("p")!.textContent).toBe("call 2");
	});

	test("expressions in the first-yield template evaluate against the closure at yield time", async () => {
		//painting after closing the generator would re-bind the expression to the post-mutation value
		const tag = uniqueTag();
		let value = "before";

		const Component = component(function* () {
			yield function* () {
				yield html`<p>${value}</p>`;
			};
			value = "after";
			yield function* () {
				yield html`<p>${value}</p>`;
			};
		});

		const element = track(await mount(tag, Component));
		expect(element.shadowRoot!.textContent).toContain("before");
		expect(element.shadowRoot!.textContent).not.toContain("after");
	});

	test("an update generator that waits on a promise before its paint resolves, paints once, and stops", async () => {
		const tag = uniqueTag();
		let postYieldRan = false;

		const Component = component(function* () {
			yield function* () {
				yield Promise.resolve();
				yield html`<p>awaited-server</p>`;
			};
			postYieldRan = true;
		});

		const element = track(await mount(tag, Component));
		await flushMicrotasks();

		expect(element.shadowRoot!.textContent).toContain("awaited-server");
		expect(postYieldRan).toBe(false);
	});

	test("an update generator painting an uncommittable value fails", async () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		const tag = uniqueTag();

		const Component = component(function* () {
			yield function* () {
				yield html`${new Map()}`;
			};
		});

		const element = track(await mount(tag, Component));

		expect(element.shadowRoot!.textContent).toContain("grundlage");
		warnSpy.mockRestore();
	});
});

describe("SSR: an attribute write after the server paint schedules nothing", () => {
	test("attributeChangedCallback fires on the server and reaches no update", async () => {
		//isServer() is `typeof window === "undefined"`, so there is a real DOM here and aCC does
		//fire — what makes dropping the old `!wasMountedOnServer` observer guard safe is that
		//stopRunner() runs immediately after the server's first paint
		const tag = uniqueTag();
		let runCount = 0;

		const Component = component(
			function* ({ host }) {
				yield function* () {
					runCount++;
					yield html`<p>${host.getAttribute("label") ?? "none"}</p>`;
				};
			},
			{ props: { label: prop.optional(prop.attribute(String)) } },
		);

		const element = track(await mount(tag, Component));
		expect(runCount).toBe(1);

		element.setAttribute("label", "after");
		await flushMicrotasks();

		expect(runCount).toBe(1);
		expect(element.shadowRoot!.textContent).toContain("none");
	});
});
