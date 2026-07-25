import { describe, expect, test } from "vitest";
import { html, component } from "../../index";

const sleep = (duration = 0) =>
	new Promise((resolve) => setTimeout(resolve, duration));

describe("template switching", () => {
	let tagId = 0;
	const uniqueTag = () => `test-switch-${tagId++}-${Date.now()}`;

	const mount = (tag: string): HTMLElement => {
		const element = document.createElement(tag);
		document.body.appendChild(element);
		return element;
	};

	const cleanup = (element: HTMLElement) => {
		element.remove();
	};

	test("switches between different template structures", async () => {
		const tag = uniqueTag();
		let showFirst = true;

		const MyElement = component(function* () {
			yield () =>
				showFirst ? html` <div>first</div>` : html`<span>second</span>`;
		});

		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		expect(element.shadowRoot?.querySelector("div")?.textContent).toBe("first");
		expect(element.shadowRoot?.querySelector("span")).toBeNull();

		showFirst = false;
		await element.update();
		await sleep();

		expect(element.shadowRoot?.querySelector("div")).toBeNull();
		expect(element.shadowRoot?.querySelector("span")?.textContent).toBe(
			"second",
		);

		cleanup(element);
	});

	test("switches back and forth between templates multiple times", async () => {
		const tag = uniqueTag();
		let mode: "a" | "b" = "a";

		const MyElement = component(function* () {
			yield () =>
				mode === "a" ? html`<div>mode-a</div>` : html`<span>mode-b</span>`;
		});

		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		expect(element.shadowRoot?.querySelector("div")?.textContent).toBe(
			"mode-a",
		);

		mode = "b";
		await element.update();
		await sleep();
		expect(element.shadowRoot?.querySelector("span")?.textContent).toBe(
			"mode-b",
		);

		mode = "a";
		await element.update();
		await sleep();
		expect(element.shadowRoot?.querySelector("div")?.textContent).toBe(
			"mode-a",
		);

		mode = "b";
		await element.update();
		await sleep();
		expect(element.shadowRoot?.querySelector("span")?.textContent).toBe(
			"mode-b",
		);

		cleanup(element);
	});

	test("same template structure with different expressions updates in-place", async () => {
		const tag = uniqueTag();
		let text = "initial";
		let cls = "one";

		const MyElement = component(function* () {
			yield () => html`<p class="${cls}">${text}</p>`;
		});

		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		const p = element.shadowRoot?.querySelector("p")!;
		expect(p.textContent).toContain("initial");
		expect(p.getAttribute("class")).toBe("one");

		text = "updated";
		cls = "two";
		await element.update();
		await sleep();

		// Same element reference means in-place update, not replacement
		expect(element.shadowRoot?.querySelector("p")).toBe(p);
		expect(p.textContent).toContain("updated");
		expect(p.getAttribute("class")).toBe("two");

		cleanup(element);
	});

	test("switches between three different template structures", async () => {
		const tag = uniqueTag();
		let view: "list" | "detail" | "empty" = "empty";

		const MyElement = component(function* () {
			yield () => {
				if (view === "list")
					return html`<ul>
						<li>item</li>
					</ul>`;
				if (view === "detail")
					return html`<article>
						<h2>Title</h2>
						<p>Body</p>
					</article>`;
				return html`<p>No content</p>`;
			};
		});

		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		expect(element.shadowRoot?.querySelector("p")?.textContent).toBe(
			"No content",
		);

		view = "list";
		await element.update();
		await sleep();
		expect(element.shadowRoot?.querySelector("li")?.textContent).toBe("item");

		view = "detail";
		await element.update();
		await sleep();
		expect(element.shadowRoot?.querySelector("h2")?.textContent).toBe("Title");
		expect(element.shadowRoot?.querySelector("li")).toBeNull();

		view = "empty";
		await element.update();
		await sleep();
		expect(element.shadowRoot?.querySelector("p")?.textContent).toBe(
			"No content",
		);
		expect(element.shadowRoot?.querySelector("article")).toBeNull();

		cleanup(element);
	});

	test("switching templates preserves sibling content", async () => {
		const tag = uniqueTag();
		let dynamic = true;

		const MyElement = component(function* () {
			yield () =>
				dynamic
					? html`<header>head</header>
							<main>content-a</main>
							<footer>foot</footer>`
					: html`<header>head</header>
							<main>content-b</main>
							<footer>foot</footer>`;
		});

		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		expect(element.shadowRoot?.querySelector("main")?.textContent).toBe(
			"content-a",
		);
		expect(element.shadowRoot?.querySelector("header")?.textContent).toBe(
			"head",
		);

		dynamic = false;
		await element.update();
		await sleep();

		// Same template structure, so it should update in place
		expect(element.shadowRoot?.querySelector("main")?.textContent).toBe(
			"content-b",
		);
		expect(element.shadowRoot?.querySelector("footer")?.textContent).toBe(
			"foot",
		);

		cleanup(element);
	});
});
