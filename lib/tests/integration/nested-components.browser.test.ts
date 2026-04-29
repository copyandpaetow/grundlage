import { describe, expect, test, vi } from "vitest";
import { html, props, render } from "../../src/index";
import { HTMLTemplate } from "../../src/rendering/template-html";
import { BaseComponent, GeneratorFn } from "../../src/types";

const sleep = (duration = 0) =>
	new Promise((resolve) => setTimeout(resolve, duration));

let tagId = 0;
const uniqueTag = (prefix: string) =>
	`test-${prefix}-${tagId++}-${Date.now()}`;

const mount = (tag: string): HTMLElement => {
	const element = document.createElement(tag);
	document.body.appendChild(element);
	return element;
};

describe("nested components", () => {
	test("renders a child custom element inside a parent shadow root", async () => {
		const childTag = uniqueTag("child");
		const parentTag = uniqueTag("parent");

		customElements.define(
			childTag,
			render(function* () {
				yield () => html`<span>child-content</span>`;
			}),
		);
		customElements.define(
			parentTag,
			render(function* () {
				yield () => html`<section><${childTag}></${childTag}></section>`;
			}),
		);

		const element = mount(parentTag);
		await sleep();

		const child = element.shadowRoot?.querySelector(childTag) as HTMLElement;
		expect(child).not.toBeNull();
		expect(child.shadowRoot?.querySelector("span")?.textContent).toBe(
			"child-content",
		);

		element.remove();
	});

	test("parent attribute update propagates to child via attribute binding", async () => {
		const childTag = uniqueTag("child-attr");
		const parentTag = uniqueTag("parent-attr");

		customElements.define(
			childTag,
			render(function* (element) {
				yield () =>
					html`<span>${element.getAttribute("label") ?? "empty"}</span>`;
			}),
		);

		let label = "first";
		const ParentClass = render(function* () {
			yield () => html`<${childTag} label=${label}></${childTag}>`;
		});
		customElements.define(parentTag, ParentClass);

		const element = mount(parentTag) as InstanceType<typeof ParentClass>;
		await sleep();

		const child = element.shadowRoot?.querySelector(childTag) as HTMLElement;
		expect(child.shadowRoot?.querySelector("span")?.textContent).toBe("first");

		label = "second";
		await element.update();
		await sleep(50);

		expect(child.getAttribute("label")).toBe("second");
		expect(child.shadowRoot?.querySelector("span")?.textContent).toBe("second");

		element.remove();
	});

	test("parent passes complex property to child and triggers child update", async () => {
		const childTag = uniqueTag("child-prop");
		const parentTag = uniqueTag("parent-prop");

		type Child = HTMLElement & { data?: { value: number } };

		customElements.define(
			childTag,
			render(function* (element) {
				yield () => {
					const data = (element as Child).data;
					return html`<span>${data ? data.value : "none"}</span>`;
				};
			}),
		);

		let payload: { value: number } = { value: 1 };
		const ParentClass = render(function* () {
			yield () => html`<${childTag} data=${payload}></${childTag}>`;
		});
		customElements.define(parentTag, ParentClass);

		const element = mount(parentTag) as InstanceType<typeof ParentClass>;
		await sleep();

		const child = element.shadowRoot?.querySelector(childTag) as Child;
		expect(child.data).toBe(payload);
		expect(child.shadowRoot?.querySelector("span")?.textContent).toBe("1");

		payload = { value: 42 };
		await element.update();
		await sleep();

		expect(child.data).toBe(payload);
		expect(child.shadowRoot?.querySelector("span")?.textContent).toBe("42");

		element.remove();
	});

	test("events dispatched from child bubble (composed) to parent listener", async () => {
		const childTag = uniqueTag("child-evt");
		const parentTag = uniqueTag("parent-evt");

		customElements.define(
			childTag,
			render(function* (element) {
				const emit = () => {
					element.dispatchEvent(
						new CustomEvent("pinged", {
							bubbles: true,
							composed: true,
							detail: 7,
						}),
					);
				};
				yield () => html`<button onClick=${emit}>ping</button>`;
			}),
		);

		const received: number[] = [];
		const ParentClass = render(function* (element) {
			element.addEventListener("pinged", (event) => {
				received.push((event as CustomEvent<number>).detail);
			});
			yield () => html`<div><${childTag}></${childTag}></div>`;
		});
		customElements.define(parentTag, ParentClass);

		const element = mount(parentTag) as InstanceType<typeof ParentClass>;
		await sleep();

		const button = element.shadowRoot
			?.querySelector(childTag)
			?.shadowRoot?.querySelector("button") as HTMLButtonElement;
		button.click();

		expect(received).toEqual([7]);

		element.remove();
	});

	test("parent re-render preserves child element identity when structure is stable", async () => {
		const childTag = uniqueTag("child-identity");
		const parentTag = uniqueTag("parent-identity");

		customElements.define(
			childTag,
			render(function* (element) {
				yield () =>
					html`<span>${element.getAttribute("label") ?? "none"}</span>`;
			}),
		);

		let label = "a";
		const ParentClass = render(function* () {
			yield () => html`<div><${childTag} label=${label}></${childTag}></div>`;
		});
		customElements.define(parentTag, ParentClass);

		const element = mount(parentTag) as InstanceType<typeof ParentClass>;
		await sleep();

		const childBefore = element.shadowRoot?.querySelector(childTag);
		expect(childBefore).not.toBeNull();

		label = "b";
		await element.update();
		await sleep(50);

		const childAfter = element.shadowRoot?.querySelector(childTag);
		expect(childAfter).toBe(childBefore);
		expect(childAfter?.shadowRoot?.querySelector("span")?.textContent).toBe(
			"b",
		);

		element.remove();
	});

	test("list of nested children keeps independent state", async () => {
		const childTag = uniqueTag("child-list");
		const parentTag = uniqueTag("parent-list");

		customElements.define(
			childTag,
			render(function* (element) {
				yield () =>
					html`<span>${element.getAttribute("value") ?? ""}</span>`;
			}),
		);

		let items = ["x", "y", "z"];
		const ParentClass = render(function* () {
			yield () =>
				html`<ul>
					${items.map(
						(item) =>
							html`<li><${childTag} value=${item}></${childTag}></li>`,
					)}
				</ul>`;
		});
		customElements.define(parentTag, ParentClass);

		const element = mount(parentTag) as InstanceType<typeof ParentClass>;
		await sleep();

		const children = element.shadowRoot?.querySelectorAll(
			childTag,
		) as NodeListOf<HTMLElement>;
		expect(children.length).toBe(3);
		expect(
			Array.from(children).map(
				(child) => child.shadowRoot?.querySelector("span")?.textContent,
			),
		).toEqual(["x", "y", "z"]);

		items = ["x", "y", "z", "w"];
		await element.update();
		await sleep(50);

		const grown = element.shadowRoot?.querySelectorAll(
			childTag,
		) as NodeListOf<HTMLElement>;
		expect(grown.length).toBe(4);
		expect(grown[3].shadowRoot?.querySelector("span")?.textContent).toBe("w");

		element.remove();
	});

	test("three-level nesting renders all levels", async () => {
		const leafTag = uniqueTag("leaf");
		const middleTag = uniqueTag("middle");
		const rootTag = uniqueTag("root");

		customElements.define(
			leafTag,
			render(function* () {
				yield () => html`<em>leaf</em>`;
			}),
		);
		customElements.define(
			middleTag,
			render(function* () {
				yield () => html`<div><${leafTag}></${leafTag}></div>`;
			}),
		);
		customElements.define(
			rootTag,
			render(function* () {
				yield () => html`<section><${middleTag}></${middleTag}></section>`;
			}),
		);

		const element = mount(rootTag);
		await sleep();

		const middle = element.shadowRoot?.querySelector(middleTag) as HTMLElement;
		const leaf = middle.shadowRoot?.querySelector(leafTag) as HTMLElement;
		expect(leaf.shadowRoot?.querySelector("em")?.textContent).toBe("leaf");

		element.remove();
	});

	test("child cleanup runs when parent is removed", async () => {
		const childTag = uniqueTag("child-cleanup");
		const parentTag = uniqueTag("parent-cleanup");

		let cleanedChild = false;
		customElements.define(
			childTag,
			render(function* () {
				yield () => html`<span>temp</span>`;
				return () => {
					cleanedChild = true;
				};
			}),
		);
		customElements.define(
			parentTag,
			render(function* () {
				yield () => html`<${childTag}></${childTag}>`;
			}),
		);

		const element = mount(parentTag);
		await sleep();

		element.remove();
		await sleep();

		expect(cleanedChild).toBe(true);
	});

	test("nested child state survives parent update that keeps it mounted", async () => {
		const childTag = uniqueTag("child-state");
		const parentTag = uniqueTag("parent-state");

		let counterInternal = 0;
		customElements.define(
			childTag,
			render(function* () {
				yield () => html`<span>${counterInternal}</span>`;
			}),
		);

		let parentLabel = "one";
		const ParentClass = render(function* () {
			yield () =>
				html`<div>
					<h1>${parentLabel}</h1>
					<${childTag}></${childTag}>
				</div>`;
		});
		customElements.define(parentTag, ParentClass);

		const element = mount(parentTag) as InstanceType<typeof ParentClass>;
		await sleep();

		const child = element.shadowRoot?.querySelector(childTag) as InstanceType<
			ReturnType<typeof render>
		>;
		counterInternal = 5;
		await child.update();
		await sleep();

		expect(child.shadowRoot?.querySelector("span")?.textContent).toBe("5");

		parentLabel = "two";
		await element.update();
		await sleep();

		expect(element.shadowRoot?.querySelector("h1")?.textContent).toBe("two");
		// child should be the same element and retain its last-rendered state
		const sameChild = element.shadowRoot?.querySelector(childTag);
		expect(sameChild).toBe(child);
		expect(sameChild?.shadowRoot?.querySelector("span")?.textContent).toBe("5");

		element.remove();
	});
});

describe("shared template generator functions", () => {
	//a template generator function returns an HTMLTemplate so it can be embedded
	//as a child expression in any other template — reuse without recompiling.

	const card = (title: string, body: string): HTMLTemplate =>
		html`<article class="card">
			<h2>${title}</h2>
			<p>${body}</p>
		</article>`;

	const list = <Item>(
		items: ReadonlyArray<Item>,
		row: (item: Item) => HTMLTemplate,
	): HTMLTemplate => html`<ul>
		${items.map((item) => html`<li>${row(item)}</li>`)}
	</ul>`;

	test("same helper produces identical hashes for identical inputs", () => {
		const first = card("Hi", "World");
		const second = card("Hi", "World");
		expect(first.hash).toBe(second.hash);
	});

	test("same helper produces different hashes when inputs differ", () => {
		const first = card("Hi", "World");
		const second = card("Bye", "World");
		expect(first.hash).not.toBe(second.hash);
	});

	test("two components using the same helper render consistently", async () => {
		const tagA = uniqueTag("shared-a");
		const tagB = uniqueTag("shared-b");

		const ComponentA = render(function* () {
			yield () => card("from-a", "body-a");
		});
		const ComponentB = render(function* () {
			yield () => card("from-b", "body-b");
		});
		customElements.define(tagA, ComponentA);
		customElements.define(tagB, ComponentB);

		const elementA = mount(tagA);
		const elementB = mount(tagB);
		await sleep();

		expect(elementA.shadowRoot?.querySelector("h2")?.textContent).toBe(
			"from-a",
		);
		expect(elementA.shadowRoot?.querySelector("p")?.textContent).toBe("body-a");
		expect(elementB.shadowRoot?.querySelector("h2")?.textContent).toBe(
			"from-b",
		);
		expect(elementB.shadowRoot?.querySelector("p")?.textContent).toBe("body-b");

		elementA.remove();
		elementB.remove();
	});

	test("helper reused inside a list updates only changed rows", async () => {
		const tag = uniqueTag("shared-list");
		let rows = [
			{ title: "alpha", body: "one" },
			{ title: "beta", body: "two" },
		];

		const ComponentClass = render(function* () {
			yield () => list(rows, (row) => card(row.title, row.body));
		});
		customElements.define(tag, ComponentClass);

		const element = mount(tag) as InstanceType<typeof ComponentClass>;
		await sleep();

		const stableHeading = element.shadowRoot?.querySelectorAll("h2")[0];
		expect(stableHeading?.textContent).toBe("alpha");
		expect(
			element.shadowRoot?.querySelectorAll("h2")[1]?.textContent,
		).toBe("beta");

		rows = [
			{ title: "alpha", body: "one" },
			{ title: "beta", body: "two-updated" },
		];
		await element.update();
		await sleep();

		//structural stability: the first row's heading node should be the same
		//since its inputs did not change
		const headingAfter = element.shadowRoot?.querySelectorAll("h2")[0];
		expect(headingAfter).toBe(stableHeading);
		expect(
			element.shadowRoot?.querySelectorAll("p")[1]?.textContent,
		).toBe("two-updated");

		element.remove();
	});

	test("nested helper composition (helper calls helper)", async () => {
		const tag = uniqueTag("shared-compose");

		const labeled = (label: string, inner: HTMLTemplate) =>
			html`<section><strong>${label}</strong>${inner}</section>`;

		const ComponentClass = render(function* () {
			yield () => labeled("heading", card("title", "body"));
		});
		customElements.define(tag, ComponentClass);

		const element = mount(tag);
		await sleep();

		expect(element.shadowRoot?.querySelector("strong")?.textContent).toBe(
			"heading",
		);
		expect(element.shadowRoot?.querySelector("h2")?.textContent).toBe("title");
		expect(element.shadowRoot?.querySelector("p")?.textContent).toBe("body");

		element.remove();
	});

	test("helper with conditional variants swaps DOM structure between updates", async () => {
		const tag = uniqueTag("shared-conditional");

		const status = (state: "idle" | "loading" | "error", message: string) =>
			state === "loading"
				? html`<div role="status">loading: ${message}</div>`
				: state === "error"
					? html`<div role="alert">${message}</div>`
					: html`<div role="presentation">${message}</div>`;

		let state: "idle" | "loading" | "error" = "loading";
		let message = "fetching";
		const ComponentClass = render(function* () {
			yield () => status(state, message);
		});
		customElements.define(tag, ComponentClass);

		const element = mount(tag) as InstanceType<typeof ComponentClass>;
		await sleep();

		expect(
			element.shadowRoot?.querySelector("[role=status]")?.textContent,
		).toContain("fetching");

		state = "error";
		message = "boom";
		await element.update();
		await sleep();

		expect(element.shadowRoot?.querySelector("[role=status]")).toBeNull();
		expect(
			element.shadowRoot?.querySelector("[role=alert]")?.textContent,
		).toContain("boom");

		state = "idle";
		message = "ready";
		await element.update();
		await sleep();

		expect(element.shadowRoot?.querySelector("[role=alert]")).toBeNull();
		expect(
			element.shadowRoot?.querySelector("[role=presentation]")?.textContent,
		).toContain("ready");

		element.remove();
	});

	test("helper reused across multiple call sites in one template", async () => {
		const tag = uniqueTag("shared-multi-site");

		const ComponentClass = render(function* () {
			yield () => html`<main>
				${card("first", "one")}${card("second", "two")}${card("third", "three")}
			</main>`;
		});
		customElements.define(tag, ComponentClass);

		const element = mount(tag);
		await sleep();

		const headings = element.shadowRoot?.querySelectorAll("h2");
		const bodies = element.shadowRoot?.querySelectorAll("p");
		expect(
			Array.from(headings ?? []).map((heading) => heading.textContent),
		).toEqual(["first", "second", "third"]);
		expect(Array.from(bodies ?? []).map((body) => body.textContent)).toEqual([
			"one",
			"two",
			"three",
		]);

		element.remove();
	});

	test("helper shared between a parent component and its nested child", async () => {
		const childTag = uniqueTag("shared-child");
		const parentTag = uniqueTag("shared-parent");

		customElements.define(
			childTag,
			render(function* (element) {
				yield () =>
					card(
						element.getAttribute("title") ?? "",
						element.getAttribute("body") ?? "",
					);
			}),
		);

		const ParentClass = render(function* () {
			yield () => html`<div>
				${card("parent-card", "outer")}
				<${childTag} title="child-card" body="inner"></${childTag}>
			</div>`;
		});
		customElements.define(parentTag, ParentClass);

		const element = mount(parentTag);
		await sleep();

		const parentHeading = element.shadowRoot?.querySelector("h2");
		expect(parentHeading?.textContent).toBe("parent-card");

		const child = element.shadowRoot?.querySelector(childTag) as HTMLElement;
		expect(child.shadowRoot?.querySelector("h2")?.textContent).toBe(
			"child-card",
		);
		expect(child.shadowRoot?.querySelector("p")?.textContent).toBe("inner");

		element.remove();
	});
});

describe("shared generator functions", () => {
	test("same generator passed to two render() calls produces independent components", async () => {
		let mountCount = 0;
		const counterGenerator: GeneratorFn = function* () {
			const id = ++mountCount;
			yield () => html`<span>id-${id}</span>`;
		};

		const firstTag = uniqueTag("shared-gen-a");
		const secondTag = uniqueTag("shared-gen-b");
		customElements.define(firstTag, render(counterGenerator));
		customElements.define(secondTag, render(counterGenerator));

		const first = mount(firstTag);
		const second = mount(secondTag);
		await sleep();

		expect(first.shadowRoot?.querySelector("span")?.textContent).toBe("id-1");
		expect(second.shadowRoot?.querySelector("span")?.textContent).toBe("id-2");

		first.remove();
		second.remove();
	});

	test("same generator reused for two instances of the same tag keeps state isolated", async () => {
		const tag = uniqueTag("shared-gen-isolated");
		const stateGenerator: GeneratorFn = function* (element) {
			//per-instance state captured in the generator closure
			let count = 0;
			element.addEventListener("increment", () => {
				count++;
				element.update();
			});
			yield () => html`<span>${count}</span>`;
		};
		customElements.define(tag, render(stateGenerator));

		const first = mount(tag) as BaseComponent;
		const second = mount(tag) as BaseComponent;
		await sleep();

		first.dispatchEvent(new CustomEvent("increment"));
		first.dispatchEvent(new CustomEvent("increment"));
		second.dispatchEvent(new CustomEvent("increment"));
		await sleep();

		expect(first.shadowRoot?.querySelector("span")?.textContent).toBe("2");
		expect(second.shadowRoot?.querySelector("span")?.textContent).toBe("1");

		first.remove();
		second.remove();
	});

	test("yield* delegates to a shared sub-generator", async () => {
		//a sub-generator acts like a reusable behavior block — its yields flow
		//up through the parent generator into the framework's #step.
		const loadingThenData: GeneratorFn = function* () {
			yield html`<p>loading</p>`;
			const data: string = (yield Promise.resolve("ready")) as string;
			yield () => html`<p>${data}</p>`;
		};

		const tag = uniqueTag("delegated");
		customElements.define(
			tag,
			render(function* (element) {
				yield* loadingThenData(element);
			}),
		);

		const element = mount(tag);
		await sleep(20);

		expect(element.shadowRoot?.querySelector("p")?.textContent).toBe("ready");

		element.remove();
	});

	test("higher-order generator wraps another generator with extra behavior", async () => {
		const calls: string[] = [];

		const withLifecycleLog =
			(name: string, inner: GeneratorFn): GeneratorFn =>
			function* (element) {
				calls.push(`${name}:setup`);
				yield* inner(element);
				calls.push(`${name}:teardown-registered`);
				return () => calls.push(`${name}:cleanup`);
			};

		const body: GeneratorFn = function* () {
			yield () => html`<p>wrapped</p>`;
		};

		const tag = uniqueTag("higher-order");
		customElements.define(tag, render(withLifecycleLog("A", body)));

		const element = mount(tag);
		await sleep();

		expect(element.shadowRoot?.querySelector("p")?.textContent).toBe("wrapped");
		expect(calls).toEqual(["A:setup", "A:teardown-registered"]);

		element.remove();
		await sleep();

		expect(calls).toContain("A:cleanup");
	});

	test("sub-generator invoked and iterated manually inside the main generator", async () => {
		//shows that a plain generator can be consumed imperatively — its yields
		//are observed by the outer generator rather than delegated up.
		const loadSteps = function* () {
			yield "step-1";
			yield "step-2";
			yield "step-3";
		};

		const visited: string[] = [];
		const tag = uniqueTag("manual-iter");
		customElements.define(
			tag,
			render(function* () {
				for (const step of loadSteps()) {
					visited.push(step);
				}
				yield () => html`<p>${visited.join(",")}</p>`;
			}),
		);

		const element = mount(tag);
		await sleep();

		expect(element.shadowRoot?.querySelector("p")?.textContent).toBe(
			"step-1,step-2,step-3",
		);

		element.remove();
	});

	test("async sub-generator delegated with yield* sequences async work", async () => {
		const loadInTwoStages: (element: BaseComponent) => AsyncGenerator =
			async function* () {
				yield html`<p>stage-1</p>`;
				await new Promise((resolve) => setTimeout(resolve, 10));
				yield () => html`<p>stage-2</p>`;
			};

		const tag = uniqueTag("async-delegate");
		customElements.define(
			tag,
			render(async function* (element) {
				yield* loadInTwoStages(element);
			}),
		);

		const element = mount(tag);
		await sleep();
		expect(element.shadowRoot?.querySelector("p")?.textContent).toBe("stage-1");

		await sleep(40);
		expect(element.shadowRoot?.querySelector("p")?.textContent).toBe("stage-2");

		element.remove();
	});
});

describe("framework-parity patterns", () => {
	test("slot projects light-DOM children into a shadow slot", async () => {
		const tag = uniqueTag("slotted");
		customElements.define(
			tag,
			render(function* () {
				yield () => html`<section><slot></slot></section>`;
			}),
		);

		const element = document.createElement(tag);
		const projected = document.createElement("span");
		projected.textContent = "from-light-dom";
		element.appendChild(projected);
		document.body.appendChild(element);
		await sleep();

		const slot = element.shadowRoot?.querySelector("slot") as HTMLSlotElement;
		const assigned = slot.assignedNodes() as Element[];
		expect(assigned).toContain(projected);

		element.remove();
	});

	test("named slots separate multiple projection targets", async () => {
		const tag = uniqueTag("named-slots");
		customElements.define(
			tag,
			render(function* () {
				yield () => html`<div>
					<header><slot name="title"></slot></header>
					<main><slot></slot></main>
				</div>`;
			}),
		);

		const element = document.createElement(tag);
		element.innerHTML = `<h1 slot="title">heading</h1><p>body</p>`;
		document.body.appendChild(element);
		await sleep();

		const titleSlot = element.shadowRoot?.querySelector(
			"slot[name=title]",
		) as HTMLSlotElement;
		const defaultSlot = element.shadowRoot?.querySelector(
			"slot:not([name])",
		) as HTMLSlotElement;

		expect(
			(titleSlot.assignedElements() as Element[]).map((node) => node.tagName),
		).toEqual(["H1"]);
		expect(
			(defaultSlot.assignedElements() as Element[]).map((node) => node.tagName),
		).toEqual(["P"]);

		element.remove();
	});

	test("two-way-style input binding: user input updates state and triggers re-render", async () => {
		const tag = uniqueTag("two-way");
		const ComponentClass = render(function* (element) {
			let value = "";
			const onInput = (event: Event) => {
				value = (event.target as HTMLInputElement).value;
				element.update();
			};
			yield () => html`<div>
				<input value=${value} onInput=${onInput} />
				<output>${value}</output>
			</div>`;
		});
		customElements.define(tag, ComponentClass);

		const element = mount(tag);
		await sleep();

		const input = element.shadowRoot?.querySelector("input") as HTMLInputElement;
		input.value = "typed";
		input.dispatchEvent(new Event("input", { bubbles: true }));
		await sleep();

		expect(element.shadowRoot?.querySelector("output")?.textContent).toBe(
			"typed",
		);

		element.remove();
	});

	test("context via bubbling events: provider answers a consumer request", async () => {
		//equivalent to React context: the nearest ancestor intercepts a
		//custom "request-context" event and writes the value into event.detail.
		type ThemeRequest = { theme?: string };

		const providerTag = uniqueTag("theme-provider");
		customElements.define(
			providerTag,
			render(function* (element) {
				element.addEventListener("request-theme", (event) => {
					(event as CustomEvent<ThemeRequest>).detail.theme = "dark";
					event.stopPropagation();
				});
				yield () => html`<div><slot></slot></div>`;
			}),
		);

		const consumerTag = uniqueTag("theme-consumer");
		customElements.define(
			consumerTag,
			render(function* (element) {
				//defer one microtask: connectedCallback order is only guaranteed
				//in tree order in spec-compliant engines, and the provider's
				//listener must be registered before we dispatch. Yielding a
				//resolved promise lets both setups complete before the request.
				yield Promise.resolve();
				const request: ThemeRequest = {};
				element.dispatchEvent(
					new CustomEvent("request-theme", {
						bubbles: true,
						composed: true,
						detail: request,
					}),
				);
				const theme = request.theme ?? "light";
				yield () => html`<span>theme:${theme}</span>`;
			}),
		);

		const provider = document.createElement(providerTag);
		const consumer = document.createElement(consumerTag);
		provider.appendChild(consumer);
		document.body.appendChild(provider);
		await sleep();

		expect(consumer.shadowRoot?.querySelector("span")?.textContent).toBe(
			"theme:dark",
		);

		provider.remove();
	});

	test("props helper coerces attributes, properties, and fallbacks", async () => {
		const tag = uniqueTag("props-helper");
		type ValidatedProps = {
			label: string;
			count: number;
			disabled: boolean;
			missing: string;
		};
		let captured: ValidatedProps | null = null;

		const ComponentClass = render(function* (element) {
			captured = props(element, {
				label: String,
				count: Number,
				disabled: Boolean,
				missing: [String, "fallback"],
			});
			yield () =>
				html`<p>${captured!.label}-${captured!.count}-${captured!.missing}</p>`;
		});
		customElements.define(tag, ComponentClass);

		const element = document.createElement(tag);
		element.setAttribute("label", "hello");
		element.setAttribute("count", "42");
		element.setAttribute("disabled", "");
		document.body.appendChild(element);
		await sleep();

		expect(captured).toEqual({
			label: "hello",
			count: 42,
			disabled: true,
			missing: "fallback",
		});
		expect(element.shadowRoot?.querySelector("p")?.textContent).toBe(
			"hello-42-fallback",
		);

		element.remove();
	});

	test("component instances mounted from the same class keep state isolated", async () => {
		const tag = uniqueTag("instance-isolation");
		const ComponentClass = render(function* (element) {
			let count = 0;
			element.addEventListener("bump", () => {
				count++;
				element.update();
			});
			yield () => html`<span>${count}</span>`;
		});
		customElements.define(tag, ComponentClass);

		const first = mount(tag);
		const second = mount(tag);
		const third = mount(tag);
		await sleep();

		first.dispatchEvent(new CustomEvent("bump"));
		first.dispatchEvent(new CustomEvent("bump"));
		first.dispatchEvent(new CustomEvent("bump"));
		second.dispatchEvent(new CustomEvent("bump"));
		await sleep();

		expect(first.shadowRoot?.querySelector("span")?.textContent).toBe("3");
		expect(second.shadowRoot?.querySelector("span")?.textContent).toBe("1");
		expect(third.shadowRoot?.querySelector("span")?.textContent).toBe("0");

		first.remove();
		second.remove();
		third.remove();
	});

	test("conditional rendering with null removes subtree without remounting siblings", async () => {
		const tag = uniqueTag("conditional-null");
		let show = true;

		const ComponentClass = render(function* () {
			yield () =>
				html`<div>
					<header>stable</header>
					${show ? html`<aside>visible</aside>` : null}
				</div>`;
		});
		customElements.define(tag, ComponentClass);

		const element = mount(tag) as InstanceType<typeof ComponentClass>;
		await sleep();
		const stableHeader = element.shadowRoot?.querySelector("header");
		expect(element.shadowRoot?.querySelector("aside")).not.toBeNull();

		show = false;
		await element.update();
		await sleep();

		expect(element.shadowRoot?.querySelector("aside")).toBeNull();
		expect(element.shadowRoot?.querySelector("header")).toBe(stableHeader);

		show = true;
		await element.update();
		await sleep();

		expect(element.shadowRoot?.querySelector("aside")?.textContent).toBe(
			"visible",
		);
		expect(element.shadowRoot?.querySelector("header")).toBe(stableHeader);

		element.remove();
	});

	test("render-prop pattern: parent passes a row renderer to a list child", async () => {
		//React's render-prop / Vue scoped-slot equivalent: the child consumes a
		//template factory supplied by the parent through a property binding.
		type RowRenderer = (item: string) => HTMLTemplate;

		const listTag = uniqueTag("renderprop-list");
		customElements.define(
			listTag,
			render(function* (element) {
				yield () => {
					const rows = (element as HTMLElement & { items?: string[] }).items ?? [];
					const renderRow =
						(element as HTMLElement & { row?: RowRenderer }).row ??
						((item) => html`<li>${item}</li>`);
					return html`<ul>
						${rows.map((item) => renderRow(item))}
					</ul>`;
				};
			}),
		);

		const hostTag = uniqueTag("renderprop-host");
		customElements.define(
			hostTag,
			render(function* () {
				const items = ["one", "two", "three"];
				const row: RowRenderer = (item) =>
					html`<li class="custom">item:${item}</li>`;
				yield () =>
					html`<${listTag} items=${items} row=${row}></${listTag}>`;
			}),
		);

		const element = mount(hostTag);
		await sleep();

		const renderedItems = element.shadowRoot
			?.querySelector(listTag)
			?.shadowRoot?.querySelectorAll("li.custom");
		expect(renderedItems?.length).toBe(3);
		expect(renderedItems?.[0].textContent).toBe("item:one");
		expect(renderedItems?.[2].textContent).toBe("item:three");

		element.remove();
	});

	test("slot re-projects children added or removed after first render", async () => {
		const tag = uniqueTag("slot-reproject");
		customElements.define(
			tag,
			render(function* () {
				yield () => html`<section><slot></slot></section>`;
			}),
		);

		const element = document.createElement(tag);
		const initial = document.createElement("span");
		initial.textContent = "first";
		element.appendChild(initial);
		document.body.appendChild(element);
		await sleep();

		const slot = element.shadowRoot?.querySelector("slot") as HTMLSlotElement;
		expect(slot.assignedNodes()).toContain(initial);

		const added = document.createElement("span");
		added.textContent = "second";
		element.appendChild(added);
		await sleep();

		expect(slot.assignedNodes()).toContain(added);
		expect(slot.assignedNodes().length).toBeGreaterThanOrEqual(2);

		initial.remove();
		await sleep();

		expect(slot.assignedNodes()).not.toContain(initial);
		expect(slot.assignedNodes()).toContain(added);

		element.remove();
	});

	test.skipIf("happyDOM" in globalThis)(
		"focus on nested child input survives parent re-render",
		async () => {
			//guards against the parent's content-binding update dropping the
			//child element (and therefore its focused descendant).
			const childTag = uniqueTag("focus-child");
			customElements.define(
				childTag,
				render(function* () {
					yield () => html`<input type="text" />`;
				}),
			);

			const parentTag = uniqueTag("focus-parent");
			let label = "one";
			const ParentClass = render(function* () {
				yield () =>
					html`<div><h1>${label}</h1><${childTag}></${childTag}></div>`;
			});
			customElements.define(parentTag, ParentClass);

			const element = mount(parentTag) as InstanceType<typeof ParentClass>;
			await sleep();

			const child = element.shadowRoot?.querySelector(childTag) as HTMLElement;
			const input = child.shadowRoot?.querySelector("input") as HTMLInputElement;
			input.focus();
			expect(child.shadowRoot?.activeElement).toBe(input);

			label = "two";
			await element.update();
			await sleep();

			expect(element.shadowRoot?.querySelector("h1")?.textContent).toBe("two");
			const sameInput = (
				element.shadowRoot?.querySelector(childTag) as HTMLElement
			).shadowRoot?.querySelector("input");
			expect(sameInput).toBe(input);
			expect(child.shadowRoot?.activeElement).toBe(input);

			element.remove();
		},
	);

	test("error thrown in nested child does not break the parent", async () => {
		const warnSpy = vi
			.spyOn(console, "warn")
			.mockImplementation(() => {});

		const childTag = uniqueTag("err-child");
		let shouldChildThrow = true;
		customElements.define(
			childTag,
			render(function* () {
				yield () => {
					if (shouldChildThrow) {
						throw new Error("child-boom");
					}
					return html`<span>child-ok</span>`;
				};
			}),
		);

		const parentTag = uniqueTag("err-parent");
		let parentLabel = "alpha";
		const ParentClass = render(function* () {
			yield () =>
				html`<div>
					<h1>${parentLabel}</h1>
					<${childTag}></${childTag}>
				</div>`;
		});
		customElements.define(parentTag, ParentClass);

		const element = mount(parentTag) as InstanceType<typeof ParentClass>;
		await sleep();

		//parent rendered fine
		expect(element.shadowRoot?.querySelector("h1")?.textContent).toBe("alpha");

		//child's shadow shows the error (see handleError in index.ts)
		const child = element.shadowRoot?.querySelector(childTag) as HTMLElement;
		expect(child.shadowRoot?.textContent).toContain("child-boom");

		//parent can still update; its own render is unaffected
		parentLabel = "beta";
		await element.update();
		await sleep();
		expect(element.shadowRoot?.querySelector("h1")?.textContent).toBe("beta");

		//child is permanently broken — handleError nulls #render, so update()
		//short-circuits. Even if the underlying throw condition is cleared,
		//the child does not self-recover.
		shouldChildThrow = false;
		await (child as BaseComponent).update();
		await sleep();
		expect(child.shadowRoot?.textContent).toContain("child-boom");

		element.remove();
		warnSpy.mockRestore();
	});
});
