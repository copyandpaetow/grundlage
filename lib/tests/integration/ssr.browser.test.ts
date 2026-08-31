import { describe, expect, test, vi } from "vitest";
import { html, component, load } from "../../src/index";
import { ComponentConstructor } from "../../src/types";

const sleep = (duration = 0) =>
	new Promise((resolve) => setTimeout(resolve, duration));

//resolves as soon as the first-yield content lands; a fixed sleep flakes on slower
//async-before-yield generators
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

	const serverRender = async (
		tag: string,
		ComponentClass: ComponentConstructor,
	): Promise<string> => {
		(globalThis as { __grundlage_ssr__?: boolean }).__grundlage_ssr__ = true;
		try {
			customElements.define(tag, ComponentClass);
			const element = document.createElement(tag);
			document.body.appendChild(element);
			//poll rather than sleep — async-before-yield settle times are workload-dependent
			await waitForShadowContent(element);
			//host attributes land on the element itself and getHTML returns shadow content only, so they
			//are re-emitted around it
			const hostAttrs = Array.from(element.attributes)
				.map((attribute) => ` ${attribute.name}="${attribute.value}"`)
				.join("");
			const serialized = element.getHTML({ serializableShadowRoots: true });
			element.remove();
			//let the async disconnectedCallback drain, so the next define cannot race teardown
			await sleep();
			return `<${tag}${hostAttrs}>${serialized}</${tag}>`;
		} finally {
			(globalThis as { __grundlage_ssr__?: boolean }).__grundlage_ssr__ = false;
		}
	};

	//the tag must still be undefined when this runs, so the element is parsed and connected before
	//anything upgrades it — the order a real page loads in
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

			const MyElement = component(function* () {
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

			const MyElement = component(function* () {
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

			const MyElement = component(function* () {
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

			const MyElement = component(function* () {
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

			const MyElement = component(function* () {
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

				const ServerComponent = component(function* () {
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
					component(function* () {
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
				//server and client render the same value here, so hydration compares and writes nothing
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
				//hydration walks the marker comments: serialization stripping them makes every later update
				//misfire silently
				//proof-by-effect: a post-hydrate update must change the DOM
				const serverTag = uniqueTag();
				const clientTag = uniqueTag();
				let counter = 0;

				const makeComponent = () =>
					component(function* () {
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

			test("a keyed list hydrates and then reorders by key", async () => {
				//the key comment is stripped at parse time, so server markup carries no marker for
				//it — hydration must still pair every remaining marker with the right binding
				const serverTag = uniqueTag();
				const clientTag = uniqueTag();
				let items = [
					{ id: "a", text: "alpha" },
					{ id: "b", text: "bravo" },
					{ id: "c", text: "charlie" },
				];

				const makeComponent = () =>
					component(function* () {
						yield () =>
							html`<ul>
								${items.map(
									(item) =>
										html`<!--${item.id}-->
											<li class="${item.id}">${item.text}</li>`,
								)}
							</ul>`;
					});

				const serialized = await serverRender(serverTag, makeComponent());
				const clientHTML = serialized.replace(
					new RegExp(serverTag, "g"),
					clientTag,
				);
				const element = hydrateFromHTML(clientHTML);
				customElements.define(clientTag, makeComponent());
				await sleep();

				const rows = () =>
					Array.from(element.shadowRoot!.querySelectorAll("li"));
				const [aNode, bNode, cNode] = rows();
				expect(rows().map((row) => row.className)).toEqual(["a", "b", "c"]);

				items = [
					{ id: "c", text: "Charlie-2" },
					{ id: "a", text: "Alpha-2" },
					{ id: "b", text: "Bravo-2" },
				];
				await (
					element as InstanceType<ReturnType<typeof makeComponent>>
				).update();
				await sleep();

				expect(rows()).toEqual([cNode, aNode, bNode]);
				expect(rows().map((row) => row.textContent?.trim())).toEqual([
					"Charlie-2",
					"Alpha-2",
					"Bravo-2",
				]);

				cleanup(element);
			});

			test("server skipping post-yield code does not affect the client (which sees a fresh run)", async () => {
				//SSR-stop only affects the server pass; the client generator runs normally
				const serverTag = uniqueTag();
				const clientTag = uniqueTag();
				let clientPostYieldRan = false;
				let serverPostYieldRan = false;

				const ServerComponent = component(function* () {
					yield () => html`<p>shared</p>`;
					serverPostYieldRan = true;
				});

				await serverRender(serverTag, ServerComponent);
				expect(serverPostYieldRan).toBe(false);

				//a separate factory and flag are what prove the client ran its own post-yield body
				const ClientComponent = component(function* () {
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

			test("nested generator: server stops at the inner's first yield, client hydrates against it", async () => {
				//the client has to be single-yield: a second yield with a different template hash replaces
				//the children and wastes the adoption
				const serverTag = uniqueTag();
				const clientTag = uniqueTag();
				let innerSecondYielded = false;

				const ServerComponent = component(function* () {
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

				const ClientComponent = component(function* () {
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

			test("an inner generator's throw the outer catches paints the recovery content", async () => {
				const serverTag = uniqueTag();
				const clientTag = uniqueTag();

				const ServerComponent = component(function* () {
					yield function* inner() {
						yield () => html`<p>server-content</p>`;
					};
				});

				const serialized = await serverRender(serverTag, ServerComponent);
				expect(serialized).toContain("server-content");

				const ClientComponent = component(function* () {
					try {
						yield function* inner() {
							//an object in a content hole throws, and an inner generator's throw reaches the
							//outer's yield rather than the fatal display
							yield () => html`<p>${new Date() as unknown as string}</p>`;
						};
					} catch {
						yield () => html`<p>recovered</p>`;
					}
				});

				const clientHTML = serialized.replace(
					new RegExp(serverTag, "g"),
					clientTag,
				);
				const element = hydrateFromHTML(clientHTML);
				customElements.define(clientTag, ClientComponent);
				await sleep();

				expect(element.shadowRoot?.querySelector("p")?.textContent).toBe(
					"recovered",
				);

				cleanup(element);
			});

			//the three content kinds the server range can be rejected for; each one lands on the
			//rebuild in hydrateContent, which had no coverage at all
			const hydrateContentMismatch = async (
				serverBody: () => unknown,
				clientBody: () => unknown,
			) => {
				const serverTag = uniqueTag();
				const clientTag = uniqueTag();
				const serialized = await serverRender(
					serverTag,
					component(function* () {
						yield () => html`<div>${serverBody()}</div>`;
					}),
				);
				const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
				const element = hydrateFromHTML(
					serialized.replace(new RegExp(serverTag, "g"), clientTag),
				);
				customElements.define(
					clientTag,
					component(function* () {
						yield () => html`<div>${clientBody()}</div>`;
					}),
				);
				await sleep();
				const warned = warnSpy.mock.calls.some((call) =>
					String(call[0]).includes("hydration mismatch"),
				);
				warnSpy.mockRestore();
				return { element, warned };
			};

			test("content mismatch: a server text range rejected by a client list rebuilds as a list", async () => {
				const { element, warned } = await hydrateContentMismatch(
					() => "server text",
					() => ["one", "two", "three"].map((item) => html`<p>${item}</p>`),
				);

				expect(warned).toBe(true);
				expect(
					Array.from(element.shadowRoot!.querySelectorAll("p")).map(
						(paragraph) => paragraph.textContent,
					),
				).toEqual(["one", "two", "three"]);
				expect(element.shadowRoot!.textContent).not.toContain("server text");

				cleanup(element);
			});

			test("content mismatch: a server list range rejected by a client text rebuilds as text", async () => {
				const { element, warned } = await hydrateContentMismatch(
					() => ["one", "two"].map((item) => html`<p>${item}</p>`),
					() => "client text",
				);

				expect(warned).toBe(true);
				expect(element.shadowRoot!.querySelector("p")).toBe(null);
				expect(element.shadowRoot!.textContent).toContain("client text");

				cleanup(element);
			});

			test("content mismatch: a server text range rejected by a client branch rebuilds as a branch", async () => {
				const { element, warned } = await hydrateContentMismatch(
					() => "server text",
					() => html`<section>${"branch"}</section>`,
				);

				expect(warned).toBe(true);
				expect(element.shadowRoot!.querySelector("section")?.textContent).toBe(
					"branch",
				);
				expect(element.shadowRoot!.textContent).not.toContain("server text");

				cleanup(element);
			});

			test("a root-rejected range still reports the payloads it left unclaimed", async () => {
				const serverTag = uniqueTag();
				const clientTag = uniqueTag();
				const serialized = await serverRender(
					serverTag,
					component(function* ({ host }) {
						yield load(host, async () => "server payload");
						yield () => html`<div>${"server"}</div>`;
					}),
				);
				expect(serialized).toContain("data-ssr");

				const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
				const element = hydrateFromHTML(
					serialized.replace(new RegExp(serverTag, "g"), clientTag),
				);
				//one binding more than the server wrote markers for, so the walk fails at the root
				customElements.define(
					clientTag,
					component(function* () {
						yield () =>
							html`<div>${"a"}</div>
								<span>${"b"}</span>`;
					}),
				);
				await sleep();
				const warnings = warnSpy.mock.calls.map((call) => String(call[0]));
				warnSpy.mockRestore();

				expect(
					warnings.some((text) => text.includes("hydration mismatch")),
				).toBe(true);
				expect(
					warnings.some((text) => text.includes("1 SSR load() payload(s)")),
				).toBe(true);

				cleanup(element);
			});

			test("host attribute mismatch: server's first-yield value is overwritten by the client's first-yield value", async () => {
				//hydrate re-applies attribute bindings — host attrs are the one category where the client value wins
				const serverTag = uniqueTag();
				const clientTag = uniqueTag();

				const ServerComponent = component(function* () {
					yield () =>
						html`<template class="${"server-class"}"><p>hi</p></template>`;
				});
				const serialized = await serverRender(serverTag, ServerComponent);
				expect(serialized).toContain("server-class");

				const ClientComponent = component(function* () {
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

				const Component = component(function* () {
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
				//render-function calls, not yields: a yield count passes even with a broken guard, because
				//the cancel still stops the generator
				const serverTag = uniqueTag();
				let renderFunctionCalls = 0;
				let secondYieldRan = false;

				const Component = component(function* ({ host }) {
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
				//a flag left set by serverRender's finally would stop the client at its first yield too
				const clientTag = uniqueTag();
				let firstYield = true;

				const ClientComponent = component(function* () {
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

			const MyElement = component(function* () {
				yield () => html`<p>content</p>`;
			});

			const serialized = await serverRender(tag, MyElement);
			const element = hydrateFromHTML(serialized);
			await sleep();

			//server-rendered content should be preserved (not replaced by CSR mount)
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
				component(function* () {
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
				component(function* () {
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
				component(function* () {
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
				component(function* () {
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
				component(function* () {
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

			//declared, because only a declared attribute re-renders — an undeclared write is ignored
			const makeComponent = () =>
				component(
					function* ({ host: element }) {
						yield () =>
							html`<span
								>${element.getAttribute("data-label") ?? "none"}</span
							>`;
					},
					{ props: { "data-label": String } },
				);

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
				component(function* () {
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
				component(function* () {
					const host = yield () => html`<p>content</p>`;
					receivedHost = host as HTMLElement;
				}),
			);
			await sleep();

			expect(receivedHost).toBe(element);

			cleanup(element);
		});

		test("hydrate repairs server content when the client's first render carries a different value", async () => {
			//two unrelated classes with hardcoded text so server/client disagree; adopting text the
			//client no longer renders is the silent stale render, so hydrate compares and writes
			const serverTag = uniqueTag();
			const clientTag = uniqueTag();

			const ServerComponent = component(function* () {
				yield () => html`<p>${"server-value"}</p>`;
			});
			const serialized = await serverRender(serverTag, ServerComponent);
			const clientHTML = serialized.replace(
				new RegExp(serverTag, "g"),
				clientTag,
			);

			const ClientComponent = component(function* () {
				yield () => html`<p>${"client-value"}</p>`;
			});
			const element = hydrateFromHTML(clientHTML);
			customElements.define(clientTag, ClientComponent);
			await sleep();

			expect(element.shadowRoot?.querySelector("p")?.textContent).toBe(
				"client-value",
			);

			//no update() follow-up: both renders carry the same hardcoded expression, so it would see
			//current === previous and skip
			//"responds to update() after hydration" above covers the actual refresh path

			cleanup(element);
		});

		test("hydrate refreshes a host attribute when the client renders a different value", async () => {
			//host attributes are not serialized into the shadow root, so hydration re-applies every
			//attribute binding and the client value wins
			const serverTag = uniqueTag();
			const clientTag = uniqueTag();

			const ServerComponent = component(function* () {
				yield () =>
					html`<template class="${"server-class"}"><p>hi</p></template>`;
			});
			const serialized = await serverRender(serverTag, ServerComponent);
			const clientHTML = serialized.replace(
				new RegExp(serverTag, "g"),
				clientTag,
			);

			const ClientComponent = component(function* () {
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
				component(function* () {
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

		test("a spread event handler fires after hydration", async () => {
			//the server serializes only the stringable half of a spread; the function half is
			//dropped, so hydration must re-attach it as a listener rather than only snapshot its hash
			const serverTag = uniqueTag();
			const clientTag = uniqueTag();
			let clicks = 0;

			const makeComponent = () =>
				component(function* () {
					const attributes = {
						onClick: () => {
							clicks++;
						},
						"data-static": "kept",
					};
					yield () => html`<button ${attributes}>press</button>`;
				});

			const serialized = await serverRender(serverTag, makeComponent());
			expect(serialized).toContain('data-static="kept"');

			const clientHTML = serialized.replace(
				new RegExp(serverTag, "g"),
				clientTag,
			);
			const element = hydrateFromHTML(clientHTML);
			customElements.define(clientTag, makeComponent());
			await sleep();

			element
				.shadowRoot!.querySelector("button")!
				.dispatchEvent(new Event("click"));
			expect(clicks).toBe(1);

			cleanup(element);
		});

		test("a spread property-mode value is assigned after hydration", async () => {
			//non-stringable spread values are set as element properties, which can't survive
			//serialization; hydration must assign them, not just record their hash
			const serverTag = uniqueTag();
			const clientTag = uniqueTag();
			const payload = { a: 1 };

			const makeComponent = () =>
				component(function* () {
					const attributes = { customData: payload };
					yield () => html`<div ${attributes}>x</div>`;
				});

			const serialized = await serverRender(serverTag, makeComponent());
			const clientHTML = serialized.replace(
				new RegExp(serverTag, "g"),
				clientTag,
			);
			const element = hydrateFromHTML(clientHTML);
			customElements.define(clientTag, makeComponent());
			await sleep();

			const target = element.shadowRoot!.querySelector("div") as HTMLElement & {
				customData?: unknown;
			};
			expect(target.customData).toEqual(payload);

			cleanup(element);
		});

		test("a spread rewrites nothing the server already carries", async () => {
			const serverTag = uniqueTag();
			const clientTag = uniqueTag();

			const makeComponent = () =>
				component(function* () {
					const attributes = { "data-role": "row", title: "same" };
					yield () => html`<div ${attributes}>x</div>`;
				});

			const serialized = await serverRender(serverTag, makeComponent());
			const clientHTML = serialized.replace(
				new RegExp(serverTag, "g"),
				clientTag,
			);
			const element = hydrateFromHTML(clientHTML);

			const rewrittenAttributes: Array<string> = [];
			const observer = new MutationObserver((records) => {
				for (const record of records)
					rewrittenAttributes.push(record.attributeName!);
			});
			observer.observe(element.shadowRoot!, {
				attributes: true,
				subtree: true,
			});

			customElements.define(clientTag, makeComponent());
			await sleep();
			observer.disconnect();

			expect(rewrittenAttributes).toEqual([]);

			cleanup(element);
		});

		test("a dynamic style sheet hydrates without touching the CSSOM, then updates through it", async () => {
			const serverTag = uniqueTag();
			const clientTag = uniqueTag();

			const makeComponent = () =>
				component(function* ({ host }) {
					let color = "red";
					(host as HTMLElement & { recolor?: () => void }).recolor = () => {
						color = "blue";
						host.update();
					};
					yield () =>
						html`<style>
								p {
									color: ${color};
								}
							</style>
							<p>text</p>`;
				});

			const serialized = await serverRender(serverTag, makeComponent());
			expect(serialized).toContain("color: red");

			const clientHTML = serialized.replace(
				new RegExp(serverTag, "g"),
				clientTag,
			);
			const element = hydrateFromHTML(clientHTML) as HTMLElement & {
				recolor: () => void;
			};

			const setProperty = vi.spyOn(
				CSSStyleDeclaration.prototype,
				"setProperty",
			);
			customElements.define(clientTag, makeComponent());
			await sleep();

			expect(setProperty).not.toHaveBeenCalled();

			element.recolor();
			await sleep();

			//the lane still works: seeding the hashes must not read as a demotion to the text lane
			expect(setProperty).toHaveBeenCalledTimes(1);
			setProperty.mockRestore();
			expect(
				getComputedStyle(element.shadowRoot!.querySelector("p")!).color,
			).toBe("rgb(0, 0, 255)");

			cleanup(element);
		});
	});
});
