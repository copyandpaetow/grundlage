import { describe, expect, test } from "vitest";
import { html, component } from "../../../index";

const sleep = (duration = 0) =>
	new Promise((resolve) => setTimeout(resolve, duration));

describe("multiple bindings", () => {
	let tagId = 0;
	const uniqueTag = () => `test-multi-${tagId++}-${Date.now()}`;

	const mount = (tag: string): HTMLElement => {
		const element = document.createElement(tag);
		document.body.appendChild(element);
		return element;
	};

	const cleanup = (element: HTMLElement) => {
		element.remove();
	};

	test("updates only the changed binding among many", async () => {
		const tag = uniqueTag();
		let a = "alpha";
		let b = "beta";
		let c = "gamma";

		const MyElement = component(function* () {
			yield () =>
				html`<p>${a}</p>
					<p>${b}</p>
					<p>${c}</p>`;
		});

		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		const ps = element.shadowRoot?.querySelectorAll("p")!;
		expect(ps[0].textContent).toContain("alpha");
		expect(ps[1].textContent).toContain("beta");
		expect(ps[2].textContent).toContain("gamma");

		b = "BETA";
		await element.update();
		await sleep();

		const updated = element.shadowRoot?.querySelectorAll("p")!;
		expect(updated[0].textContent).toContain("alpha");
		expect(updated[1].textContent).toContain("BETA");
		expect(updated[2].textContent).toContain("gamma");

		cleanup(element);
	});

	test("handles mixed binding types in one template", async () => {
		const tag = uniqueTag();
		let cls = "highlight";
		let text = "content";
		let handler = () => {};

		const MyElement = component(function* () {
			yield () => html` <div class="${cls}" onclick="${handler}">${text}</div>`;
		});

		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		const div = element.shadowRoot?.querySelector("div")!;
		expect(div.getAttribute("class")).toBe("highlight");
		expect(div.textContent).toContain("content");

		cls = "dim";
		text = "updated";
		await element.update();
		await sleep();

		expect(div.getAttribute("class")).toBe("dim");
		expect(div.textContent).toContain("updated");

		cleanup(element);
	});

	test("rapid sequential updates coalesce into one render", async () => {
		const tag = uniqueTag();
		let value = 0;
		let renderCount = 0;

		const MyElement = component(function* () {
			yield () => {
				renderCount++;
				return html`<span>${value}</span>`;
			};
		});

		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		const initialRenders = renderCount;

		value = 1;
		element.update();
		value = 2;
		element.update();
		value = 3;
		element.update();

		await sleep();

		expect(renderCount).toBe(initialRenders + 1);
		expect(element.shadowRoot?.querySelector("span")?.textContent).toContain(
			"3",
		);

		cleanup(element);
	});
});
