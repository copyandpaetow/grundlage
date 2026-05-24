import { describe, expect, test } from "vitest";
import { html, render } from "../../src/index";

const sleep = (duration = 0) =>
	new Promise((resolve) => setTimeout(resolve, duration));

//resolve as soon as the first-yield content lands; a fixed sleep would silently flake on slower async-before-yield generators
const waitForShadowContent = async (element: HTMLElement, timeoutMs = 200) => {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (element.shadowRoot && element.shadowRoot.childNodes.length > 0) return;
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
	 * Flips `__grundlage_ssr__`, mounts, polls for first-yield content,
	 * serializes, removes the element, clears the flag.
	 * Returns the declarative-shadow-DOM HTML the plugin would emit.
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
			//poll rather than sleep — async-before-yield settle times are workload-dependent
			await waitForShadowContent(element);
			//host attrs land on the element itself; getHTML returns shadow content only, so we re-emit them around it
			const hostAttrs = Array.from(element.attributes)
				.map((attribute) => ` ${attribute.name}="${attribute.value}"`)
				.join("");
			const serialized = element.getHTML({ serializableShadowRoots: true });
			element.remove();
			//let the async disconnectedCallback drain so the next test's customElements.define can't race teardown
			await sleep();
			return `<${tag}${hostAttrs}>${serialized}</${tag}>`;
		} finally {
			(globalThis as { __grundlage_ssr__?: boolean }).__grundlage_ssr__ = false;
		}
	};

	/**
	 * Mounts serialized SSR HTML via setHTMLUnsafe — simulates the browser
	 * parsing declarative shadow DOM. The custom element class must NOT be
	 * defined yet at this point.
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
				//a "loading → loaded" generator must serialize the loading frame
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
				//roundtrip: SSR emits "loading" → client hydrates → user update() advances to "loaded"
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
				//hydrate wires bindings without overwriting the server text
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
				//hydrate() walks COMMENT_IDENTIFIER markers — if serialization strips them, every update silently misfires
				//proof-by-effect: a post-hydrate update must change the DOM
				const serverTag = uniqueTag();
				const clientTag = uniqueTag();
				let counter = 0;

				const makeComponent = () =>
					render(function* () {
						yield () => html`<span>count: ${counter}</span>`;
					});

				const serialized = await serverRender(serverTag, makeComponent());
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
				//SSR-stop only affects the server pass; the client generator runs normally
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

				//separate factory + flag so we can prove the client ran its own post-yield body
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
				//client MUST be single-yield: a second yield with a different templateHash would replaceChildren and waste the hydrate
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

				expect(element.shadowRoot?.querySelector("p")?.textContent).toBe(
					"inner-first",
				);

				cleanup(element);
			});

			test("host attribute mismatch: server's first-yield value is overwritten by the client's first-yield value", async () => {
				//hydrate re-applies ATTR bindings — host attrs are the one category where the client value wins
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
				//RENDER_FUNCTION source caches the fn — a broken guard would loop forever
				//count render-fn calls specifically; yields alone would pass even with a broken guard because the cancel still stops the generator
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
				//paranoia: if the flag unset in serverRender's finally ever broke, the client would stop at first yield too
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
			//hydrate re-applies ATTR bindings only — CONTENT is left alone so we don't overwrite the server text
			//two unrelated classes with hardcoded text so server/client disagree; the DOM must match the server
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

			expect(element.shadowRoot?.querySelector("p")?.textContent).toBe(
				"server-value",
			);

			//no update() follow-up here — both renders carry the same hardcoded expression, so update would see current === previous and skip
			//"responds to update() after hydration" above covers the actual refresh path

			cleanup(element);
		});

		test("hydrate refreshes a host attribute when the client renders a different value", async () => {
			//host attrs aren't serialized into the shadow root; hydrate re-applies all ATTR bindings, so the client value wins
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
