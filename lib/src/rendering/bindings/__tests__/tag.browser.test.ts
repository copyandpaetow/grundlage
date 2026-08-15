import { describe, expect, test } from "vitest";
import { html, component } from "../../../index";

const sleep = (duration = 0) =>
	new Promise((resolve) => setTimeout(resolve, duration));

describe("tag updates", () => {
	let tagId = 0;
	const uniqueTag = () => `test-tag-${tagId++}-${Date.now()}`;

	const mount = (tag: string): HTMLElement => {
		const element = document.createElement(tag);
		document.body.appendChild(element);
		return element;
	};

	const cleanup = (element: HTMLElement) => {
		element.remove();
	};

	test("renders a dynamic tag name", async () => {
		const tag = uniqueTag();
		let tagName = "div";

		const MyElement = component(function* () {
			yield () => html`
                <${tagName}>hello</${tagName}>`;
		});

		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		const child = element.shadowRoot?.querySelector("div");
		expect(child).not.toBeNull();
		expect(child?.textContent).toBe("hello");

		cleanup(element);
	});

	test("switches the tag name and preserves content", async () => {
		const tag = uniqueTag();
		let tagName = "div";

		const MyElement = component(function* () {
			yield () => html`
                <${tagName}>content</${tagName}>`;
		});

		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		expect(element.shadowRoot?.querySelector("div")).not.toBeNull();

		tagName = "span";
		await element.update();
		await sleep();

		expect(element.shadowRoot?.querySelector("div")).toBeNull();
		const span = element.shadowRoot?.querySelector("span");
		expect(span).not.toBeNull();
		expect(span?.textContent).toBe("content");

		cleanup(element);
	});

	test("preserves attributes when switching tags", async () => {
		const tag = uniqueTag();
		let tagName = "div";

		const MyElement = component(function* () {
			yield () => html`
                <${tagName} class="box" id="main">text</${tagName}>`;
		});

		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		const div = element.shadowRoot?.querySelector("div")!;
		expect(div.getAttribute("class")).toBe("box");
		expect(div.getAttribute("id")).toBe("main");

		tagName = "section";
		await element.update();
		await sleep();

		const section = element.shadowRoot?.querySelector("section")!;
		expect(section).not.toBeNull();
		expect(section.getAttribute("class")).toBe("box");
		expect(section.getAttribute("id")).toBe("main");

		cleanup(element);
	});

	test("preserves child nodes when switching tags", async () => {
		const tag = uniqueTag();
		let tagName = "div";

		const MyElement = component(function* () {
			yield () =>
				html`
                    <${tagName}><span>child1</span><span>child2</span></${tagName}>`;
		});

		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		const div = element.shadowRoot?.querySelector("div")!;
		expect(div.querySelectorAll("span").length).toBe(2);

		tagName = "article";
		await element.update();
		await sleep();

		const article = element.shadowRoot?.querySelector("article")!;
		expect(article).not.toBeNull();
		expect(article.querySelectorAll("span").length).toBe(2);
		expect(article.querySelector("span")?.textContent).toBe("child1");

		cleanup(element);
	});

	test("re-attaches event listeners after tag switch", async () => {
		const tag = uniqueTag();
		let tagName = "button";
		const clicks: string[] = [];
		const handler = () => clicks.push("clicked");

		const MyElement = component(function* () {
			yield () =>
				html`
                    <${tagName} onclick="${handler}">click me</${tagName}>`;
		});

		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		const btn = element.shadowRoot?.querySelector("button")!;
		btn.click();
		expect(clicks).toEqual(["clicked"]);

		tagName = "div";
		await element.update();
		await sleep();

		const div = element.shadowRoot?.querySelector("div")!;
		div.click();
		expect(clicks).toEqual(["clicked", "clicked"]);

		cleanup(element);
	});

	test.skipIf("happyDOM" in globalThis)(
		"preserves focus when switching tags with focused child",
		async () => {
			const tag = uniqueTag();
			let tagName = "div";

			const MyElement = component(function* () {
				yield () =>
					html`
                    <${tagName}><input type="text"/></${tagName}>`;
			});

			customElements.define(tag, MyElement);
			const element = mount(tag) as InstanceType<typeof MyElement>;
			await sleep();

			const input = element.shadowRoot?.querySelector("input")!;
			input.focus();
			expect(element.shadowRoot?.activeElement).toBe(input);

			tagName = "section";
			await element.update();
			await sleep();

			const newInput = element.shadowRoot?.querySelector("input")!;
			expect(newInput).not.toBeNull();
			expect(element.shadowRoot?.activeElement).toBe(newInput);

			cleanup(element);
		},
	);

	test("does not replace element when tag name is unchanged", async () => {
		const tag = uniqueTag();
		const tagName = "div";

		const MyElement = component(function* () {
			yield () => html`
                <${tagName}>stable</${tagName}>`;
		});

		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		const div = element.shadowRoot?.querySelector("div")!;

		await element.update();
		await sleep();

		expect(element.shadowRoot?.querySelector("div")).toBe(div);

		cleanup(element);
	});

	test("tag swap concurrent with attribute change lands new values on the new element", async () => {
		//the swap replaces the element, re-points every related attribute target at the new one and
		//marks them dirty for the next flush. A wrong order leaves the new element carrying the old
		//value, or the old element receiving the new one, visible only through the DOM
		const tag = uniqueTag();
		let tagName = "div";
		let label = "first";

		const MyElement = component(function* () {
			yield () => html`
                <${tagName} data-label="${label}">content</${tagName}>`;
		});

		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		expect(
			element.shadowRoot?.querySelector("div")?.getAttribute("data-label"),
		).toBe("first");

		tagName = "section";
		label = "second";
		await element.update();
		await sleep();

		const section = element.shadowRoot?.querySelector("section")!;
		expect(section).not.toBeNull();
		expect(section.getAttribute("data-label")).toBe("second");
		expect(element.shadowRoot?.querySelector("div")).toBeNull();

		cleanup(element);
	});

	test("tag swap with concurrent content change updates the inner text on the new element", async () => {
		//the content binding sits inside the dynamic tag, and a rewrap keeps the marker comments inside
		//it, so the content update still finds its anchor on the new element's child list
		const tag = uniqueTag();
		let tagName = "div";
		let text = "before";

		const MyElement = component(function* () {
			yield () => html`
                <${tagName}>${text}</${tagName}>`;
		});

		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		expect(element.shadowRoot?.querySelector("div")?.textContent).toContain(
			"before",
		);

		tagName = "article";
		text = "after";
		await element.update();
		await sleep();

		const article = element.shadowRoot?.querySelector("article")!;
		expect(article).not.toBeNull();
		expect(article.textContent).toContain("after");

		cleanup(element);
	});

	test("event handler is reattached after a tag swap that also changes the handler", async () => {
		//`onclick="${fn}"` compiles to a static EVENT binding and a listener is not copyable off
		//element.attributes, so the swap has to carry the binding itself onto the new element for the
		//changed-handler path to install it
		const tag = uniqueTag();
		let tagName = "button";
		const clicks: string[] = [];
		let handler = () => clicks.push("first");

		const MyElement = component(function* () {
			yield () =>
				html`
                    <${tagName} onclick="${handler}">click me</${tagName}>`;
		});

		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		element.shadowRoot?.querySelector("button")?.click();
		expect(clicks).toEqual(["first"]);

		tagName = "div";
		handler = () => clicks.push("second");
		await element.update();
		await sleep();

		element.shadowRoot?.querySelector("div")?.click();
		expect(clicks).toEqual(["first", "second"]);

		cleanup(element);
	});

	test("static event listener survives a tag swap when the handler reference is unchanged", async () => {
		//with an identical handler the event gate returns early, so the listener only lands on the new
		//element if the swap carried the EVENT binding across
		const tag = uniqueTag();
		let tagName = "button";
		const clicks: string[] = [];
		const handler = () => clicks.push("hit"); //same reference before and after the swap

		const MyElement = component(function* () {
			yield () => html`<${tagName} onclick="${handler}">click me</${tagName}>`;
		});

		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		element.shadowRoot?.querySelector("button")?.click();
		expect(clicks).toEqual(["hit"]);

		tagName = "div";
		await element.update();
		await sleep();

		expect(element.shadowRoot?.querySelector("button")).toBeNull();
		element.shadowRoot?.querySelector("div")?.click();
		expect(clicks).toEqual(["hit", "hit"]);

		cleanup(element);
	});

	test("an unchanged handler is not detached and re-added on a plain update", async () => {
		//the gate: a no-op update must do zero listener ops on the stable element
		const tag = uniqueTag();
		const handler = () => {};

		const MyElement = component(function* () {
			yield () => html`<button onclick="${handler}">click me</button>`;
		});

		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		const button = element.shadowRoot?.querySelector("button")!;
		let adds = 0;
		let removes = 0;
		const realAdd = button.addEventListener.bind(button);
		const realRemove = button.removeEventListener.bind(button);
		button.addEventListener = ((...args: Parameters<typeof realAdd>) => {
			adds++;
			return realAdd(...args);
		}) as typeof button.addEventListener;
		button.removeEventListener = ((...args: Parameters<typeof realRemove>) => {
			removes++;
			return realRemove(...args);
		}) as typeof button.removeEventListener;

		await element.update();
		await sleep();

		expect(adds).toBe(0);
		expect(removes).toBe(0);

		cleanup(element);
	});

	test("switches between multiple tag names", async () => {
		const tag = uniqueTag();
		let tagName = "h1";

		const MyElement = component(function* () {
			yield () => html`
                <${tagName}>heading</${tagName}>`;
		});

		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		expect(element.shadowRoot?.querySelector("h1")).not.toBeNull();

		tagName = "h2";
		await element.update();
		await sleep();
		expect(element.shadowRoot?.querySelector("h2")).not.toBeNull();
		expect(element.shadowRoot?.querySelector("h1")).toBeNull();

		tagName = "h3";
		await element.update();
		await sleep();
		expect(element.shadowRoot?.querySelector("h3")).not.toBeNull();
		expect(element.shadowRoot?.querySelector("h2")).toBeNull();
		expect(element.shadowRoot?.querySelector("h3")?.textContent).toBe(
			"heading",
		);

		cleanup(element);
	});

	test("carried props arrive before the swapped-in element mounts", async () => {
		const childTag = uniqueTag();
		customElements.define(
			childTag,
			component(
				function* ({ items }) {
					yield () => html`<span>${items.length}</span>`;
				},
				{
					props: {
						items: [(incoming: unknown) => incoming as Array<unknown>, []],
					},
				},
			),
		);

		const tag = uniqueTag();
		let tagName = "div";
		const rows = ["a", "b"];

		const MyElement = component(function* () {
			yield () => html`<${tagName} items=${rows}></${tagName}>`;
		});

		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		tagName = childTag;
		await element.update();
		await sleep();

		const child = element.shadowRoot?.querySelector(childTag);
		expect(child?.shadowRoot?.textContent).toContain("2");

		cleanup(element);
	});
});
