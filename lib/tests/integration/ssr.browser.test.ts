import { describe, expect, test } from "vitest";
import { html, render } from "../../src/index";

const sleep = (duration = 0) =>
	new Promise((resolve) => setTimeout(resolve, duration));

describe.skipIf("happyDOM" in globalThis)("server-side rendering", () => {
	let tagId = 0;
	const uniqueTag = () => `test-ssr-${tagId++}-${Date.now()}`;

	const cleanup = (element: HTMLElement) => {
		element.remove();
	};

	/**
	 * Renders a component into the DOM, serializes its shadow root with
	 * getHTML({ serializableShadowRoots: true }), then removes it.
	 * Returns the serialized outer HTML including the declarative shadow DOM template.
	 */
	const serverRender = async (
		tag: string,
		ComponentClass: ReturnType<typeof render>,
	): Promise<string> => {
		customElements.define(tag, ComponentClass);
		const element = document.createElement(tag);
		document.body.appendChild(element);
		await sleep();
		const serialized = element.getHTML({ serializableShadowRoots: true });
		element.remove();
		return `<${tag}>${serialized}</${tag}>`;
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

		test("generator receives shadow root from yield during hydration", async () => {
			const serverTag = uniqueTag();
			const clientTag = uniqueTag();
			let receivedRoot: ShadowRoot | null = null;

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
					const root = yield () => html`<p>content</p>`;
					receivedRoot = root as ShadowRoot;
				}),
			);
			await sleep();

			expect(receivedRoot).toBe(element.shadowRoot);

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
