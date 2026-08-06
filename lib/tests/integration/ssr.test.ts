//must come first — parser/html.ts runs `document.createElement` at module load
import "./ssr-setup";

import { afterEach, describe, expect, test, vi } from "vitest";
import { html, component } from "../../src/index";

const flushMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0));

let nextTagId = 0;
const uniqueTag = () => `ssr-node-${nextTagId++}-${Date.now()}`;

const mount = async (
	tag: string,
	ComponentClass: ReturnType<typeof render>,
) => {
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

describe("SSR: server stops at first renderable yield", () => {
	test("the server-environment check fires in this node test process", () => {
		expect(typeof window).toBe("undefined");
	});

	test("synchronous generator with multiple yields renders only the first one", async () => {
		const tag = uniqueTag();
		let yieldCount = 0;

		const Component = component(function* () {
			yieldCount++;
			yield () => html`<p>first</p>`;
			yieldCount++;
			yield () => html`<p>second</p>`;
			yieldCount++;
			yield () => html`<p>third</p>`;
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
			yield () => html`<p>only</p>`;
			postYieldRan = true;
		});

		track(await mount(tag, Component));

		expect(postYieldRan).toBe(false);
	});

	test("outer generator yielding a static template renders and stops", async () => {
		//static-template install is a different code path from render-fn — pin the cancel here so a refactor can't quietly skip it
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

	test("render-function yield (non-generator function) is invoked exactly once", async () => {
		const tag = uniqueTag();
		let renderFnCalls = 0;
		let postYieldRan = false;

		const Component = component(function* () {
			yield () => {
				renderFnCalls++;
				return html`<p>render-fn ${renderFnCalls}</p>`;
			};
			postYieldRan = true;
		});

		const element = track(await mount(tag, Component));

		expect(renderFnCalls).toBe(1);
		expect(postYieldRan).toBe(false);
		expect(element.shadowRoot!.textContent).toContain("render-fn 1");
	});

	test("nested generator function: SSR descends into the inner and stops at ITS first yield", async () => {
		const tag = uniqueTag();
		let innerYields = 0;

		const Component = component(function* () {
			yield function* inner() {
				innerYields++;
				yield () => html`<p>inner-first</p>`;
				innerYields++;
				yield () => html`<p>inner-second</p>`;
			};
		});

		const element = track(await mount(tag, Component));

		expect(innerYields).toBe(1);
		expect(element.shadowRoot!.textContent).toContain("inner-first");
		expect(element.shadowRoot!.textContent).not.toContain("inner-second");
	});

	test("an ASYNC inner still wins the markup over the parent's own later yield", async () => {
		//the second enforcement point of "the first renderable wins": stopping at the first paint is
		//not enough, the parent must not be resumed past an install whose branch has not painted yet
		const tag = uniqueTag();

		const Component = component(function* () {
			yield async function* inner() {
				await Promise.resolve();
				yield () => html`<p>inner-async</p>`;
			};
			yield html`<p>parent-took-over</p>`;
		});

		const element = track(await mount(tag, Component));
		await flushMicrotasks();

		expect(element.shadowRoot!.textContent).toContain("inner-async");
		expect(element.shadowRoot!.textContent).not.toContain("parent-took-over");
	});

	test("async work BEFORE the first yield resolves, then the first yield renders", async () => {
		//the first template depends on the await — SSR can't skip it
		const tag = uniqueTag();
		let postYieldRan = false;

		const Component = component(function* () {
			const data = yield Promise.resolve("from-server");
			yield () => html`<p>${data as string}</p>`;
			postYieldRan = true;
		});

		const element = track(await mount(tag, Component));
		await flushMicrotasks();

		expect(element.shadowRoot!.textContent).toContain("from-server");
		expect(postYieldRan).toBe(false);
	});

	test("attribute changes do not trigger update() on the server (no MutationObserver allocated)", async () => {
		const tag = uniqueTag();
		let renderCount = 0;

		const Component = component(function* (host) {
			renderCount++;
			yield () =>
				html`<span>${host.getAttribute("data-label") ?? "none"}</span>`;
		});

		const element = track(await mount(tag, Component));
		expect(renderCount).toBe(1);

		element.setAttribute("data-label", "updated");
		await flushMicrotasks();

		//no observer on the server → setAttribute can't trigger update()
		expect(renderCount).toBe(1);
		expect(element.shadowRoot!.textContent).toContain("none");
	});

	test("calling update() manually after SSR has stopped is a no-op", async () => {
		const tag = uniqueTag();
		let renderCount = 0;

		const Component = component(function* () {
			renderCount++;
			yield () => html`<p>${renderCount}</p>`;
		});

		const element = track(await mount(tag, Component));
		const initialCount = renderCount;

		await (element as unknown as { update: () => Promise<void> }).update();
		await flushMicrotasks();

		expect(renderCount).toBe(initialCount);
		expect(element.shadowRoot!.textContent).toContain(String(initialCount));
	});

	test("update() called from inside the first-yield render function does not re-invoke it (infinite-loop guard)", async () => {
		//without the server guard in update(), the cached RENDER_FUNCTION source would re-run the render fn → which schedules another update → forever
		//we count render-fn calls (generator iterations are bounded by the cancel)
		const tag = uniqueTag();
		let renderFunctionCalls = 0;

		const Component = component(function* (host) {
			yield () => {
				renderFunctionCalls++;
				queueMicrotask(() => host.update());
				return html`<p>only</p>`;
			};
		});

		track(await mount(tag, Component));
		//extra flushes give a broken guard room to loop before we assert (the test would then hang to vitest timeout)
		await flushMicrotasks();
		await flushMicrotasks();

		expect(renderFunctionCalls).toBe(1);
	});

	test("setProp on the server applies the attribute but does not trigger a re-render", async () => {
		//two halves split across the boundary: applyAttributeBinding still writes (matters for serialization), update() is gated
		const tag = uniqueTag();
		let renderCount = 0;

		const Component = component(function* (host) {
			renderCount++;
			yield () =>
				html`<span>${host.getAttribute("data-value") ?? "missing"}</span>`;
		});

		const element = track(await mount(tag, Component));
		expect(renderCount).toBe(1);

		(
			element as unknown as {
				setProp: (name: string, value: unknown) => void;
			}
		).setProp("data-value", "after");
		await flushMicrotasks();

		expect(element.getAttribute("data-value")).toBe("after");
		expect(renderCount).toBe(1);
		//shadow still reflects the first-yield evaluation — update never re-ran
		expect(element.shadowRoot!.textContent).toContain("missing");
	});

	test("disconnect after SSR does not throw despite the never-allocated MutationObserver", async () => {
		//optional chaining in disconnectedCallback is the safety net; a throw here would break serialization-batch teardown
		const tag = uniqueTag();

		const Component = component(function* () {
			yield () => html`<p>hi</p>`;
		});

		const element = await mount(tag, Component);
		//don't track() — we're driving disconnect by hand
		expect(() => element.remove()).not.toThrow();
		//disconnectedCallback awaits one microtask before teardown
		await flushMicrotasks();
		await flushMicrotasks();
	});

	test("rejecting Promise before the first renderable yield surfaces the error and stops the generator", async () => {
		//error routes through advanceGenerator → onError → #abortAndShowError, which writes into the shadow root
		//silence console.warn because #abortAndShowError logs it
		const tag = uniqueTag();
		let postYieldRan = false;
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

		const Component = component(function* () {
			yield Promise.reject(new Error("boom"));
			yield () => html`<p>never</p>`;
			postYieldRan = true;
		});

		const element = track(await mount(tag, Component));
		await flushMicrotasks();
		await flushMicrotasks();

		expect(element.shadowRoot!.textContent).toContain("boom");
		expect(postYieldRan).toBe(false);
		expect(warnSpy).toHaveBeenCalled();
		warnSpy.mockRestore();
	});

	test("user finally block runs on server (cancelGenerator calls .return())", async () => {
		//contract: server-side cleanup IS observed by the generator, even though we discard the returned cleanup function
		const tag = uniqueTag();
		let finallyRan = false;
		let cleanupReturnInvoked = false;

		const Component = component(function* () {
			try {
				yield () => html`<p>guarded</p>`;
			} finally {
				finallyRan = true;
				//if the lib ever started capturing this on server, the side-effect would land at teardown — dormant probe
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

	test("server-side try/catch recovers by yielding a fallback (silent, no warn)", async () => {
		//SSR now bubbles errors like CSR: a recoverable inner error lets the outer catch yield a
		//fallback, so the server emits the SAME content the client would — no hydration mismatch, no warn
		const tag = uniqueTag();
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

		const Component = component(function* () {
			try {
				yield function* () {
					yield () => {
						throw new Error("inner-failed");
					};
				};
			} catch {
				yield () => html`<p>fallback</p>`;
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
			yield () => html`<p>first-a</p>`;
			firstYields++;
			yield () => html`<p>first-b</p>`;
		});

		const Second = component(function* () {
			secondYields++;
			yield () => html`<p>second-a</p>`;
			secondYields++;
			yield () => html`<p>second-b</p>`;
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
			yield () => html`<p>serialized-first</p>`;
			yield () => html`<p>serialized-second</p>`;
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
		//root-template attrs live on the host, not the shadow root — SSR must apply them once before getHTML serializes
		const tag = uniqueTag();

		const Component = component(function* () {
			yield () =>
				html`<template class="${"server-class"}" data-x="${"server-x"}">
					<p>body</p>
				</template>`;
		});

		const element = track(await mount(tag, Component));
		expect(element.getAttribute("class")).toBe("server-class");
		expect(element.getAttribute("data-x")).toBe("server-x");
	});

	test("expressions in the first-yield template evaluate against the closure at yield time", async () => {
		//if SSR ever drifted to "render after closing the generator" the expression would re-bind to the post-mutation value
		const tag = uniqueTag();
		let value = "before";

		const Component = component(function* () {
			yield () => html`<p>${value}</p>`;
			value = "after";
			yield () => html`<p>${value}</p>`;
		});

		const element = track(await mount(tag, Component));
		expect(element.shadowRoot!.textContent).toContain("before");
		expect(element.shadowRoot!.textContent).not.toContain("after");
	});

	test("an async render function resolves, renders once, and stops", async () => {
		//the position classifies on both sides or on neither: `yield async () => …` is a wait
		//through a different door than a yielded promise, and the server already awaits those
		const tag = uniqueTag();
		let postYieldRan = false;

		const Component = component(function* () {
			yield async () => {
				await Promise.resolve();
				return html`<p>awaited-server</p>`;
			};
			postYieldRan = true;
		});

		const element = track(await mount(tag, Component));
		await flushMicrotasks();

		expect(element.shadowRoot!.textContent).toContain("awaited-server");
		expect(postYieldRan).toBe(false);
	});

	test("a render function returning a generator function descends into it", async () => {
		const tag = uniqueTag();
		let innerRan = false;

		const Component = component(function* () {
			yield () =>
				function* delegatedBody() {
					innerRan = true;
					yield html`<p>delegated-server</p>`;
				};
		});

		const element = track(await mount(tag, Component));

		expect(innerRan).toBe(true);
		expect(element.shadowRoot!.textContent).toContain("delegated-server");
	});

	test("a render function returning an uncommittable value fails", async () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		const tag = uniqueTag();

		const Component = component(function* () {
			yield () => new Map();
		});

		const element = track(await mount(tag, Component));

		expect(element.shadowRoot!.textContent).toContain("grundlage");
		warnSpy.mockRestore();
	});
});
