import { describe, expect, test, vi } from "vitest";
import { html, render } from "../../../index";

const sleep = (duration = 0) =>
	new Promise((resolve) => setTimeout(resolve, duration));

describe("attribute updates", () => {
	let tagId = 0;
	const uniqueTag = () => `test-attr-${tagId++}-${Date.now()}`;

	const mount = (tag: string): HTMLElement => {
		const element = document.createElement(tag);
		document.body.appendChild(element);
		return element;
	};

	const cleanup = (element: HTMLElement) => {
		element.remove();
	};

	test("updates a dynamic attribute value", async () => {
		const tag = uniqueTag();
		let cls = "red";

		const MyElement = render(function* () {
			yield () => html` <div class="${cls}"></div>`;
		});

		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		expect(
			element.shadowRoot?.querySelector("div")?.getAttribute("class"),
		).toBe("red");

		cls = "blue";
		await element.update();
		await sleep();

		expect(
			element.shadowRoot?.querySelector("div")?.getAttribute("class"),
		).toBe("blue");

		cleanup(element);
	});

	test("updates a multi-part attribute", async () => {
		const tag = uniqueTag();
		let first = "hello";
		let second = "world";

		const MyElement = render(function* () {
			yield () => html` <div class="${first} ${second}"></div>`;
		});

		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		expect(
			element.shadowRoot?.querySelector("div")?.getAttribute("class"),
		).toBe("hello world");

		first = "foo";
		await element.update();
		await sleep();

		expect(
			element.shadowRoot?.querySelector("div")?.getAttribute("class"),
		).toBe("foo world");

		cleanup(element);
	});

	test("toggles a boolean attribute", async () => {
		const tag = uniqueTag();
		let disabled = true;

		const MyElement = render(function* () {
			yield () => html` <button disabled="${disabled}">click</button>`;
		});

		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		const btn = element.shadowRoot?.querySelector("button");
		expect(btn?.hasAttribute("disabled")).toBe(true);

		disabled = false;
		await element.update();
		await sleep();

		expect(btn?.hasAttribute("disabled")).toBe(false);

		cleanup(element);
	});

	test("registers and updates event listeners", async () => {
		const tag = uniqueTag();
		const clicks: string[] = [];
		let handler = () => clicks.push("first");

		const MyElement = render(function* () {
			yield () => html` <button onclick="${handler}">click</button>`;
		});

		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		const btn = element.shadowRoot?.querySelector("button")!;
		btn.click();
		expect(clicks).toEqual(["first"]);

		handler = () => clicks.push("second");
		await element.update();
		await sleep();

		btn.click();
		expect(clicks).toEqual(["first", "second"]);

		cleanup(element);
	});

	test("expands an array into boolean attributes", async () => {
		const tag = uniqueTag();
		let attrs = ["disabled", "hidden"];

		const MyElement = render(function* () {
			yield () => html` <button ${attrs}>click</button>`;
		});

		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		const btn = element.shadowRoot?.querySelector("button")!;
		expect(btn.hasAttribute("disabled")).toBe(true);
		expect(btn.hasAttribute("hidden")).toBe(true);

		attrs = ["hidden"];
		await element.update();
		await sleep();

		expect(btn.hasAttribute("disabled")).toBe(false);
		expect(btn.hasAttribute("hidden")).toBe(true);

		cleanup(element);
	});

	test("a conditional bare scalar toggles a boolean attribute, empty branch adds none", async () => {
		const tag = uniqueTag();
		let enabled = true;

		const MyElement = render(function* () {
			yield () => html`<button ${enabled ? "" : "disabled"}>click</button>`;
		});

		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		const btn = element.shadowRoot?.querySelector("button")!;
		//empty branch: no attribute, and crucially no setAttribute("", "") crash
		expect(btn.hasAttribute("disabled")).toBe(false);
		expect(btn.getAttributeNames()).toEqual([]);

		enabled = false;
		await element.update();
		await sleep();
		expect(btn.hasAttribute("disabled")).toBe(true);

		enabled = true;
		await element.update();
		await sleep();
		expect(btn.hasAttribute("disabled")).toBe(false);

		cleanup(element);
	});

	test("expands an object into key-value attributes", async () => {
		const tag = uniqueTag();
		let attrs: Record<string, string> = { class: "red", id: "main" };

		const MyElement = render(function* () {
			yield () => html` <div ${attrs}>content</div>`;
		});

		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		const div = element.shadowRoot?.querySelector("div")!;
		expect(div.getAttribute("class")).toBe("red");
		expect(div.getAttribute("id")).toBe("main");

		attrs = { class: "blue", title: "hello" };
		await element.update();
		await sleep();

		expect(div.getAttribute("class")).toBe("blue");
		expect(div.hasAttribute("id")).toBe(false);
		expect(div.getAttribute("title")).toBe("hello");

		cleanup(element);
	});

	test("removes attribute when value is null", async () => {
		const tag = uniqueTag();
		let value: string | null = "visible";

		const MyElement = render(function* () {
			yield () => html`<div title="${value}">text</div>`;
		});

		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		const div = element.shadowRoot?.querySelector("div")!;
		expect(div.getAttribute("title")).toBe("visible");

		value = null;
		await element.update();
		await sleep();

		expect(div.hasAttribute("title")).toBe(false);

		cleanup(element);
	});

	test("removes attribute when value is undefined", async () => {
		const tag = uniqueTag();
		let value: string | undefined = "visible";

		const MyElement = render(function* () {
			yield () => html`<div title="${value}">text</div>`;
		});

		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		const div = element.shadowRoot?.querySelector("div")!;
		expect(div.getAttribute("title")).toBe("visible");

		value = undefined;
		await element.update();
		await sleep();

		expect(div.hasAttribute("title")).toBe(false);

		cleanup(element);
	});

	test("removes attribute when value is false", async () => {
		const tag = uniqueTag();
		let value: string | false = "yes";

		const MyElement = render(function* () {
			yield () => html`<div aria-hidden="${value}">text</div>`;
		});

		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		const div = element.shadowRoot?.querySelector("div")!;
		expect(div.getAttribute("aria-hidden")).toBe("yes");

		value = false;
		await element.update();
		await sleep();

		expect(div.hasAttribute("aria-hidden")).toBe(false);

		cleanup(element);
	});

	test("sets numeric attribute values", async () => {
		const tag = uniqueTag();
		let value = 5;

		const MyElement = render(function* () {
			yield () => html`<input tabindex="${value}" />`;
		});

		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		const input = element.shadowRoot?.querySelector("input")!;
		expect(input.getAttribute("tabindex")).toBe("5");

		value = 10;
		await element.update();
		await sleep();

		expect(input.getAttribute("tabindex")).toBe("10");

		cleanup(element);
	});

	test("removes event listener when handler is set to null", async () => {
		const tag = uniqueTag();
		const clicks: string[] = [];
		let handler: (() => void) | null = () => clicks.push("clicked");

		const MyElement = render(function* () {
			yield () => html`<button onclick="${handler}">click</button>`;
		});

		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		const btn = element.shadowRoot?.querySelector("button")!;
		btn.click();
		expect(clicks).toEqual(["clicked"]);

		handler = null;
		await element.update();
		await sleep();

		btn.click();
		// Should still be just one click since listener was removed
		expect(clicks).toEqual(["clicked"]);

		cleanup(element);
	});

	test("handles multiple event listeners on same element", async () => {
		const tag = uniqueTag();
		const events: string[] = [];

		const MyElement = render(function* () {
			yield () =>
				html`<button
					onclick="${() => events.push("click")}"
					onmouseenter="${() => events.push("enter")}"
				>
					btn
				</button>`;
		});

		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		const btn = element.shadowRoot?.querySelector("button")!;
		btn.click();
		btn.dispatchEvent(new MouseEvent("mouseenter"));

		expect(events).toEqual(["click", "enter"]);

		cleanup(element);
	});

	test("sets complex object as element property", async () => {
		const tag = uniqueTag();
		const data = { nested: { value: 42 } };

		const MyElement = render(function* () {
			yield () => html`<div data="${data}">text</div>`;
		});

		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		const div = element.shadowRoot?.querySelector("div")! as any;
		expect(div.data).toEqual({ nested: { value: 42 } });

		cleanup(element);
	});

	test("updates a complex object property", async () => {
		const tag = uniqueTag();
		let data: Record<string, unknown> = { nested: { value: 42 } };

		const MyElement = render(function* () {
			yield () => html`<div data="${data}">text</div>`;
		});

		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		const div = element.shadowRoot?.querySelector("div")! as any;
		expect(div.data).toEqual({ nested: { value: 42 } });

		data = { nested: { value: 99 }, extra: "hello" };
		await element.update();
		await sleep();

		expect(div.data).toEqual({ nested: { value: 99 }, extra: "hello" });

		cleanup(element);
	});

	test("updates from string attribute to object property", async () => {
		const tag = uniqueTag();
		let value: string | Record<string, unknown> = "simple";

		const MyElement = render(function* () {
			yield () => html`<div data="${value}">text</div>`;
		});

		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		const div = element.shadowRoot?.querySelector("div")! as any;
		expect(div.getAttribute("data")).toBe("simple");

		value = { nested: true };
		await element.update();
		await sleep();

		expect(div.data).toEqual({ nested: true });

		cleanup(element);
	});

	test("updates from object property to string attribute", async () => {
		const tag = uniqueTag();
		let value: string | Record<string, unknown> = { nested: true };

		const MyElement = render(function* () {
			yield () => html`<div data="${value}">text</div>`;
		});

		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		const div = element.shadowRoot?.querySelector("div")! as any;
		expect(div.data).toEqual({ nested: true });

		value = "simple";
		await element.update();
		await sleep();

		expect(div.getAttribute("data")).toBe("simple");

		cleanup(element);
	});

	test("sets array as element property", async () => {
		const tag = uniqueTag();
		let items = [1, 2, 3];

		const MyElement = render(function* () {
			yield () => html`<div items="${items}">text</div>`;
		});

		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		const div = element.shadowRoot?.querySelector("div")! as any;
		expect(div.items).toEqual([1, 2, 3]);

		items = [4, 5];
		await element.update();
		await sleep();

		expect(div.items).toEqual([4, 5]);

		cleanup(element);
	});

	test("removes object property when value becomes null", async () => {
		const tag = uniqueTag();
		let data: Record<string, unknown> | null = { key: "value" };

		const MyElement = render(function* () {
			yield () => html`<div data="${data}">text</div>`;
		});

		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		const div = element.shadowRoot?.querySelector("div")! as any;
		expect(div.data).toEqual({ key: "value" });

		data = null;
		await element.update();
		await sleep();

		expect(div.hasAttribute("data")).toBe(false);

		cleanup(element);
	});

	test("re-adds a previously removed attribute", async () => {
		const tag = uniqueTag();
		let value: string | null = "visible";

		const MyElement = render(function* () {
			yield () => html`<div title="${value}">text</div>`;
		});

		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		const div = element.shadowRoot?.querySelector("div")!;
		expect(div.getAttribute("title")).toBe("visible");

		value = null;
		await element.update();
		await sleep();

		expect(div.hasAttribute("title")).toBe(false);

		value = "back again";
		await element.update();
		await sleep();

		expect(div.getAttribute("title")).toBe("back again");

		cleanup(element);
	});

	test("handles empty string as attribute value", async () => {
		const tag = uniqueTag();
		let value = "";

		const MyElement = render(function* () {
			yield () => html`<div title="${value}">text</div>`;
		});

		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		const div = element.shadowRoot?.querySelector("div")!;
		expect(div.getAttribute("title")).toBe("");
		expect(div.hasAttribute("title")).toBe(true);

		value = "filled";
		await element.update();
		await sleep();

		expect(div.getAttribute("title")).toBe("filled");

		cleanup(element);
	});

	test("sets boolean true as empty attribute", async () => {
		const tag = uniqueTag();

		const MyElement = render(function* () {
			yield () => html`<button disabled="${true}">click</button>`;
		});

		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		const btn = element.shadowRoot?.querySelector("button")!;
		expect(btn.hasAttribute("disabled")).toBe(true);
		expect(btn.getAttribute("disabled")).toBe("true");

		cleanup(element);
	});

	test("handles dynamic attribute name", async () => {
		const tag = uniqueTag();
		let attrName = "title";

		const MyElement = render(function* () {
			yield () => html`<div ${attrName}="hello">text</div>`;
		});

		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		const div = element.shadowRoot?.querySelector("div")!;
		expect(div.getAttribute("title")).toBe("hello");

		cleanup(element);
	});

	test("handles dynamic attribute name change", async () => {
		const tag = uniqueTag();
		let attrName = "title";

		const MyElement = render(function* () {
			yield () => html`<div ${attrName}="hello">text</div>`;
		});

		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		const div = element.shadowRoot?.querySelector("div")!;
		expect(div.getAttribute("title")).toBe("hello");

		attrName = "id";
		await element.update();
		await sleep();

		expect(div.hasAttribute("title")).toBe(false);
		expect(div.getAttribute("id")).toBe("hello");

		cleanup(element);
	});

	test("handles expandable object with event listeners", async () => {
		const tag = uniqueTag();
		const clicks: string[] = [];
		let attrs: Record<string, unknown> = {
			class: "btn",
			onclick: () => clicks.push("clicked"),
		};

		const MyElement = render(function* () {
			yield () => html`<button ${attrs}>click</button>`;
		});

		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		const btn = element.shadowRoot?.querySelector("button")!;
		expect(btn.getAttribute("class")).toBe("btn");

		btn.click();
		expect(clicks).toEqual(["clicked"]);

		attrs = {
			class: "btn-primary",
			onclick: () => clicks.push("clicked again"),
		};
		await element.update();
		await sleep();

		expect(btn.getAttribute("class")).toBe("btn-primary");
		btn.click();
		expect(clicks).toEqual(["clicked", "clicked again"]);

		cleanup(element);
	});

	test("keeps an unchanged spread listener attached without re-binding it across renders", async () => {
		// the spread diff skips entries whose value reference is unchanged, so a
		// stable handler is neither detached nor reattached on update — only the
		// changed sibling attribute is touched.
		const tag = uniqueTag();
		const handler = () => {};
		let attrs: Record<string, unknown> = { class: "a", onclick: handler };

		const MyElement = render(function* () {
			yield () => html`<button ${attrs}>x</button>`;
		});

		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		const btn = element.shadowRoot?.querySelector("button")!;
		const addSpy = vi.spyOn(btn, "addEventListener");
		const removeSpy = vi.spyOn(btn, "removeEventListener");

		attrs = { class: "b", onclick: handler };
		await element.update();
		await sleep();

		expect(btn.getAttribute("class")).toBe("b");
		expect(addSpy).not.toHaveBeenCalled();
		expect(removeSpy).not.toHaveBeenCalled();

		cleanup(element);
	});

	test("handles multiple dynamic attributes on same element", async () => {
		const tag = uniqueTag();
		let cls = "red";
		let title = "hello";

		const MyElement = render(function* () {
			yield () => html`<div class="${cls}" title="${title}">text</div>`;
		});

		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		const div = element.shadowRoot?.querySelector("div")!;
		expect(div.getAttribute("class")).toBe("red");
		expect(div.getAttribute("title")).toBe("hello");

		cls = "blue";
		await element.update();
		await sleep();

		expect(div.getAttribute("class")).toBe("blue");
		expect(div.getAttribute("title")).toBe("hello");

		title = "world";
		await element.update();
		await sleep();

		expect(div.getAttribute("class")).toBe("blue");
		expect(div.getAttribute("title")).toBe("world");

		cleanup(element);
	});

	test("handles partially dynamic attribute key", async () => {
		const tag = uniqueTag();
		let suffix = "color";

		const MyElement = render(function* () {
			yield () => html`<div data-${suffix}="red">text</div>`;
		});

		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		const div = element.shadowRoot?.querySelector("div")!;
		expect(div.getAttribute("data-color")).toBe("red");

		cleanup(element);
	});

	test("updates partially dynamic attribute key", async () => {
		const tag = uniqueTag();
		let suffix = "color";

		const MyElement = render(function* () {
			yield () => html`<div data-${suffix}="red">text</div>`;
		});

		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		const div = element.shadowRoot?.querySelector("div")!;
		expect(div.getAttribute("data-color")).toBe("red");

		suffix = "size";
		await element.update();
		await sleep();

		expect(div.hasAttribute("data-color")).toBe(false);
		expect(div.getAttribute("data-size")).toBe("red");

		cleanup(element);
	});

	test("handles partially dynamic key with dynamic value", async () => {
		const tag = uniqueTag();
		let suffix = "color";
		let value = "red";

		const MyElement = render(function* () {
			yield () => html`<div data-${suffix}="${value}">text</div>`;
		});

		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		const div = element.shadowRoot?.querySelector("div")!;
		expect(div.getAttribute("data-color")).toBe("red");

		value = "blue";
		await element.update();
		await sleep();

		expect(div.getAttribute("data-color")).toBe("blue");

		suffix = "size";
		value = "large";
		await element.update();
		await sleep();

		expect(div.hasAttribute("data-color")).toBe(false);
		expect(div.getAttribute("data-size")).toBe("large");

		cleanup(element);
	});

	test("handles fully dynamic key and fully dynamic value", async () => {
		const tag = uniqueTag();
		let key = "title";
		let value: string | null = "hello";

		const MyElement = render(function* () {
			yield () => html`<div ${key}="${value}">text</div>`;
		});

		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		const div = element.shadowRoot?.querySelector("div")!;
		expect(div.getAttribute("title")).toBe("hello");

		key = "id";
		value = "main";
		await element.update();
		await sleep();

		expect(div.hasAttribute("title")).toBe(false);
		expect(div.getAttribute("id")).toBe("main");

		cleanup(element);
	});

	test("handles multi-part dynamic key", async () => {
		const tag = uniqueTag();
		let prefix = "data";
		let suffix = "value";

		const MyElement = render(function* () {
			yield () => html`<div ${prefix}-${suffix}="test">text</div>`;
		});

		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		const div = element.shadowRoot?.querySelector("div")!;
		expect(div.getAttribute("data-value")).toBe("test");

		prefix = "aria";
		suffix = "label";
		await element.update();
		await sleep();

		expect(div.hasAttribute("data-value")).toBe(false);
		expect(div.getAttribute("aria-label")).toBe("test");

		cleanup(element);
	});

	test("handles dynamic key with multi-part dynamic value", async () => {
		const tag = uniqueTag();
		let key = "class";
		let a = "foo";
		let b = "bar";

		const MyElement = render(function* () {
			yield () => html`<div ${key}="${a}-${b}">text</div>`;
		});

		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		const div = element.shadowRoot?.querySelector("div")!;
		expect(div.getAttribute("class")).toBe("foo-bar");

		a = "baz";
		await element.update();
		await sleep();

		expect(div.getAttribute("class")).toBe("baz-bar");

		key = "title";
		b = "qux";
		await element.update();
		await sleep();

		expect(div.hasAttribute("class")).toBe(false);
		expect(div.getAttribute("title")).toBe("baz-qux");

		cleanup(element);
	});

	test("removes attribute with dynamic key when value becomes null", async () => {
		const tag = uniqueTag();
		let key = "title";
		let value: string | null = "hello";

		const MyElement = render(function* () {
			yield () => html`<div ${key}="${value}">text</div>`;
		});

		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		const div = element.shadowRoot?.querySelector("div")!;
		expect(div.getAttribute("title")).toBe("hello");

		value = null;
		await element.update();
		await sleep();

		expect(div.hasAttribute("title")).toBe(false);

		value = "back";
		await element.update();
		await sleep();

		expect(div.getAttribute("title")).toBe("back");

		cleanup(element);
	});

	test("dynamic event-name attribute binds the handler as an IDL property", async () => {
		const tag = uniqueTag();
		const events: string[] = [];
		let eventName = "onclick";
		let handler = () => events.push("click");

		const MyElement = render(function* () {
			yield () => html`<button ${eventName}="${handler}">btn</button>`;
		});

		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		const btn = element.shadowRoot?.querySelector("button")!;
		// A fully-dynamic attribute name with a function value lowers to a
		// single-value attribute; a function is assigned as an IDL property (not
		// via addEventListener), so the native onclick fires.
		expect((btn as unknown as { onclick: unknown }).onclick).toBe(handler);
		btn.click();
		expect(events).toEqual(["click"]);

		eventName = "ondblclick";
		handler = () => events.push("dblclick");
		await element.update();
		await sleep();

		// The new name binds the new handler as its own property.
		expect((btn as unknown as { ondblclick: unknown }).ondblclick).toBe(handler);
		btn.dispatchEvent(new MouseEvent("dblclick"));
		expect(events).toContain("dblclick");

		cleanup(element);
	});

	test("handles partially dynamic key with boolean removal", async () => {
		const tag = uniqueTag();
		let suffix = "hidden";
		let value: string | false = "true";

		const MyElement = render(function* () {
			yield () => html`<div aria-${suffix}="${value}">text</div>`;
		});

		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		const div = element.shadowRoot?.querySelector("div")!;
		expect(div.getAttribute("aria-hidden")).toBe("true");

		value = false;
		await element.update();
		await sleep();

		expect(div.hasAttribute("aria-hidden")).toBe(false);

		cleanup(element);
	});

	test("switches from array to object expandable attributes", async () => {
		const tag = uniqueTag();
		let attrs: string[] | Record<string, string> = ["disabled"];

		const MyElement = render(function* () {
			yield () => html` <button ${attrs}>click</button>`;
		});

		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		const btn = element.shadowRoot?.querySelector("button")!;
		expect(btn.hasAttribute("disabled")).toBe(true);

		attrs = { class: "primary" };
		await element.update();
		await sleep();

		expect(btn.hasAttribute("disabled")).toBe(false);
		expect(btn.getAttribute("class")).toBe("primary");

		cleanup(element);
	});

	test("expandable expression resolves a primitive string to a boolean attribute", async () => {
		// The expandable path has three shapes: array, plain object, and a single
		// primitive string. The string case is the fallback in updateExpandable /
		// removeExpandable. `<button ${name}>` where `name` is just `"disabled"` should
		// land as a boolean attribute, and renaming should remove the old one.
		const tag = uniqueTag();
		let attribute: string = "disabled";

		const MyElement = render(function* () {
			yield () => html`<button ${attribute}>click</button>`;
		});

		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		const button = element.shadowRoot?.querySelector("button")!;
		expect(button.hasAttribute("disabled")).toBe(true);
		expect(button.getAttribute("disabled")).toBe("");

		attribute = "hidden";
		await element.update();
		await sleep();

		expect(button.hasAttribute("disabled")).toBe(false);
		expect(button.hasAttribute("hidden")).toBe(true);

		cleanup(element);
	});

	test("expandable switches from primitive string to array and back", async () => {
		// A regression guard for the expandable dispatcher: the string fallback
		// must hand off to the array branch (and vice versa) without leaving the
		// previous attribute(s) behind.
		const tag = uniqueTag();
		let attributes: string | Array<string> = "disabled";

		const MyElement = render(function* () {
			yield () => html`<button ${attributes}>click</button>`;
		});

		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		const button = element.shadowRoot?.querySelector("button")!;
		expect(button.hasAttribute("disabled")).toBe(true);

		attributes = ["hidden", "autofocus"];
		await element.update();
		await sleep();

		expect(button.hasAttribute("disabled")).toBe(false);
		expect(button.hasAttribute("hidden")).toBe(true);
		expect(button.hasAttribute("autofocus")).toBe(true);

		attributes = "readonly";
		await element.update();
		await sleep();

		expect(button.hasAttribute("hidden")).toBe(false);
		expect(button.hasAttribute("autofocus")).toBe(false);
		expect(button.hasAttribute("readonly")).toBe(true);

		cleanup(element);
	});

	test("boolean attribute with multi-part dynamic key", async () => {
		// updateAttribute's DYNAMIC_NAME_BOOLEAN shape (updateDynamicNameBoolean):
		// the binding has multiple key fragments and no
		// value half. `<div data-${suffix}>` with no `="..."`. The old key must
		// be removed when the suffix flips.
		const tag = uniqueTag();
		let suffix = "ready";

		const MyElement = render(function* () {
			yield () => html`<div data-${suffix}>text</div>`;
		});

		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		const div = element.shadowRoot?.querySelector("div")!;
		expect(div.hasAttribute("data-ready")).toBe(true);
		expect(div.getAttribute("data-ready")).toBe("");

		suffix = "open";
		await element.update();
		await sleep();

		expect(div.hasAttribute("data-ready")).toBe(false);
		expect(div.hasAttribute("data-open")).toBe(true);

		cleanup(element);
	});
});
