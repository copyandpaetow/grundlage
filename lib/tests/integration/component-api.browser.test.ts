import { describe, expect, test } from "vitest";
import { html, component } from "../../src/index";

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

	test("applies a string value as an attribute and triggers a re-render", async () => {
		const tag = uniqueTag();

		const MyElement = component(function* (element) {
			yield () =>
				html`<span>${element.getAttribute("data-label") ?? "none"}</span>`;
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
			yield () => html`<p>data</p>`;
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
	//multi-expression comments go through the renderComment path — a branch otherwise
	//only exercised via internal calls
	let tagId = 0;
	const uniqueTag = () => `test-comment-${tagId++}-${Date.now()}`;

	test("updates the DOM comment text when expressions change", async () => {
		const tag = uniqueTag();
		let left = "foo";
		let right = "bar";

		const MyElement = component(function* () {
			yield () => html`<div><!-- ${left} and ${right} --></div>`;
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
