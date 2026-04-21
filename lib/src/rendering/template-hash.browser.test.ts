import { describe, expect, test } from "vitest";
import { html, render } from "../index";

const sleep = (duration = 0) =>
	new Promise((resolve) => setTimeout(resolve, duration));

describe("HTMLTemplate.hash", () => {
	test("is stable for identical expressions", () => {
		const template1 = html`<p>${"a"}</p>`;
		const template2 = html`<p>${"a"}</p>`;
		expect(template1.hash).toBe(template2.hash);
	});

	test("changes when expressions change", () => {
		const template1 = html`<p>${"a"}</p>`;
		const template2 = html`<p>${"b"}</p>`;
		expect(template1.hash).not.toBe(template2.hash);
	});

	test("differs between templates with different structure but same expressions", () => {
		const template1 = html`<p>${"a"}</p>`;
		const template2 = html`<div>${"a"}</div>`;
		expect(template1.hash).not.toBe(template2.hash);
	});

	test("is stable across repeated reads on the same instance", () => {
		const template = html`<p class="${"x"}">${"y"}</p>`;
		const first = template.hash;
		const second = template.hash;
		expect(first).toBe(second);
	});

	test("distinguishes tightly-clustered decimal expressions", () => {
		// This is the animation hot-path regression guard.
		// `bar.width` values fall within a narrow float range every frame;
		// the overall template hash must reflect those differences so that
		// list diffing / template swapping does not mistakenly treat
		// consecutive frames as identical content.
		const template1 = html`<div style="width:${50.1}%"></div>`;
		const template2 = html`<div style="width:${50.10001}%"></div>`;
		const template3 = html`<div style="width:${50.2}%"></div>`;
		const hashes = new Set([template1.hash, template2.hash, template3.hash]);
		expect(hashes.size).toBe(3);
	});
});

describe("update() dirty-binding behaviour", () => {
	let tagId = 0;
	const uniqueTag = () => `test-hash-${tagId++}-${Date.now()}`;

	const mount = (tag: string): HTMLElement => {
		const element = document.createElement(tag);
		document.body.appendChild(element);
		return element;
	};

	const cleanup = (element: HTMLElement) => element.remove();

	test("updates DOM when only a primitive number changes", async () => {
		// Regression guard for proposal (2): if we short-circuit the hash check
		// for primitives, we must still mark the binding dirty on `!==`.
		const tag = uniqueTag();
		let value = 1;
		const MyElement = render(function* () {
			yield () => html`<p>${value}</p>`;
		});
		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();
		expect(element.shadowRoot?.querySelector("p")?.textContent).toContain("1");

		value = 2;
		await element.update();
		await sleep();
		expect(element.shadowRoot?.querySelector("p")?.textContent).toContain("2");

		cleanup(element);
	});

	test("updates DOM across successive tiny decimal changes", async () => {
		const tag = uniqueTag();
		let value = 50.1;
		const MyElement = render(function* () {
			yield () => html`<p>${value}</p>`;
		});
		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();
		expect(element.shadowRoot?.querySelector("p")?.textContent).toContain(
			"50.1",
		);

		value = 50.1000001;
		await element.update();
		await sleep();
		expect(element.shadowRoot?.querySelector("p")?.textContent).toContain(
			"50.1000001",
		);

		value = 50.2;
		await element.update();
		await sleep();
		expect(element.shadowRoot?.querySelector("p")?.textContent).toContain(
			"50.2",
		);

		cleanup(element);
	});

	test("updates multiple attribute expressions in the same style string", async () => {
		// Mirrors the animation stress-test shape: one style attribute with
		// multiple interpolated floats. All of them should propagate on every
		// frame even if the fast-path skips the redundant hash comparison.
		const tag = uniqueTag();
		let width = 50.1;
		let hue = 120.5;
		let opacity = 0.4;
		const MyElement = render(function* () {
			yield () =>
				html`<div
					style="width:${width}%;background:hsl(${hue},70%,50%);opacity:${opacity}"
				></div>`;
		});
		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		const div = element.shadowRoot?.querySelector("div")!;
		expect(div.getAttribute("style")).toContain("width:50.1%");
		expect(div.getAttribute("style")).toContain("hsl(120.5");

		width = 51.7;
		hue = 200.25;
		opacity = 0.9;
		await element.update();
		await sleep();

		expect(div.getAttribute("style")).toContain("width:51.7%");
		expect(div.getAttribute("style")).toContain("hsl(200.25");
		expect(div.getAttribute("style")).toContain("opacity:0.9");

		cleanup(element);
	});

	test("reuses nested-template DOM when content is equal across updates", async () => {
		// Exercises the `expressions[index] = previousEntry` swap path:
		// on the second render the new HTMLTemplate has identical content
		// to the previous, so the engine should reuse the old DOM subtree.
		const tag = uniqueTag();
		let outer = 1;
		const MyElement = render(function* () {
			yield () =>
				html`<section>
					<h1>${outer}</h1>
					${html`<span class="${"static"}">inner</span>`}
				</section>`;
		});
		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		const span = element.shadowRoot?.querySelector("span");
		expect(span?.textContent).toBe("inner");

		outer = 2;
		await element.update();
		await sleep();

		// Nested template had identical expressions, so the DOM node survives.
		expect(element.shadowRoot?.querySelector("span")).toBe(span);
		expect(element.shadowRoot?.querySelector("h1")?.textContent).toContain("2");

		cleanup(element);
	});

	test("list diffing reuses item DOM when hashes match across reorders", async () => {
		// Guards the .hash-based keying used by renderList. If proposal (3)
		// regresses the lazy getter, list items should still match by content.
		const tag = uniqueTag();
		let items = ["one", "two", "three"];
		const MyElement = render(function* () {
			yield () =>
				html`<ul>
					${items.map((item) => html`<li>${item}</li>`)}
				</ul>`;
		});
		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		const original = Array.from(element.shadowRoot!.querySelectorAll("li"));
		expect(original.map((node) => node.textContent?.trim())).toEqual([
			"one",
			"two",
			"three",
		]);

		items = ["three", "one", "two"];
		await element.update();
		await sleep();

		const reordered = Array.from(element.shadowRoot!.querySelectorAll("li"));
		expect(reordered.map((node) => node.textContent?.trim())).toEqual([
			"three",
			"one",
			"two",
		]);

		// Each reordered <li> should be one of the originals, not a fresh node.
		for (const li of reordered) {
			expect(original).toContain(li);
		}

		cleanup(element);
	});

	test("null-to-undefined transition keeps the binding empty", async () => {
		// Documents the observable DOM behaviour for null ↔ undefined. Both
		// currently hash to 0 so the binding stays clean; proposal (2) would
		// mark it dirty, but the resulting DOM must still be empty either way.
		const tag = uniqueTag();
		let value: unknown = null;
		const MyElement = render(function* () {
			yield () => html`<p>before${value}after</p>`;
		});
		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		const p = element.shadowRoot?.querySelector("p")!;
		expect(p.textContent).toBe("beforeafter");

		value = undefined;
		await element.update();
		await sleep();
		expect(p.textContent).toBe("beforeafter");

		cleanup(element);
	});

	test("preserves nested-template DOM across repeated stable renders", async () => {
		// Confirms the reference-preservation contract via a nested template
		// whose expressions are stable. After many updates the nested <span>
		// node identity must not change.
		const tag = uniqueTag();
		let outer = 0;
		const MyElement = render(function* () {
			yield () =>
				html`<section>
					<h1>${outer}</h1>
					${html`<span>stable</span>`}
				</section>`;
		});
		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		const span = element.shadowRoot?.querySelector("span");
		for (let frame = 1; frame <= 5; frame++) {
			outer = frame;
			await element.update();
			await sleep();
			expect(element.shadowRoot?.querySelector("span")).toBe(span);
		}

		cleanup(element);
	});
});
