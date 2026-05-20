import { describe, expect, test } from "vitest";
import { html, render } from "../index";

const sleep = (duration = 0) =>
	new Promise((resolve) => setTimeout(resolve, duration));

describe("root-template host attributes", () => {
	let tagId = 0;
	const uniqueTag = () => `test-host-${tagId++}-${Date.now()}`;

	const mount = (tag: string): HTMLElement => {
		const element = document.createElement(tag);
		document.body.appendChild(element);
		return element;
	};

	const cleanup = (element: HTMLElement) => {
		element.remove();
	};

	test("static host attribute lands on the component element", async () => {
		const tag = uniqueTag();
		const MyElement = render(function* () {
			yield () =>
				html`<template class="card"><p>hi</p></template>`;
		});
		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		expect(element.getAttribute("class")).toBe("card");
		expect(element.shadowRoot?.querySelector("p")?.textContent).toBe("hi");
		expect(element.shadowRoot?.querySelector("template")).toBeNull();

		cleanup(element);
	});

	test("dynamic host attribute lands on the component element", async () => {
		const tag = uniqueTag();
		const MyElement = render(function* () {
			yield () => html`<template id="${"host-1"}"><p>hi</p></template>`;
		});
		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		expect(element.getAttribute("id")).toBe("host-1");

		cleanup(element);
	});

	test("dynamic host attribute updates between renders", async () => {
		const tag = uniqueTag();
		let role = "dialog";
		const MyElement = render(function* () {
			yield () => html`<template role="${role}"><p>hi</p></template>`;
		});
		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		expect(element.getAttribute("role")).toBe("dialog");

		role = "alertdialog";
		await element.update();
		await sleep();

		expect(element.getAttribute("role")).toBe("alertdialog");

		cleanup(element);
	});

	test("static and dynamic host attributes coexist on the host", async () => {
		const tag = uniqueTag();
		let dynamicId = "first";
		const MyElement = render(function* () {
			yield () =>
				html`<template class="card" id="${dynamicId}" role="region"><p>hi</p></template>`;
		});
		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		expect(element.getAttribute("class")).toBe("card");
		expect(element.getAttribute("id")).toBe("first");
		expect(element.getAttribute("role")).toBe("region");

		dynamicId = "second";
		await element.update();
		await sleep();

		expect(element.getAttribute("class")).toBe("card");
		expect(element.getAttribute("id")).toBe("second");
		expect(element.getAttribute("role")).toBe("region");

		cleanup(element);
	});

	test("boolean static host attribute lands as a present attribute", async () => {
		const tag = uniqueTag();
		const MyElement = render(function* () {
			yield () => html`<template hidden><p>hi</p></template>`;
		});
		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		expect(element.hasAttribute("hidden")).toBe(true);

		cleanup(element);
	});

	test("multi-part dynamic host attribute resolves into a single value", async () => {
		const tag = uniqueTag();
		let first = "alpha";
		let second = "beta";
		const MyElement = render(function* () {
			yield () =>
				html`<template class="${first} ${second}"><p>hi</p></template>`;
		});
		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		expect(element.getAttribute("class")).toBe("alpha beta");

		first = "gamma";
		await element.update();
		await sleep();

		expect(element.getAttribute("class")).toBe("gamma beta");

		cleanup(element);
	});

	test("expandable object host binding fans out into individual attributes", async () => {
		const tag = uniqueTag();
		let attrs: Record<string, string> = { id: "first", role: "dialog" };
		const MyElement = render(function* () {
			yield () => html`<template ${attrs}><p>hi</p></template>`;
		});
		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		expect(element.getAttribute("id")).toBe("first");
		expect(element.getAttribute("role")).toBe("dialog");

		attrs = { id: "second", role: "alertdialog" };
		await element.update();
		await sleep();

		expect(element.getAttribute("id")).toBe("second");
		expect(element.getAttribute("role")).toBe("alertdialog");

		cleanup(element);
	});

	test("host attribute does not leak into the shadow DOM", async () => {
		const tag = uniqueTag();
		const MyElement = render(function* () {
			yield () =>
				html`<template class="card"><p>hi</p></template>`;
		});
		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		//the static attr lowered into a binding must target the host, not get serialized as a child element attribute
		expect(element.shadowRoot?.querySelector("[class='card']")).toBeNull();

		cleanup(element);
	});

	test("inner element with a class attribute is not confused with the host", async () => {
		const tag = uniqueTag();
		const MyElement = render(function* () {
			yield () =>
				html`<template class="host-cls"><p class="inner-cls">hi</p></template>`;
		});
		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		expect(element.getAttribute("class")).toBe("host-cls");
		expect(
			element.shadowRoot?.querySelector("p")?.getAttribute("class"),
		).toBe("inner-cls");

		cleanup(element);
	});

	test("templates without a root template do not touch the host", async () => {
		const tag = uniqueTag();
		const MyElement = render(function* () {
			yield () => html`<div class="just-a-child"></div>`;
		});
		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		//a regular template should not synthesize any host bindings
		expect(element.attributes).toHaveLength(0);

		cleanup(element);
	});
});
