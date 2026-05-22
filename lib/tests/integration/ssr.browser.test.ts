import { describe, expect, test } from "vitest";
import { html, render } from "../../src/index";

const sleep = (duration = 0) =>
	new Promise((resolve) => setTimeout(resolve, duration));

//resolve as soon as the SSR pass has written its first-yield content into the shadow root
//replaces a fixed `sleep(20)` so async-before-first-yield generators that take longer than the magic number can't silently flake to an empty serialization
const waitForShadowContent = async (
	element: HTMLElement,
	timeoutMs = 200,
) => {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (element.shadowRoot && element.shadowRoot.childNodes.length > 0)
			return;
		await sleep(0);
	}
};

describe.skipIf("happyDOM" in globalThis)("server-side rendering", () => {
	let tagId = 0;
	const uniqueTag = () => `test-ssr-${tagId++}-${Date.now()}`;

	const cleanup = (element: HTMLElement) => {
		element.remove();
	};

	/**
	 * Renders a component into the DOM under the lib's SSR contract
	 * (`globalThis.__grundlage_ssr__ = true` flips the lib into server mode so
	 * it cancels both generator sources after the first renderable yield),
	 * serializes the shadow root, removes the element, and unsets the flag.
	 *
	 * The returned string is the declarative-shadow-DOM HTML the SSR plugin
	 * would emit — i.e. the first-yield snapshot, not the generator's terminal state.
	 */
	const serverRender = async (
		tag: string,
		ComponentClass: ReturnType<typeof render>,
	): Promise<string> => {
		(globalThis as { __grundlage_ssr__?: boolean }).__grundlage_ssr__ = true;
		try {
			customElements.define(tag, ComponentClass);
			const element = document.createElement(tag);
			document.body.appendChild(element);
			//poll for the first-yield content rather than guessing a sleep duration — async-before-first-yield generators settle whenever the await chain finishes, which is workload-dependent
			await waitForShadowContent(element);
			//host attributes (root templates) land on the element itself, not the shadow root — getHTML returns shadow content only, so we have to re-emit the host's attributes around it or the hydrate side will never see them
			const hostAttrs = Array.from(element.attributes)
				.map((attribute) => ` ${attribute.name}="${attribute.value}"`)
				.join("");
			const serialized = element.getHTML({ serializableShadowRoots: true });
			element.remove();
			//let the prior element's async disconnectedCallback body drain before returning — otherwise the next test's customElements.define can race against the prior element's teardown
			await sleep();
			return `<${tag}${hostAttrs}>${serialized}</${tag}>`;
		} finally {
			(globalThis as { __grundlage_ssr__?: boolean }).__grundlage_ssr__ = false;
		}
	};

	/**
	 * Takes serialized outer HTML (from serverRender) and mounts it into the document
	 * via innerHTML, simulating a browser parsing declarative shadow DOM from the server response.
	 * The custom element class must NOT be defined yet at this point.
	 */
	const hydrateFromHTML = (serializedHTML: string): HTMLElement => {
		const wrapper = document.createElement("div");
		wrapper.setHTMLUnsafe(serializedHTML);
		const element = wrapper.firstElementChild as HTMLElement;
		document.body.appendChild(element);
		return element;
	};

	describe("serialization", () => {
		test("renders into a serializable shadow root", async () => {
			const tag = uniqueTag();

			const MyElement = render(function* () {
				yield () => html`<p>hello</p>`;
			});

			customElements.define(tag, MyElement);
			const element = document.createElement(tag);
			document.body.appendChild(element);
			await sleep();

			const serialized = element.getHTML({ serializableShadowRoots: true });
			expect(serialized).toContain("<template shadowrootmode=");
			expect(serialized).toContain("<p>hello</p>");

			cleanup(element);
		});

		test("serializes dynamic content with current values", async () => {
			const tag = uniqueTag();
			let count = 42;

			const MyElement = render(function* () {
				yield () => html`<span>${count}</span>`;
			});

			customElements.define(tag, MyElement);
			const element = document.createElement(tag) as InstanceType<
				typeof MyElement
			>;
			document.body.appendChild(element);
			await sleep();

			const serialized = element.getHTML({ serializableShadowRoots: true });
			expect(serialized).toContain("42");

			cleanup(element);
		});

		test("serializes nested templates", async () => {
			const tag = uniqueTag();

			const MyElement = render(function* () {
				yield () => html` <div>${html`<span>nested</span>`}</div>`;
			});

			customElements.define(tag, MyElement);
			const element = document.createElement(tag);
			document.body.appendChild(element);
			await sleep();

			const serialized = element.getHTML({ serializableShadowRoots: true });
			expect(serialized).toContain("<span>nested</span>");

			cleanup(element);
		});

		test("serializes list content", async () => {
			const tag = uniqueTag();
			const items = ["apple", "banana", "cherry"];

			const MyElement = render(function* () {
				yield () =>
					html` <ul>
						${items.map((item) => html` <li>${item}</li>`)}
					</ul>`;
			});

			customElements.define(tag, MyElement);
			const element = document.createElement(tag);
			document.body.appendChild(element);
			await sleep();

			const serialized = element.getHTML({ serializableShadowRoots: true });
			expect(serialized).toContain("apple");
			expect(serialized).toContain("banana");
			expect(serialized).toContain("cherry");

			cleanup(element);
		});

		test("serializes attributes on rendered elements", async () => {
			const tag = uniqueTag();

			const MyElement = render(function* () {
				yield () =>
					html` <div class="container" id="main"><p>content</p></div>`;
			});

			customElements.define(tag, MyElement);
			const element = document.createElement(tag);
			document.body.appendChild(element);
			await sleep();

			const serialized = element.getHTML({ serializableShadowRoots: true });
			expect(serialized).toContain('class="container"');
			expect(serialized).toContain('id="main"');

			cleanup(element);
		});
	});

	describe("hydration", () => {
		describe("first renderable yield: SSR stops, client resumes", () => {
			test("server emits the first-yield content, not the generator's terminal state", async () => {
				//the contract for the new SSR mode: we stop at the first renderable yield, regardless of what the generator would have produced if allowed to run to completion
				//=> a "loading → loaded" generator must serialize the loading frame
				const serverTag = uniqueTag();
				let yieldCount = 0;

				const ServerComponent = render(function* () {
					yieldCount++;
					yield () => html`<p>loading</p>`;
					yieldCount++;
					yield () => html`<p>loaded</p>`;
					yieldCount++;
					yield () => html`<p>final</p>`;
				});

				const serialized = await serverRender(serverTag, ServerComponent);

				expect(yieldCount).toBe(1);
				expect(serialized).toContain("loading");
				expect(serialized).not.toContain("loaded");
				expect(serialized).not.toContain("final");
			});

			test("client resumes from first yield: hydrates loading state, then renders subsequent yields", async () => {
				//roundtrip: SSR emits "loading" → client mounts that HTML → client's generator yields "loading" (hydrates against SSR DOM) → user-driven update() advances to "loaded"
				//=> tests the full SSR-stop + client-resume contract end to end
				const serverTag = uniqueTag();
				const clientTag = uniqueTag();
				let phase: "loading" | "loaded" = "loading";

				const makeComponent = () =>
					render(function* () {
						yield () => html`<p>${phase}</p>`;
					});

				const serialized = await serverRender(serverTag, makeComponent());
				expect(serialized).toContain("loading");

				const clientHTML = serialized.replace(
					new RegExp(serverTag, "g"),
					clientTag,
				);
				const element = hydrateFromHTML(clientHTML);

				customElements.define(clientTag, makeComponent());
				await sleep();
				//immediately after hydration the DOM still carries the server's loading text — the client's first yield matched and was used to wire bindings, not to overwrite content
				expect(element.shadowRoot?.querySelector("p")?.textContent).toBe(
					"loading",
				);

				phase = "loaded";
				await (
					element as InstanceType<ReturnType<typeof makeComponent>>
				).update();
				await sleep();
				expect(element.shadowRoot?.querySelector("p")?.textContent).toBe(
					"loaded",
				);

				cleanup(element);
			});

			test("comment markers survive serialization → setHTMLUnsafe → hydrate", async () => {
				//hydrate() finds bindings by walking comment nodes with COMMENT_IDENTIFIER (template-html.ts)
				//=> if the serialization pipeline ever strips comments, the hydrated targets array goes empty and every update misfires silently
				//we verify by checking that a post-hydrate update actually changes the DOM (which requires the markers to have been preserved)
				const serverTag = uniqueTag();
				const clientTag = uniqueTag();
				let counter = 0;

				const makeComponent = () =>
					render(function* () {
						yield () => html`<span>count: ${counter}</span>`;
					});

				const serialized = await serverRender(serverTag, makeComponent());
				//the serialized output must contain at least one HTML comment marker for the binding system to anchor against
				expect(serialized).toMatch(/<!--/);

				const clientHTML = serialized.replace(
					new RegExp(serverTag, "g"),
					clientTag,
				);
				const element = hydrateFromHTML(clientHTML);
				customElements.define(clientTag, makeComponent());
				await sleep();

				counter = 42;
				await (
					element as InstanceType<ReturnType<typeof makeComponent>>
				).update();
				await sleep();

				expect(
					element.shadowRoot?.querySelector("span")?.textContent,
				).toContain("42");

				cleanup(element);
			});

			test("server skipping post-yield code does not affect the client (which sees a fresh run)", async () => {
				//side-effects placed after the first yield should fire on the client even though they were skipped on the server
				//=> demonstrates that the SSR-stop only affects the server pass; the client generator gets to run normally
				const serverTag = uniqueTag();
				const clientTag = uniqueTag();
				let clientPostYieldRan = false;
				let serverPostYieldRan = false;

				const ServerComponent = render(function* () {
					yield () => html`<p>shared</p>`;
					serverPostYieldRan = true;
				});

				await serverRender(serverTag, ServerComponent);
				expect(serverPostYieldRan).toBe(false);

				//we cannot reuse the same closure for the client because its `serverPostYieldRan` was already proven false above; use a separate factory and a separate flag
				const ClientComponent = render(function* () {
					yield () => html`<p>shared</p>`;
					clientPostYieldRan = true;
				});

				const fakeSerialized = `<${serverTag}><template shadowrootmode="open"><p>shared</p></template></${serverTag}>`;
				const clientHTML = fakeSerialized.replace(
					new RegExp(serverTag, "g"),
					clientTag,
				);

				const element = hydrateFromHTML(clientHTML);
				customElements.define(clientTag, ClientComponent);
				await sleep();

				expect(clientPostYieldRan).toBe(true);

				cleanup(element);
			});

			test("nested generator: server stops at INNER's first yield, client hydrates against it", async () => {
				//mirrors the node-env nested-generator test but in the real browser, so we also verify the serialized output reflects the inner's first yield
				//the client component MUST be single-yield: the contract is "server stops, client matches the SSR DOM and waits"; if the client kept yielding (different templateHash each time), #renderToDom would swap the DOM via replaceChildren on the next yield and the hydrate would be wasted work — that's the opposite of what we're testing
				const serverTag = uniqueTag();
				const clientTag = uniqueTag();
				let innerSecondYielded = false;

				const ServerComponent = render(function* () {
					yield function* inner() {
						yield () => html`<p>inner-first</p>`;
						innerSecondYielded = true;
						yield () => html`<p>inner-second</p>`;
					};
				});

				const serialized = await serverRender(serverTag, ServerComponent);
				expect(serialized).toContain("inner-first");
				expect(serialized).not.toContain("inner-second");
				expect(innerSecondYielded).toBe(false);

				const ClientComponent = render(function* () {
					yield function* inner() {
						yield () => html`<p>inner-first</p>`;
					};
				});

				const clientHTML = serialized.replace(
					new RegExp(serverTag, "g"),
					clientTag,
				);
				const element = hydrateFromHTML(clientHTML);
				customElements.define(clientTag, ClientComponent);
				await sleep();

				//hydration matched on inner-first; nothing else has happened yet so the DOM still reads inner-first
				expect(element.shadowRoot?.querySelector("p")?.textContent).toBe(
					"inner-first",
				);

				cleanup(element);
			});

			test("host attribute mismatch: server's first-yield value is overwritten by the client's first-yield value", async () => {
				// root-template (host) attrs are the one binding category hydrate WILL re-write, even on the matching first yield (template-html.ts hydrate() re-applies all ATTR bindings)
				// => server says class="server-class", client's first yield says class="client-class" → after hydrate the host reads "client-class"
				const serverTag = uniqueTag();
				const clientTag = uniqueTag();

				const ServerComponent = render(function* () {
					yield () =>
						html`<template class="${"server-class"}"><p>hi</p></template>`;
				});
				const serialized = await serverRender(serverTag, ServerComponent);
				expect(serialized).toContain("server-class");

				const ClientComponent = render(function* () {
					yield () =>
						html`<template class="${"client-class"}"><p>hi</p></template>`;
				});
				const clientHTML = serialized.replace(
					new RegExp(serverTag, "g"),
					clientTag,
				);
				const element = hydrateFromHTML(clientHTML);
				customElements.define(clientTag, ClientComponent);
				await sleep();

				expect(element.getAttribute("class")).toBe("client-class");

				cleanup(element);
			});

			test("server with async-before-first-yield: SSR awaits then emits the data-loaded frame", async () => {
				//generators commonly fetch before yielding; the server still has to wait for that fetch, then stop at the first renderable
				const serverTag = uniqueTag();
				let postYieldRan = false;

				const Component = render(function* () {
					const data = yield Promise.resolve("server-data");
					yield () => html`<p>${data as string}</p>`;
					postYieldRan = true;
					yield () => html`<p>after</p>`;
				});

				const serialized = await serverRender(serverTag, Component);
				expect(serialized).toContain("server-data");
				expect(serialized).not.toContain("after");
				expect(postYieldRan).toBe(false);
			});

			test("update() scheduled from inside the first-yield render fn does not re-invoke it (infinite-loop guard)", async () => {
				//without the `isServerEnvironment()` guard at the top of update(), a render fn that schedules `host.update()` would loop forever on the server:
				//RENDER_FUNCTION source caches the fn → update() reaches the switch → calls render(this) again → render fn schedules another update → repeat
				//=> we count render-fn invocations specifically (counting yields would also pass with a broken guard, since the cancel still stops the generator), and assert the second yield never lands
				const serverTag = uniqueTag();
				let renderFunctionCalls = 0;
				let secondYieldRan = false;

				const Component = render(function* (host) {
					yield () => {
						renderFunctionCalls++;
						queueMicrotask(() => host.update());
						return html`<p>first-only</p>`;
					};
					secondYieldRan = true;
					yield () => html`<p>should-not-appear</p>`;
				});

				const serialized = await serverRender(serverTag, Component);
				expect(renderFunctionCalls).toBe(1);
				expect(secondYieldRan).toBe(false);
				expect(serialized).toContain("first-only");
				expect(serialized).not.toContain("should-not-appear");
			});

			test("client mount without server-side flag runs the generator normally", async () => {
				//paranoia check: verify the flag we toggle in serverRender does not leak into the client mount path
				//if the unset in the `finally` block ever broke, the client's component would also stop at first yield → update() couldn't advance it
				const clientTag = uniqueTag();
				let firstYield = true;

				const ClientComponent = render(function* () {
					yield () => html`<p>${firstYield ? "a" : "b"}</p>`;
				});

				customElements.define(clientTag, ClientComponent);
				const element = document.createElement(clientTag) as InstanceType<
					typeof ClientComponent
				>;
				document.body.appendChild(element);
				await sleep();

				expect(element.shadowRoot?.querySelector("p")?.textContent).toBe("a");

				firstYield = false;
				await element.update();
				await sleep();
				expect(element.shadowRoot?.querySelector("p")?.textContent).toBe("b");

				cleanup(element);
			});
		});

		test("detects pre-existing shadow root and skips attachShadow", async () => {
			const tag = uniqueTag();

			const MyElement = render(function* () {
				yield () => html`<p>content</p>`;
			});

			const serialized = await serverRender(tag, MyElement);
			const element = hydrateFromHTML(serialized);
			await sleep();

			// Server-rendered content should be preserved (not replaced by CSR mount)
			expect(element.shadowRoot?.querySelector("p")?.textContent).toBe(
				"content",
			);

			cleanup(element);
		});

		test("preserves server-rendered DOM on initial mount", async () => {
			const serverTag = uniqueTag();
			const clientTag = uniqueTag();
			let text = "server text";

			const makeComponent = () =>
				render(function* () {
					yield () => html`<p>${text}</p>`;
				});

			const serialized = await serverRender(serverTag, makeComponent());
			const clientHTML = serialized.replace(
				new RegExp(serverTag, "g"),
				clientTag,
			);
			const element = hydrateFromHTML(clientHTML);

			customElements.define(clientTag, makeComponent());
			await sleep();

			const paragraph = element.shadowRoot?.querySelector("p");
			expect(paragraph).not.toBeNull();
			expect(paragraph?.textContent).toContain("server text");

			cleanup(element);
		});

		test("responds to update() after hydration", async () => {
			const serverTag = uniqueTag();
			const clientTag = uniqueTag();
			let count = 0;

			const makeComponent = () =>
				render(function* () {
					yield () => html`<span>${count}</span>`;
				});

			const serialized = await serverRender(serverTag, makeComponent());
			const clientHTML = serialized.replace(
				new RegExp(serverTag, "g"),
				clientTag,
			);

			const ClientComponent = makeComponent();
			const element = hydrateFromHTML(clientHTML);

			customElements.define(clientTag, ClientComponent);
			await sleep();

			count = 10;
			await (element as InstanceType<typeof ClientComponent>).update();
			await sleep();

			const span = element.shadowRoot?.querySelector("span");
			expect(span).not.toBeNull();
			expect(span?.textContent).toContain("10");

			cleanup(element);
		});

		test("does not duplicate content during hydration", async () => {
			const serverTag = uniqueTag();
			const clientTag = uniqueTag();

			const makeComponent = () =>
				render(function* () {
					yield () =>
						html` <div>
							<h1>title</h1>
							<p>body</p>
						</div>`;
				});

			const serialized = await serverRender(serverTag, makeComponent());
			const clientHTML = serialized.replace(
				new RegExp(serverTag, "g"),
				clientTag,
			);
			const element = hydrateFromHTML(clientHTML);

			customElements.define(clientTag, makeComponent());
			await sleep();

			const divs = element.shadowRoot?.querySelectorAll("div");
			const headings = element.shadowRoot?.querySelectorAll("h1");
			const paragraphs = element.shadowRoot?.querySelectorAll("p");
			expect(divs?.length).toBe(1);
			expect(headings?.length).toBe(1);
			expect(paragraphs?.length).toBe(1);

			cleanup(element);
		});

		test("cleanup callback fires after hydration", async () => {
			const serverTag = uniqueTag();
			const clientTag = uniqueTag();
			let cleaned = false;

			const serialized = await serverRender(
				serverTag,
				render(function* () {
					yield () => html`<p>content</p>`;
				}),
			);
			const clientHTML = serialized.replace(
				new RegExp(serverTag, "g"),
				clientTag,
			);
			const element = hydrateFromHTML(clientHTML);

			customElements.define(
				clientTag,
				render(function* () {
					yield () => html`<p>content</p>`;
					return () => {
						cleaned = true;
					};
				}),
			);
			await sleep();

			cleanup(element);
			await sleep();

			expect(cleaned).toBe(true);
		});

		test("attribute mutation triggers re-render after hydration", async () => {
			const serverTag = uniqueTag();
			const clientTag = uniqueTag();

			const makeComponent = () =>
				render(function* (element) {
					yield () =>
						html`<span>${element.getAttribute("data-label") ?? "none"}</span>`;
				});

			const serialized = await serverRender(serverTag, makeComponent());
			const clientHTML = serialized.replace(
				new RegExp(serverTag, "g"),
				clientTag,
			);
			const element = hydrateFromHTML(clientHTML);

			customElements.define(clientTag, makeComponent());
			await sleep();

			element.setAttribute("data-label", "updated");
			await sleep(50);

			const span = element.shadowRoot?.querySelector("span");
			expect(span?.textContent).toContain("updated");

			cleanup(element);
		});

		test("generator receives the host element from yield during hydration", async () => {
			const serverTag = uniqueTag();
			const clientTag = uniqueTag();
			let receivedHost: HTMLElement | null = null;

			const serialized = await serverRender(
				serverTag,
				render(function* () {
					yield () => html`<p>content</p>`;
				}),
			);
			const clientHTML = serialized.replace(
				new RegExp(serverTag, "g"),
				clientTag,
			);
			const element = hydrateFromHTML(clientHTML);

			customElements.define(
				clientTag,
				render(function* () {
					const host = yield () => html`<p>content</p>`;
					receivedHost = host as HTMLElement;
				}),
			);
			await sleep();

			expect(receivedHost).toBe(element);

			cleanup(element);
		});

		test("hydrate leaves server CONTENT in place even when client's first render carries a different value", async () => {
			//the hydrate path (template-html.ts:69-83) re-applies ATTR bindings only — CONTENT bindings are left alone so we don't overwrite the server text
			//we pin that contract here so a future change that decides to also flush CONTENT on hydrate becomes a deliberate decision, not a drift
			//the test deliberately uses two unrelated component classes with hardcoded text so server and client disagree on the value; the DOM after hydrate must match the server, not the client
			const serverTag = uniqueTag();
			const clientTag = uniqueTag();

			const ServerComponent = render(function* () {
				yield () => html`<p>${"server-value"}</p>`;
			});
			const serialized = await serverRender(serverTag, ServerComponent);
			const clientHTML = serialized.replace(
				new RegExp(serverTag, "g"),
				clientTag,
			);

			const ClientComponent = render(function* () {
				yield () => html`<p>${"client-value"}</p>`;
			});
			const element = hydrateFromHTML(clientHTML);
			customElements.define(clientTag, ClientComponent);
			await sleep();

			//hydration kept the server text untouched even though the client wanted a different value
			expect(element.shadowRoot?.querySelector("p")?.textContent).toBe(
				"server-value",
			);

			//note we deliberately don't follow up with update() here — both client renders carry the same hardcoded expression, so update() sees current === previous and won't flush
			//the "responds to update() after hydration" test (above) already covers the post-hydrate refresh path with a closure value that actually changes

			cleanup(element);
		});

		test("hydrate refreshes a host attribute when the client renders a different value", async () => {
			//host (root template) attrs are the one binding category hydrate WILL re-write — they live as bindings only, never serialized into the shadow root
			//we set up a server class that emits host class="server-class" and a client class that emits "client-class"; after hydrate the host should carry the client value
			const serverTag = uniqueTag();
			const clientTag = uniqueTag();

			const ServerComponent = render(function* () {
				yield () =>
					html`<template class="${"server-class"}"><p>hi</p></template>`;
			});
			const serialized = await serverRender(serverTag, ServerComponent);
			const clientHTML = serialized.replace(
				new RegExp(serverTag, "g"),
				clientTag,
			);

			const ClientComponent = render(function* () {
				yield () =>
					html`<template class="${"client-class"}"><p>hi</p></template>`;
			});
			const element = hydrateFromHTML(clientHTML);
			customElements.define(clientTag, ClientComponent);
			await sleep();

			expect(element.getAttribute("class")).toBe("client-class");

			cleanup(element);
		});

		test("template switching works after hydration", async () => {
			const serverTag = uniqueTag();
			const clientTag = uniqueTag();
			let useList = false;

			const makeComponent = () =>
				render(function* () {
					yield () =>
						useList
							? html` <ul>
									<li>item</li>
								</ul>`
							: html`<p>paragraph</p>`;
				});

			const serialized = await serverRender(serverTag, makeComponent());
			const clientHTML = serialized.replace(
				new RegExp(serverTag, "g"),
				clientTag,
			);

			const ClientComponent = makeComponent();
			const element = hydrateFromHTML(clientHTML);

			customElements.define(clientTag, ClientComponent);
			await sleep();

			useList = true;
			await (element as InstanceType<typeof ClientComponent>).update();
			await sleep();

			expect(element.shadowRoot?.querySelector("p")).toBeNull();
			expect(element.shadowRoot?.querySelector("ul")).not.toBeNull();
			expect(element.shadowRoot?.querySelector("li")?.textContent).toBe("item");

			cleanup(element);
		});
	});
});
