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
			yield () => html`<template class="card"><p>hi</p></template>`;
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
				html`<template class="card" id="${dynamicId}" role="region"
					><p>hi</p></template
				>`;
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
			yield () => html`<template class="card"><p>hi</p></template>`;
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
		expect(element.shadowRoot?.querySelector("p")?.getAttribute("class")).toBe(
			"inner-cls",
		);

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

describe("root-template host attribute cleanup across template swaps", () => {
	//these tests pin the contract that the *host* element behaves like the rest of the rendered tree: when a render returns a template whose host bindings differ from the previous one, leftover host attributes from the previous template must not survive
	//without cleanup, swapping `<template class="card">` → `<template id="hero">` would leave `class="card"` stuck on the host alongside the new `id="hero"`
	let tagId = 0;
	const uniqueTag = () => `test-host-swap-${tagId++}-${Date.now()}`;

	const mount = (tag: string): HTMLElement => {
		const element = document.createElement(tag);
		document.body.appendChild(element);
		return element;
	};

	const cleanup = (element: HTMLElement) => {
		element.remove();
	};

	test("static host attribute from the previous template is removed when the new template does not declare it", async () => {
		const tag = uniqueTag();
		let showFirst = true;
		const MyElement = render(function* () {
			yield () =>
				showFirst
					? html`<template class="card"><p>a</p></template>`
					: html`<template id="hero"><p>b</p></template>`;
		});
		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		expect(element.getAttribute("class")).toBe("card");
		expect(element.hasAttribute("id")).toBe(false);

		showFirst = false;
		await element.update();
		await sleep();

		expect(element.hasAttribute("class")).toBe(false);
		expect(element.getAttribute("id")).toBe("hero");

		cleanup(element);
	});

	test("multiple static host attributes are all cleared when the next template carries none of them", async () => {
		const tag = uniqueTag();
		let showFirst = true;
		const MyElement = render(function* () {
			yield () =>
				showFirst
					? html`<template class="card" role="dialog" data-kind="x"
							><p>a</p></template
						>`
					: html`<template aria-label="other"><p>b</p></template>`;
		});
		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		expect(element.getAttribute("class")).toBe("card");
		expect(element.getAttribute("role")).toBe("dialog");
		expect(element.getAttribute("data-kind")).toBe("x");

		showFirst = false;
		await element.update();
		await sleep();

		expect(element.hasAttribute("class")).toBe(false);
		expect(element.hasAttribute("role")).toBe(false);
		expect(element.hasAttribute("data-kind")).toBe(false);
		expect(element.getAttribute("aria-label")).toBe("other");

		cleanup(element);
	});

	test("shared host attribute name keeps the new value when both templates declare it", async () => {
		//both templates write `class`, but at different source positions, so the templateHash differs and renderTemplate takes the swap path
		//the post-swap value must be the new template's value, not stale from the previous one
		const tag = uniqueTag();
		let showFirst = true;
		const MyElement = render(function* () {
			yield () =>
				showFirst
					? html`<template class="card"><p>a</p></template>`
					: html`<template class="hero"><p>b</p></template>`;
		});
		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		expect(element.getAttribute("class")).toBe("card");

		showFirst = false;
		await element.update();
		await sleep();

		expect(element.getAttribute("class")).toBe("hero");

		cleanup(element);
	});

	test("dynamic host attribute from the previous template is removed when the new template does not declare it", async () => {
		const tag = uniqueTag();
		let showFirst = true;
		const dynamicId = "first";
		const dynamicRole = "alertdialog";
		const MyElement = render(function* () {
			yield () =>
				showFirst
					? html`<template id="${dynamicId}"><p>a</p></template>`
					: html`<template role="${dynamicRole}"><p>b</p></template>`;
		});
		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		expect(element.getAttribute("id")).toBe("first");
		expect(element.hasAttribute("role")).toBe(false);

		showFirst = false;
		await element.update();
		await sleep();

		expect(element.hasAttribute("id")).toBe(false);
		expect(element.getAttribute("role")).toBe("alertdialog");

		cleanup(element);
	});

	test("swap from a root template to a non-root template removes every host attribute", async () => {
		const tag = uniqueTag();
		let showRoot = true;
		const MyElement = render(function* () {
			yield () =>
				showRoot
					? html`<template class="card" role="dialog"><p>a</p></template>`
					: html`<div>plain</div>`;
		});
		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		expect(element.getAttribute("class")).toBe("card");
		expect(element.getAttribute("role")).toBe("dialog");

		showRoot = false;
		await element.update();
		await sleep();

		expect(element.attributes).toHaveLength(0);
		expect(element.shadowRoot?.querySelector("div")?.textContent).toBe("plain");

		cleanup(element);
	});

	test("swap from a non-root template to a root template applies the new host attributes", async () => {
		const tag = uniqueTag();
		let showRoot = false;
		const MyElement = render(function* () {
			yield () =>
				showRoot
					? html`<template class="card" role="dialog"><p>a</p></template>`
					: html`<div>plain</div>`;
		});
		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		expect(element.attributes).toHaveLength(0);

		showRoot = true;
		await element.update();
		await sleep();

		expect(element.getAttribute("class")).toBe("card");
		expect(element.getAttribute("role")).toBe("dialog");

		cleanup(element);
	});

	test("expandable object host binding from the previous template is cleared on swap", async () => {
		const tag = uniqueTag();
		let showFirst = true;
		const firstAttrs: Record<string, string> = { id: "first", role: "dialog" };
		const secondAttrs: Record<string, string> = { "aria-label": "other" };
		const MyElement = render(function* () {
			yield () =>
				showFirst
					? html`<template ${firstAttrs}><p>a</p></template>`
					: html`<template ${secondAttrs}><p>b</p></template>`;
		});
		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		expect(element.getAttribute("id")).toBe("first");
		expect(element.getAttribute("role")).toBe("dialog");

		showFirst = false;
		await element.update();
		await sleep();

		expect(element.hasAttribute("id")).toBe(false);
		expect(element.hasAttribute("role")).toBe(false);
		expect(element.getAttribute("aria-label")).toBe("other");

		cleanup(element);
	});

	test("boolean static host attribute from the previous template is removed on swap", async () => {
		const tag = uniqueTag();
		let showFirst = true;
		const MyElement = render(function* () {
			yield () =>
				showFirst
					? html`<template hidden><p>a</p></template>`
					: html`<template class="visible"><p>b</p></template>`;
		});
		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		expect(element.hasAttribute("hidden")).toBe(true);

		showFirst = false;
		await element.update();
		await sleep();

		expect(element.hasAttribute("hidden")).toBe(false);
		expect(element.getAttribute("class")).toBe("visible");

		cleanup(element);
	});

	test("expandable array host binding (boolean attribute list) is cleared on swap", async () => {
		const tag = uniqueTag();
		let showFirst = true;
		const firstAttrs = ["hidden", "inert"];
		const secondAttrs = ["draggable"];
		const MyElement = render(function* () {
			yield () =>
				showFirst
					? html`<template ${firstAttrs}><p>a</p></template>`
					: html`<template ${secondAttrs}><p>b</p></template>`;
		});
		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		expect(element.hasAttribute("hidden")).toBe(true);
		expect(element.hasAttribute("inert")).toBe(true);
		expect(element.hasAttribute("draggable")).toBe(false);

		showFirst = false;
		await element.update();
		await sleep();

		expect(element.hasAttribute("hidden")).toBe(false);
		expect(element.hasAttribute("inert")).toBe(false);
		expect(element.hasAttribute("draggable")).toBe(true);

		cleanup(element);
	});

	test("expandable string host binding is cleared on swap", async () => {
		const tag = uniqueTag();
		let showFirst = true;
		const firstAttr = "hidden";
		const secondAttr = "inert";
		const MyElement = render(function* () {
			yield () =>
				showFirst
					? html`<template ${firstAttr}><p>a</p></template>`
					: html`<template ${secondAttr}><p>b</p></template>`;
		});
		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		expect(element.hasAttribute("hidden")).toBe(true);

		showFirst = false;
		await element.update();
		await sleep();

		expect(element.hasAttribute("hidden")).toBe(false);
		expect(element.hasAttribute("inert")).toBe(true);

		cleanup(element);
	});

	test("multi-part dynamic host attribute name is cleared on swap", async () => {
		const tag = uniqueTag();
		let showFirst = true;
		const prefix = "data";
		const suffix = "key";
		const MyElement = render(function* () {
			yield () =>
				showFirst
					? html`<template ${prefix}-${suffix}="value"><p>a</p></template>`
					: html`<template aria-label="other"><p>b</p></template>`;
		});
		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		expect(element.getAttribute("data-key")).toBe("value");

		showFirst = false;
		await element.update();
		await sleep();

		expect(element.hasAttribute("data-key")).toBe(false);
		expect(element.getAttribute("aria-label")).toBe("other");

		cleanup(element);
	});

	test("boolean dynamic host attribute name is cleared on swap", async () => {
		const tag = uniqueTag();
		let showFirst = true;
		const flagName = "hidden";
		const MyElement = render(function* () {
			yield () =>
				showFirst
					? html`<template ${flagName}><p>a</p></template>`
					: html`<template class="ready"><p>b</p></template>`;
		});
		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		expect(element.hasAttribute("hidden")).toBe(true);

		showFirst = false;
		await element.update();
		await sleep();

		expect(element.hasAttribute("hidden")).toBe(false);
		expect(element.getAttribute("class")).toBe("ready");

		cleanup(element);
	});

	test("mixed binding forms on the host are all cleared in a single swap", async () => {
		//exercises every host-binding shape in one template so clearHostAttributes' loop has to dispatch through every removeAttributeBinding branch
		const tag = uniqueTag();
		let showFirst = true;
		const dynamicId = "alpha";
		const prefix = "data";
		const suffix = "kind";
		const expandable: Record<string, string> = {
			role: "dialog",
			tabindex: "0",
		};
		const MyElement = render(function* () {
			yield () =>
				showFirst
					? html`<template
							class="card"
							hidden
							id="${dynamicId}"
							${prefix}-${suffix}="x"
							${expandable}
							><p>a</p></template
						>`
					: html`<template aria-label="other"><p>b</p></template>`;
		});
		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		expect(element.getAttribute("class")).toBe("card");
		expect(element.hasAttribute("hidden")).toBe(true);
		expect(element.getAttribute("id")).toBe("alpha");
		expect(element.getAttribute("data-kind")).toBe("x");
		expect(element.getAttribute("role")).toBe("dialog");
		expect(element.getAttribute("tabindex")).toBe("0");

		showFirst = false;
		await element.update();
		await sleep();

		expect(element.hasAttribute("class")).toBe(false);
		expect(element.hasAttribute("hidden")).toBe(false);
		expect(element.hasAttribute("id")).toBe(false);
		expect(element.hasAttribute("data-kind")).toBe(false);
		expect(element.hasAttribute("role")).toBe(false);
		expect(element.hasAttribute("tabindex")).toBe(false);
		expect(element.getAttribute("aria-label")).toBe("other");

		cleanup(element);
	});

	test("three consecutive swaps each clean up the previous template's host attrs", async () => {
		//A → B → C: each transition must clear the prior template's host attrs without leaking
		const tag = uniqueTag();
		let stage = 0;
		const MyElement = render(function* () {
			yield () => {
				if (stage === 0) return html`<template class="a"><p>a</p></template>`;
				if (stage === 1) return html`<template role="b"><p>b</p></template>`;
				return html`<template aria-label="c"><p>c</p></template>`;
			};
		});
		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();
		expect(element.getAttribute("class")).toBe("a");

		stage = 1;
		await element.update();
		await sleep();
		expect(element.hasAttribute("class")).toBe(false);
		expect(element.getAttribute("role")).toBe("b");

		stage = 2;
		await element.update();
		await sleep();
		expect(element.hasAttribute("class")).toBe(false);
		expect(element.hasAttribute("role")).toBe(false);
		expect(element.getAttribute("aria-label")).toBe("c");

		cleanup(element);
	});

	test("swapping back to an earlier template re-applies its host attrs cleanly", async () => {
		//A → B → A: pin that returning to a previously-rendered template reapplies its host attrs and clears B's
		const tag = uniqueTag();
		let showFirst = true;
		const MyElement = render(function* () {
			yield () =>
				showFirst
					? html`<template class="card" role="dialog"><p>a</p></template>`
					: html`<template aria-label="other"><p>b</p></template>`;
		});
		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();
		expect(element.getAttribute("class")).toBe("card");
		expect(element.getAttribute("role")).toBe("dialog");

		showFirst = false;
		await element.update();
		await sleep();
		expect(element.hasAttribute("class")).toBe(false);
		expect(element.hasAttribute("role")).toBe(false);
		expect(element.getAttribute("aria-label")).toBe("other");

		showFirst = true;
		await element.update();
		await sleep();
		expect(element.hasAttribute("aria-label")).toBe(false);
		expect(element.getAttribute("class")).toBe("card");
		expect(element.getAttribute("role")).toBe("dialog");

		cleanup(element);
	});

	test("nested generator source swap also clears the previous host attrs", async () => {
		//the outer-generator → render-function path is what every other test exercises; this one routes through a nested-generator active source so dispatchCSRUpdate restarts the generator rather than the render-function re-call path
		const tag = uniqueTag();
		let showFirst = true;
		const MyElement = render(function* () {
			yield function* () {
				yield showFirst
					? html`<template class="card"><p>a</p></template>`
					: html`<template id="hero"><p>b</p></template>`;
			};
		});
		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();
		expect(element.getAttribute("class")).toBe("card");

		showFirst = false;
		await element.update();
		await sleep();

		expect(element.hasAttribute("class")).toBe(false);
		expect(element.getAttribute("id")).toBe("hero");

		cleanup(element);
	});
});

describe("root-template host attribute updates within a single template (refactor regression guards)", () => {
	//the swap cleanup work refactored the previous-name removal in updateAttribute and updateExpandable to go through removeAttributeBinding
	//these tests pin behavior that must not change: same-template renders that drop or rename host attributes still clean up correctly
	let tagId = 0;
	const uniqueTag = () => `test-host-same-${tagId++}-${Date.now()}`;

	const mount = (tag: string): HTMLElement => {
		const element = document.createElement(tag);
		document.body.appendChild(element);
		return element;
	};

	const cleanup = (element: HTMLElement) => {
		element.remove();
	};

	test("expandable object loses a key between renders and the dropped key is removed", async () => {
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

		attrs = { id: "second" };
		await element.update();
		await sleep();

		expect(element.getAttribute("id")).toBe("second");
		expect(element.hasAttribute("role")).toBe(false);

		cleanup(element);
	});

	test("expandable array loses a name between renders and the dropped name is removed", async () => {
		const tag = uniqueTag();
		let attrs: Array<string> = ["hidden", "inert"];
		const MyElement = render(function* () {
			yield () => html`<template ${attrs}><p>hi</p></template>`;
		});
		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		expect(element.hasAttribute("hidden")).toBe(true);
		expect(element.hasAttribute("inert")).toBe(true);

		attrs = ["hidden"];
		await element.update();
		await sleep();

		expect(element.hasAttribute("hidden")).toBe(true);
		expect(element.hasAttribute("inert")).toBe(false);

		cleanup(element);
	});

	test("multi-part dynamic host attribute name change removes the previous name", async () => {
		const tag = uniqueTag();
		let prefix = "data";
		let suffix = "key";
		const MyElement = render(function* () {
			yield () =>
				html`<template ${prefix}-${suffix}="value"><p>hi</p></template>`;
		});
		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		expect(element.getAttribute("data-key")).toBe("value");

		prefix = "aria";
		suffix = "label";
		await element.update();
		await sleep();

		expect(element.hasAttribute("data-key")).toBe(false);
		expect(element.getAttribute("aria-label")).toBe("value");

		cleanup(element);
	});

	test("boolean dynamic host attribute name change removes the previous name", async () => {
		const tag = uniqueTag();
		let name = "hidden";
		const MyElement = render(function* () {
			yield () => html`<template ${name}><p>hi</p></template>`;
		});
		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		expect(element.hasAttribute("hidden")).toBe(true);

		name = "inert";
		await element.update();
		await sleep();

		expect(element.hasAttribute("hidden")).toBe(false);
		expect(element.hasAttribute("inert")).toBe(true);

		cleanup(element);
	});

	test("expandable object swapped to an empty object clears every previous key", async () => {
		const tag = uniqueTag();
		let attrs: Record<string, string> = {
			id: "first",
			role: "dialog",
			"data-x": "y",
		};
		const MyElement = render(function* () {
			yield () => html`<template ${attrs}><p>hi</p></template>`;
		});
		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		expect(element.getAttribute("id")).toBe("first");
		expect(element.getAttribute("role")).toBe("dialog");
		expect(element.getAttribute("data-x")).toBe("y");

		attrs = {};
		await element.update();
		await sleep();

		expect(element.hasAttribute("id")).toBe(false);
		expect(element.hasAttribute("role")).toBe(false);
		expect(element.hasAttribute("data-x")).toBe(false);

		cleanup(element);
	});
});

describe("root-template host attribute writes do not feed back through the MutationObserver", () => {
	//the host MutationObserver in index.ts watches `this` with { attributes: true }
	//framework-driven writes to the host (from root-template host bindings) must not be observed as user mutations; otherwise every render that writes a host attr would queue an extra re-render one microtask later
	let tagId = 0;
	const uniqueTag = () => `test-host-mo-${tagId++}-${Date.now()}`;

	const mount = (tag: string): HTMLElement => {
		const element = document.createElement(tag);
		document.body.appendChild(element);
		return element;
	};

	const cleanup = (element: HTMLElement) => {
		element.remove();
	};

	test("initial render with static host attrs causes exactly one render pass", async () => {
		const tag = uniqueTag();
		let renderCount = 0;
		const MyElement = render(function* () {
			yield () => {
				renderCount++;
				return html`<template class="card" role="dialog"><p>hi</p></template>`;
			};
		});
		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep(50);

		expect(renderCount).toBe(1);
		expect(element.getAttribute("class")).toBe("card");
		expect(element.getAttribute("role")).toBe("dialog");

		cleanup(element);
	});

	test("initial render with dynamic host attrs causes exactly one render pass", async () => {
		const tag = uniqueTag();
		let renderCount = 0;
		const MyElement = render(function* () {
			yield () => {
				renderCount++;
				return html`<template id="${"hero"}" role="${"dialog"}"
					><p>hi</p></template
				>`;
			};
		});
		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep(50);

		expect(renderCount).toBe(1);

		cleanup(element);
	});

	test("template swap that writes new host attrs does not cause an extra render pass", async () => {
		const tag = uniqueTag();
		let renderCount = 0;
		let showFirst = true;
		const MyElement = render(function* () {
			yield () => {
				renderCount++;
				return showFirst
					? html`<template class="card"><p>a</p></template>`
					: html`<template id="hero"><p>b</p></template>`;
			};
		});
		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep(50);
		expect(renderCount).toBe(1);

		showFirst = false;
		await element.update();
		await sleep(50);

		//one render for the swap itself; the host-attribute writes during that render must not queue a third pass
		expect(renderCount).toBe(2);
		expect(element.getAttribute("id")).toBe("hero");
		expect(element.hasAttribute("class")).toBe(false);

		cleanup(element);
	});

	test("a user-driven setAttribute on the host still triggers a re-render after the host bindings settle", async () => {
		//regression guard: we must suppress the MO only for framework-driven writes, not disable it entirely
		const tag = uniqueTag();
		let renderCount = 0;
		const MyElement = render(function* (host) {
			yield () => {
				renderCount++;
				return html`<template class="card"
					><p>${host.getAttribute("data-label") ?? "none"}</p></template
				>`;
			};
		});
		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep(50);
		expect(renderCount).toBe(1);

		element.setAttribute("data-label", "user-write");
		await sleep(50);

		expect(renderCount).toBe(2);
		expect(element.shadowRoot?.querySelector("p")?.textContent).toBe(
			"user-write",
		);
		//and the host attribute the framework owns is still in place
		expect(element.getAttribute("class")).toBe("card");

		cleanup(element);
	});
});

describe("root-template host attributes are rejected when nested inside content", () => {
	//root templates are a top-level-only feature; a `<template ...>` with attributes that ends up inside a parent's ${...} content has no well-defined host
	//if we silently threaded the outer host into nested setups, list items and yielded sub-templates could clobber each other's host attrs and leave stale attrs on swap
	//the contract is: nested root templates throw at setup
	let tagId = 0;
	const uniqueTag = () => `test-host-nested-${tagId++}-${Date.now()}`;

	const mount = (tag: string): HTMLElement => {
		const element = document.createElement(tag);
		document.body.appendChild(element);
		return element;
	};

	const cleanup = (element: HTMLElement) => {
		element.remove();
	};

	test("a root template inside a parent's content surfaces the error to the user", async () => {
		const tag = uniqueTag();
		const MyElement = render(function* () {
			yield () =>
				html`<div>${html`<template class="leak"><p>x</p></template>`}</div>`;
		});
		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		//renderTemplate doesn't catch synchronous setup throws on mount; the parser cache means subsequent users see the same failure
		expect(element.shadowRoot?.textContent).toMatch(
			/top level of a component's render output/,
		);
		expect(element.hasAttribute("class")).toBe(false);

		cleanup(element);
	});

	test("a root template inside a list item also throws", async () => {
		const tag = uniqueTag();
		const MyElement = render(function* () {
			yield () =>
				html`<ul>
					${[html`<template class="leak"><p>x</p></template>`]}
				</ul>`;
		});
		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		expect(element.shadowRoot?.textContent).toMatch(
			/top level of a component's render output/,
		);

		cleanup(element);
	});
});
