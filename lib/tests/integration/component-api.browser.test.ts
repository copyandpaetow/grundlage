import { describe, expect, test } from "vitest";
import { html, component, prop } from "../../src/index";

const sleep = (duration = 0) =>
	new Promise((resolve) => setTimeout(resolve, duration));

describe("BaseComponent.setProp", () => {
	let tagId = 0;
	const uniqueTag = () => `test-set-prop-${tagId++}-${Date.now()}`;

	const mount = (tag: string): HTMLElement => {
		const element = document.createElement(tag);
		document.body.appendChild(element);
		return element;
	};

	test("applies a string value as an attribute and triggers an update", async () => {
		const tag = uniqueTag();

		const MyElement = component(function* ({ host: element }) {
			yield function* () {
				yield html`<span
					>${element.getAttribute("data-label") ?? "none"}</span
				>`;
			};
		});

		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		expect(element.shadowRoot?.querySelector("span")?.textContent).toBe("none");

		element.setProp("data-label", "hello");
		await sleep(50);

		expect(element.getAttribute("data-label")).toBe("hello");
		expect(element.shadowRoot?.querySelector("span")?.textContent).toBe(
			"hello",
		);

		element.remove();
	});

	test("assigns complex values as element properties", async () => {
		const tag = uniqueTag();

		const MyElement = component(function* () {
			yield function* () {
				yield html`<p>data</p>`;
			};
		});

		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement> & {
			config?: unknown;
		};
		await sleep();

		const config = { nested: { value: 1 } };
		element.setProp("config", config);
		await sleep();

		expect(element.config).toBe(config);

		element.remove();
	});
});

describe("dynamic comment bindings", () => {
	//multi-expression comments go through the commitComment path — a branch otherwise
	//only exercised via internal calls
	let tagId = 0;
	const uniqueTag = () => `test-comment-${tagId++}-${Date.now()}`;

	test("updates the DOM comment text when expressions change", async () => {
		const tag = uniqueTag();
		const key = "pair";
		let left = "foo";
		let right = "bar";

		//the first dynamic comment is the list key and is stripped, so the comment
		//under test has to sit after it
		const MyElement = component(function* () {
			yield function* () {
				yield html`<!--${key}-->
					<div><!-- ${left} and ${right} --></div>`;
			};
		});

		customElements.define(tag, MyElement);
		const element = document.createElement(tag) as InstanceType<
			typeof MyElement
		>;
		document.body.appendChild(element);
		await sleep();

		const findDynamicComment = () => {
			const walker = document.createTreeWalker(
				element.shadowRoot!,
				NodeFilter.SHOW_COMMENT,
			);
			let node: Node | null;
			while ((node = walker.nextNode())) {
				//markers start with the "^.^" identifier — ignore them
				if (!(node as Comment).data.startsWith("^.^")) {
					return node as Comment;
				}
			}
			return null;
		};

		expect(findDynamicComment()?.data).toContain("foo and bar");

		left = "baz";
		right = "qux";
		await element.update();
		await sleep();

		expect(findDynamicComment()?.data).toContain("baz and qux");

		element.remove();
	});
});

describe("component() input validation", () => {
	test("a plain function throws a naming error at definition time", () => {
		expect(() => component((() => html`<p>x</p>`) as never)).toThrow(
			/generator function/,
		);
	});

	test("an async non-generator function throws at definition time", () => {
		expect(() => component((async () => {}) as never)).toThrow(
			/generator function/,
		);
	});

	test("a sync generator function is accepted", () => {
		expect(() => component(function* () {})).not.toThrow();
	});

	test("an async generator function throws with the remedy", () => {
		//the type layer rejects it, which is what the runtime check is for
		expect(() => component(async function* () {} as never)).toThrow(
			"yield each promise",
		);
	});
});

describe("BaseComponent.setProp on a declared prop", () => {
	let tagId = 0;
	const uniqueTag = () => `test-set-prop-declared-${tagId++}-${Date.now()}`;

	const mountWithRunCounter = async (
		tag: string,
	): Promise<{ element: HTMLElement; runCount: () => number }> => {
		let runs = 0;
		customElements.define(
			tag,
			component(
				function* () {
					yield function* () {
						runs++;
						yield html`<span>painted</span>`;
					};
				},
				{ props: { label: prop.attribute(String, "start") } },
			),
		);
		const element = document.createElement(tag);
		document.body.appendChild(element);
		await sleep();
		return { element, runCount: () => runs };
	};

	test("a refused value does not trigger an update", async () => {
		const tag = uniqueTag();
		let runs = 0;
		customElements.define(
			tag,
			component(
				function* () {
					yield function* () {
						runs++;
						yield html`<span>painted</span>`;
					};
				},
				{
					props: {
						evenOnly: prop.attribute(
							(incoming: unknown) =>
								Number(incoming) % 2 === 0 ? Number(incoming) : undefined,
							0,
						),
					},
				},
			),
		);
		const element = document.createElement(tag) as HTMLElement & {
			setProp: (name: string, value: unknown) => void;
		};
		document.body.appendChild(element);
		await sleep();
		const runsAfterMount = runs;

		element.setProp("evenOnly", 3);
		await sleep(50);

		expect(runs).toBe(runsAfterMount);
		element.remove();
	});

	test("re-writing the same primitive does not trigger an update", async () => {
		const tag = uniqueTag();
		const { element, runCount } = await mountWithRunCounter(tag);
		const setProp = (
			element as HTMLElement & {
				setProp: (name: string, value: unknown) => void;
			}
		).setProp.bind(element);

		setProp("label", "next");
		await sleep(50);
		const runsAfterFirstWrite = runCount();

		setProp("label", "next");
		await sleep(50);

		expect(runCount()).toBe(runsAfterFirstWrite);
		element.remove();
	});
});
