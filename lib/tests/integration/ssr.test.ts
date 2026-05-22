//side-effect-only import must come first so the lib's parser/html.ts (which runs `document.createElement` at module load) sees a polyfilled `document`
import "./ssr-setup";

import { afterEach, describe, expect, test, vi } from "vitest";
import { html, render } from "../../src/index";

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
	//flush microtasks so synchronous generators reach their first yield (and any user-side `await Promise.resolve()` settles)
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
		//sanity: `window` is unset in node and we don't polyfill it, so the lib should be in server mode here
		expect(typeof window).toBe("undefined");
	});

	test("synchronous generator with multiple yields renders only the first one", async () => {
		const tag = uniqueTag();
		let yieldCount = 0;

		const Component = render(function* () {
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

		const Component = render(function* () {
			yield () => html`<p>only</p>`;
			postYieldRan = true;
		});

		track(await mount(tag, Component));

		expect(postYieldRan).toBe(false);
	});

	test("outer generator yielding a static template renders and stops", async () => {
		//the static-template install path is shaped differently from the render-function path (no .call(host) step)
		//=> we cover it explicitly so a future refactor can't quietly skip the cancel in this branch
		const tag = uniqueTag();
		let postYieldRan = false;

		const Component = render(function* () {
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

		const Component = render(function* () {
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

		const Component = render(function* () {
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

	test("async work BEFORE the first yield resolves, then the first yield renders", async () => {
		//generators commonly do `const data = yield fetch(...)` before their first renderable
		//=> SSR has to wait for that await to settle (we can't skip it — the first template depends on it)
		const tag = uniqueTag();
		let postYieldRan = false;

		const Component = render(function* () {
			const data = yield Promise.resolve("from-server");
			yield () => html`<p>${data as string}</p>`;
			postYieldRan = true;
		});

		const element = track(await mount(tag, Component));
		//two awaits because the Promise resolution + the subsequent yield each cross a microtask boundary
		await flushMicrotasks();

		expect(element.shadowRoot!.textContent).toContain("from-server");
		expect(postYieldRan).toBe(false);
	});

	test("attribute changes do not trigger update() on the server (no MutationObserver allocated)", async () => {
		const tag = uniqueTag();
		let renderCount = 0;

		const Component = render(function* (host) {
			renderCount++;
			yield () =>
				html`<span>${host.getAttribute("data-label") ?? "none"}</span>`;
		});

		const element = track(await mount(tag, Component));
		expect(renderCount).toBe(1);

		element.setAttribute("data-label", "updated");
		await flushMicrotasks();

		//if the observer were installed, setAttribute would have triggered update() → another render
		//on the server we skip the observer entirely, so renderCount stays at 1
		expect(renderCount).toBe(1);
		expect(element.shadowRoot!.textContent).toContain("none");
	});

	test("calling update() manually after SSR has stopped is a no-op", async () => {
		const tag = uniqueTag();
		let renderCount = 0;

		const Component = render(function* () {
			renderCount++;
			yield () => html`<p>${renderCount}</p>`;
		});

		const element = track(await mount(tag, Component));
		const initialCount = renderCount;

		await (element as unknown as { update: () => Promise<void> }).update();
		await flushMicrotasks();

		//update() short-circuits on the `isServerEnvironment()` guard at the top — it never reaches the switch, so the cached active source is never re-rendered
		//practically: no new render, the DOM still shows the first-yield count
		expect(renderCount).toBe(initialCount);
		expect(element.shadowRoot!.textContent).toContain(String(initialCount));
	});

	test("update() called from inside the first-yield render function does not re-invoke it (infinite-loop guard)", async () => {
		//without the `isServerEnvironment()` guard inside update(), a render function that schedules `host.update()` would run forever on the server:
		//RENDER_FUNCTION source caches a ref to the render fn → update() reaches the switch → calls render(this) again → render fn schedules another update → repeat
		//=> we count the render-fn invocations specifically (not generator iterations — those are already bounded by the cancel) to pin the guard against regression
		const tag = uniqueTag();
		let renderFunctionCalls = 0;

		const Component = render(function* (host) {
			yield () => {
				renderFunctionCalls++;
				queueMicrotask(() => host.update());
				return html`<p>only</p>`;
			};
		});

		track(await mount(tag, Component));
		//two extra flushes give a hypothetical loop room to run before we assert; if the guard breaks, the test process hangs (which surfaces as a vitest timeout)
		await flushMicrotasks();
		await flushMicrotasks();

		expect(renderFunctionCalls).toBe(1);
	});

	test("setProperty on the server applies the attribute but does not trigger a re-render", async () => {
		//setProperty's two halves split across the server boundary: applyAttributeBinding writes to the host (still needed), update() is gated (must be a no-op)
		//=> we verify both halves: the attribute lands, but the cached active source is not stepped
		const tag = uniqueTag();
		let renderCount = 0;

		const Component = render(function* (host) {
			renderCount++;
			yield () => html`<span>${host.getAttribute("data-value") ?? "missing"}</span>`;
		});

		const element = track(await mount(tag, Component));
		expect(renderCount).toBe(1);

		(element as unknown as { setProperty: (name: string, value: unknown) => void })
			.setProperty("data-value", "after");
		await flushMicrotasks();

		expect(element.getAttribute("data-value")).toBe("after");
		expect(renderCount).toBe(1);
		//the shadow root still reflects the first-yield evaluation ("missing"), because update never re-ran
		expect(element.shadowRoot!.textContent).toContain("missing");
	});

	test("disconnect after SSR does not throw despite the never-allocated MutationObserver", async () => {
		//the disconnectedCallback path runs `this.#attributeObserver?.disconnect()` — the optional chaining is the safety net for the server path where the observer was never assigned
		//=> calling .remove() on a freshly server-rendered element must complete cleanly, otherwise teardown of a serialization batch would throw mid-flight
		const tag = uniqueTag();

		const Component = render(function* () {
			yield () => html`<p>hi</p>`;
		});

		const element = await mount(tag, Component);
		//we deliberately don't track() — we're driving disconnect by hand
		expect(() => element.remove()).not.toThrow();
		//disconnectedCallback awaits one microtask before doing teardown; let it land
		await flushMicrotasks();
		await flushMicrotasks();
	});

	test("rejecting Promise before the first renderable yield surfaces the error and stops the generator", async () => {
		//error path on the server: a yielded rejecting Promise routes through advanceGenerator → onError → deliverErrorToGenerator → (uncaught) → onError again → #abortAndShowError
		//=> the error is written into the shadow root and the post-yield body does not run; we silence console.warn because #abortAndShowError logs the error and we don't want that in test output
		const tag = uniqueTag();
		let postYieldRan = false;
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

		const Component = render(function* () {
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
		//cancelGenerator(.return()) is what runs the user's try/finally
		//=> the contract is: server-side cleanup IS observed by the generator, even though we don't capture the returned cleanup function
		const tag = uniqueTag();
		let finallyRan = false;
		let cleanupReturnInvoked = false;

		const Component = render(function* () {
			try {
				yield () => html`<p>guarded</p>`;
			} finally {
				finallyRan = true;
				//if the lib ever DID capture this cleanup return value on server, this side-effect would land at component teardown — we leave it dormant and only assert finallyRan
				return () => {
					cleanupReturnInvoked = true;
				};
			}
		});

		track(await mount(tag, Component));

		expect(finallyRan).toBe(true);
		//we don't call .remove() to test disconnect; the finally already ran via the cancel path
		//cleanupReturnInvoked stays false because cancelGenerator discards the .return() result — that's the intentional server behavior
		expect(cleanupReturnInvoked).toBe(false);
	});

	test("two components on the same page each stop at their own first yield", async () => {
		const firstTag = uniqueTag();
		const secondTag = uniqueTag();
		let firstYields = 0;
		let secondYields = 0;

		const First = render(function* () {
			firstYields++;
			yield () => html`<p>first-a</p>`;
			firstYields++;
			yield () => html`<p>first-b</p>`;
		});

		const Second = render(function* () {
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
		//the prerender plugin reads from document.body.getHTML({ serializableShadowRoots: true })
		//=> we verify the same call path produces a <template shadowrootmode=...> wrapper carrying the first-yield content and nothing past it
		const tag = uniqueTag();

		const Component = render(function* () {
			yield () => html`<p>serialized-first</p>`;
			yield () => html`<p>serialized-second</p>`;
		});

		track(await mount(tag, Component));
		//the prerender plugin reads from `document.body.getHTML(...)` (see prerender-plugin/ssr-render.ts), not from the element directly — we mirror that call to match the real pipeline
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
		//root templates write attributes onto the host itself, not into the shadow root
		//=> SSR must still apply them once before serialization — `getHTML` includes the host's outer tag with its attributes
		const tag = uniqueTag();

		const Component = render(function* () {
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
		//if SSR ever drifted toward "render the template only after closing the generator" the expression would re-bind to the post-mutation value
		//=> we pin that the expression evaluated at yield time is the one that lands in the DOM
		const tag = uniqueTag();
		let value = "before";

		const Component = render(function* () {
			yield () => html`<p>${value}</p>`;
			value = "after";
			yield () => html`<p>${value}</p>`;
		});

		const element = track(await mount(tag, Component));
		expect(element.shadowRoot!.textContent).toContain("before");
		expect(element.shadowRoot!.textContent).not.toContain("after");
	});
});
