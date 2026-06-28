import { describe, expect, test } from "vitest";
import { html, render } from "../../index";

const sleep = (duration = 0) =>
	new Promise((resolve) => setTimeout(resolve, duration));

describe("content updates", () => {
	let tagId = 0;
	const uniqueTag = () => `test-content-${tagId++}-${Date.now()}`;

	const mount = (tag: string): HTMLElement => {
		const element = document.createElement(tag);
		document.body.appendChild(element);
		return element;
	};

	const cleanup = (element: HTMLElement) => {
		element.remove();
	};

	test("updates text content without replacing the text node", async () => {
		const tag = uniqueTag();
		let text = "before";

		const MyElement = render(function* () {
			yield () => html`<p>${text}</p>`;
		});

		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		const p = element.shadowRoot?.querySelector("p")!;
		expect(p.textContent).toContain("before");

		const textNode = p.childNodes[1];

		text = "after";
		await element.update();
		await sleep();

		expect(p.textContent).toContain("after");
		expect(p.childNodes[1]).toBe(textNode);

		cleanup(element);
	});

	test("renders a nested template and updates it in-place", async () => {
		const tag = uniqueTag();
		let inner = "child-v1";

		const MyElement = render(function* () {
			yield () => html` <div>${html`<span>${inner}</span>`}</div>`;
		});

		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		const span = element.shadowRoot?.querySelector("span")!;
		expect(span.textContent).toContain("child-v1");

		inner = "child-v2";
		await element.update();
		await sleep();

		expect(element.shadowRoot?.querySelector("span")).toBe(span);
		expect(span.textContent).toContain("child-v2");

		cleanup(element);
	});

	test("renders and updates a list", async () => {
		const tag = uniqueTag();
		let items = ["a", "b", "c"];

		const MyElement = render(function* () {
			yield () =>
				html` <ul>
					${items.map((i) => html` <li>${i}</li>`)}
				</ul>`;
		});

		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		const lis = element.shadowRoot?.querySelectorAll("li")!;
		expect(lis.length).toBe(3);
		expect(lis[0].textContent).toContain("a");
		expect(lis[1].textContent).toContain("b");
		expect(lis[2].textContent).toContain("c");

		items = ["a", "c", "d"];
		await element.update();
		await sleep();

		const updated = element.shadowRoot?.querySelectorAll("li")!;
		expect(updated.length).toBe(3);
		expect(updated[0].textContent).toContain("a");
		expect(updated[1].textContent).toContain("c");
		expect(updated[2].textContent).toContain("d");

		cleanup(element);
	});

	test("renders null as empty text", async () => {
		const tag = uniqueTag();
		let value: unknown = null;

		const MyElement = render(function* () {
			yield () => html`<p>${value}</p>`;
		});

		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		const p = element.shadowRoot?.querySelector("p")!;
		expect(p.textContent).toBe("");

		cleanup(element);
	});

	test("renders undefined as empty text", async () => {
		const tag = uniqueTag();
		let value: unknown = undefined;

		const MyElement = render(function* () {
			yield () => html`<p>${value}</p>`;
		});

		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		const p = element.shadowRoot?.querySelector("p")!;
		expect(p.textContent).toBe("");

		cleanup(element);
	});

	test('renders false as the literal string "false"', async () => {
		//false is stringable, so the renderer uses assertPrimitiveString, so the text node holds "false"
		const tag = uniqueTag();
		let value: unknown = false;

		const MyElement = render(function* () {
			yield () => html`<p>${value}</p>`;
		});

		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		const p = element.shadowRoot?.querySelector("p")!;
		expect(p.textContent).toBe("false");

		cleanup(element);
	});

	test("renders boolean true as text", async () => {
		const tag = uniqueTag();

		const MyElement = render(function* () {
			yield () => html`<p>${true}</p>`;
		});

		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		const p = element.shadowRoot?.querySelector("p")!;
		expect(p.textContent).toBe("true");

		cleanup(element);
	});

	test("renders a number as text", async () => {
		const tag = uniqueTag();

		const MyElement = render(function* () {
			yield () => html`<p>${42}</p>`;
		});

		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		const p = element.shadowRoot?.querySelector("p")!;
		expect(p.textContent).toBe("42");

		cleanup(element);
	});

	test("renders zero as text", async () => {
		const tag = uniqueTag();

		const MyElement = render(function* () {
			yield () => html`<p>${0}</p>`;
		});

		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		const p = element.shadowRoot?.querySelector("p")!;
		expect(p.textContent).toBe("0");

		cleanup(element);
	});

	test("switches from text to nested template", async () => {
		const tag = uniqueTag();
		let useTemplate = false;

		const MyElement = render(function* () {
			yield () =>
				html`<div>
					${useTemplate ? html`<span>nested</span>` : "plain text"}
				</div>`;
		});

		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		expect(element.shadowRoot?.querySelector("div")?.textContent).toContain(
			"plain text",
		);
		expect(element.shadowRoot?.querySelector("span")).toBeNull();

		useTemplate = true;
		await element.update();
		await sleep();

		expect(element.shadowRoot?.querySelector("span")?.textContent).toBe(
			"nested",
		);

		cleanup(element);
	});

	test("switches from nested template to text", async () => {
		const tag = uniqueTag();
		let useTemplate = true;

		const MyElement = render(function* () {
			yield () =>
				html`<div>
					${useTemplate ? html`<span>nested</span>` : "plain text"}
				</div>`;
		});

		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		expect(element.shadowRoot?.querySelector("span")?.textContent).toBe(
			"nested",
		);

		useTemplate = false;
		await element.update();
		await sleep();

		expect(element.shadowRoot?.querySelector("span")).toBeNull();
		expect(element.shadowRoot?.querySelector("div")?.textContent).toContain(
			"plain text",
		);

		cleanup(element);
	});

	test("switches from text to array", async () => {
		const tag = uniqueTag();
		let useArray = false;

		const MyElement = render(function* () {
			yield () =>
				html`<div>
					${useArray
						? ["a", "b"].map((i) => html`<span>${i}</span>`)
						: "single"}
				</div>`;
		});

		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		expect(element.shadowRoot?.querySelector("div")?.textContent).toContain(
			"single",
		);

		useArray = true;
		await element.update();
		await sleep();

		expect(element.shadowRoot?.querySelectorAll("span").length).toBe(2);

		cleanup(element);
	});

	test("switches from array to text", async () => {
		const tag = uniqueTag();
		let useArray = true;

		const MyElement = render(function* () {
			yield () =>
				html`<div>
					${useArray
						? ["a", "b"].map((i) => html`<span>${i}</span>`)
						: "single"}
				</div>`;
		});

		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		expect(element.shadowRoot?.querySelectorAll("span").length).toBe(2);

		useArray = false;
		await element.update();
		await sleep();

		expect(element.shadowRoot?.querySelectorAll("span").length).toBe(0);
		expect(element.shadowRoot?.querySelector("div")?.textContent).toContain(
			"single",
		);

		cleanup(element);
	});

	test("renders an empty array without error", async () => {
		const tag = uniqueTag();
		let items: string[] = [];

		const MyElement = render(function* () {
			yield () => html`<div>${items.map((i) => html`<span>${i}</span>`)}</div>`;
		});

		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		expect(element.shadowRoot?.querySelectorAll("span").length).toBe(0);

		items = ["a"];
		await element.update();
		await sleep();

		expect(element.shadowRoot?.querySelectorAll("span").length).toBe(1);

		items = [];
		await element.update();
		await sleep();

		expect(element.shadowRoot?.querySelectorAll("span").length).toBe(0);

		cleanup(element);
	});

	test("renders deeply nested templates", async () => {
		const tag = uniqueTag();
		let inner = "deep";

		const MyElement = render(function* () {
			yield () =>
				html`<div>${html`<section>${html`<p>${inner}</p>`}</section>`}</div>`;
		});

		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		expect(element.shadowRoot?.querySelector("p")?.textContent).toContain(
			"deep",
		);

		inner = "deeper";
		await element.update();
		await sleep();

		expect(element.shadowRoot?.querySelector("p")?.textContent).toContain(
			"deeper",
		);

		cleanup(element);
	});

	test("reorders list items efficiently", async () => {
		const tag = uniqueTag();
		let items = [
			{ id: 1, text: "one" },
			{ id: 2, text: "two" },
			{ id: 3, text: "three" },
		];

		const MyElement = render(function* () {
			yield () =>
				html`<ul>
					${items.map((i) => html`<li>${i.text}</li>`)}
				</ul>`;
		});

		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		const lis = element.shadowRoot?.querySelectorAll("li")!;
		expect(lis.length).toBe(3);
		expect(lis[0].textContent).toContain("one");

		// Reverse the order
		items = [
			{ id: 3, text: "three" },
			{ id: 2, text: "two" },
			{ id: 1, text: "one" },
		];
		await element.update();
		await sleep();

		const updated = element.shadowRoot?.querySelectorAll("li")!;
		expect(updated.length).toBe(3);
		expect(updated[0].textContent).toContain("three");
		expect(updated[1].textContent).toContain("two");
		expect(updated[2].textContent).toContain("one");

		cleanup(element);
	});

	test("grows and shrinks a list", async () => {
		const tag = uniqueTag();
		let items = ["x"];

		const MyElement = render(function* () {
			yield () =>
				html` <div>${items.map((i) => html`<span>${i}</span>`)}</div>`;
		});

		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		expect(element.shadowRoot?.querySelectorAll("span").length).toBe(1);

		items = ["x", "y", "z"];
		await element.update();
		await sleep();
		expect(element.shadowRoot?.querySelectorAll("span").length).toBe(3);

		items = ["z"];
		await element.update();
		await sleep();
		expect(element.shadowRoot?.querySelectorAll("span").length).toBe(1);
		expect(element.shadowRoot?.querySelector("span")?.textContent).toContain(
			"z",
		);

		cleanup(element);
	});

	test("preserves DOM node identity when list is reordered", async () => {
		const tag = uniqueTag();
		let items = ["alpha", "beta", "gamma"];

		const MyElement = render(function* () {
			yield () =>
				html`<ul>
					${items.map((item) => html`<li>${item}</li>`)}
				</ul>`;
		});

		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		const [alphaNode, betaNode, gammaNode] = Array.from(
			element.shadowRoot!.querySelectorAll("li"),
		);

		items = ["gamma", "beta", "alpha"];
		await element.update();
		await sleep();

		const reorderedNodes = Array.from(
			element.shadowRoot!.querySelectorAll("li"),
		);
		expect(reorderedNodes).toEqual([gammaNode, betaNode, alphaNode]);

		cleanup(element);
	});

	test("preserves DOM node identity when swapping two adjacent items", async () => {
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

		const [oneNode, twoNode, threeNode] = Array.from(
			element.shadowRoot!.querySelectorAll("li"),
		);

		items = ["two", "one", "three"];
		await element.update();
		await sleep();

		const swappedNodes = Array.from(element.shadowRoot!.querySelectorAll("li"));
		expect(swappedNodes).toEqual([twoNode, oneNode, threeNode]);

		cleanup(element);
	});

	test("inserts an item in the middle without replacing surrounding nodes", async () => {
		const tag = uniqueTag();
		let items = ["a", "c"];

		const MyElement = render(function* () {
			yield () =>
				html`<ul>
					${items.map((item) => html`<li>${item}</li>`)}
				</ul>`;
		});

		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		const [aNode, cNode] = Array.from(
			element.shadowRoot!.querySelectorAll("li"),
		);

		items = ["a", "b", "c"];
		await element.update();
		await sleep();

		const nodesAfterInsert = Array.from(
			element.shadowRoot!.querySelectorAll("li"),
		);
		expect(nodesAfterInsert.length).toBe(3);
		expect(nodesAfterInsert[0]).toBe(aNode);
		expect(nodesAfterInsert[2]).toBe(cNode);
		expect(nodesAfterInsert[1].textContent).toContain("b");

		cleanup(element);
	});

	test("removes an item from the middle without replacing surrounding nodes", async () => {
		const tag = uniqueTag();
		let items = ["a", "b", "c"];

		const MyElement = render(function* () {
			yield () =>
				html`<ul>
					${items.map((item) => html`<li>${item}</li>`)}
				</ul>`;
		});

		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		const originalNodes = Array.from(
			element.shadowRoot!.querySelectorAll("li"),
		);
		const aNode = originalNodes[0];
		const cNode = originalNodes[2];

		items = ["a", "c"];
		await element.update();
		await sleep();

		const nodesAfterRemove = Array.from(
			element.shadowRoot!.querySelectorAll("li"),
		);
		expect(nodesAfterRemove.length).toBe(2);
		expect(nodesAfterRemove[0]).toBe(aNode);
		expect(nodesAfterRemove[1]).toBe(cNode);

		cleanup(element);
	});

	test("prepends items and keeps the original node at the tail", async () => {
		const tag = uniqueTag();
		let items = ["tail"];

		const MyElement = render(function* () {
			yield () =>
				html`<ul>
					${items.map((item) => html`<li>${item}</li>`)}
				</ul>`;
		});

		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		const [tailNode] = Array.from(element.shadowRoot!.querySelectorAll("li"));

		items = ["first", "middle", "tail"];
		await element.update();
		await sleep();

		const nodesAfterPrepend = Array.from(
			element.shadowRoot!.querySelectorAll("li"),
		);
		expect(nodesAfterPrepend.length).toBe(3);
		expect(nodesAfterPrepend[0].textContent).toContain("first");
		expect(nodesAfterPrepend[1].textContent).toContain("middle");
		expect(nodesAfterPrepend[2]).toBe(tailNode);

		cleanup(element);
	});

	test("preserves input element state across list reorder", async () => {
		const tag = uniqueTag();
		let items = ["alpha", "beta", "gamma"];

		const MyElement = render(function* () {
			yield () =>
				html`<ul>
					${items.map((item) => html`<li><input data-name="${item}" /></li>`)}
				</ul>`;
		});

		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		const inputsBefore = element.shadowRoot!.querySelectorAll("input");
		const betaInput = inputsBefore[1] as HTMLInputElement;
		betaInput.value = "user typed";

		items = ["gamma", "beta", "alpha"];
		await element.update();
		await sleep();

		const inputsAfter = element.shadowRoot!.querySelectorAll("input");
		expect(inputsAfter[1]).toBe(betaInput);
		expect((inputsAfter[1] as HTMLInputElement).value).toBe("user typed");

		cleanup(element);
	});

	test("updates text content when a decimal value changes", async () => {
		const tag = uniqueTag();
		let value = 1.5;

		const MyElement = render(function* () {
			yield () => html`<p>${value}</p>`;
		});

		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		const paragraph = element.shadowRoot?.querySelector("p")!;
		expect(paragraph.textContent).toContain("1.5");

		value = 1.7;
		await element.update();
		await sleep();
		expect(paragraph.textContent).toContain("1.7");

		value = 1.70001;
		await element.update();
		await sleep();
		expect(paragraph.textContent).toContain("1.70001");

		value = 2.3;
		await element.update();
		await sleep();
		expect(paragraph.textContent).toContain("2.3");

		cleanup(element);
	});

	test("batches rapid updates into a single render and reflects the final value", async () => {
		const tag = uniqueTag();
		let value = 0;
		let renderCount = 0;

		const MyElement = render(function* () {
			yield () => {
				renderCount++;
				return html`<p>${value}</p>`;
			};
		});

		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		const paragraph = element.shadowRoot?.querySelector("p")!;
		const textNode = paragraph.childNodes[1];
		expect(paragraph.textContent).toContain("0");

		const baselineRenderCount = renderCount;

		for (let index = 1; index <= 25; index++) {
			value = index;
			element.update();
		}

		await sleep();

		expect(paragraph.textContent).toContain("25");
		expect(paragraph.childNodes[1]).toBe(textNode);
		expect(renderCount - baselineRenderCount).toBe(1);

		value = 26;
		element.update();
		value = 27;
		element.update();
		value = 28;
		element.update();
		await sleep();

		expect(paragraph.textContent).toContain("28");
		expect(renderCount - baselineRenderCount).toBe(2);

		cleanup(element);
	});

	test("rebuilds every list item when all values change (no hash match)", async () => {
		const tag = uniqueTag();
		let items = [10, 20, 30, 40];

		const MyElement = render(function* () {
			yield () =>
				html`<ul>
					${items.map(
						(value) =>
							html`<li><span>${value}</span><em>${value * 2}</em></li>`,
					)}
				</ul>`;
		});

		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		const originalItems = Array.from(
			element.shadowRoot!.querySelectorAll("li"),
		);
		const originalSpans = Array.from(
			element.shadowRoot!.querySelectorAll("span"),
		);
		expect(originalItems.length).toBe(4);

		// Every value changes, so no hash match anywhere, but structure is identical.
		items = [11, 21, 31, 41];
		await element.update();
		await sleep();

		const updatedItems = Array.from(element.shadowRoot!.querySelectorAll("li"));
		const updatedSpans = Array.from(
			element.shadowRoot!.querySelectorAll("span"),
		);
		expect(updatedItems.length).toBe(4);
		// no hash matches anywhere, so each changed item is rebuilt rather than
		// patched in place: every node is fresh and carries the new values
		for (let index = 0; index < 4; index++) {
			expect(updatedItems[index]).not.toBe(originalItems[index]);
			expect(updatedSpans[index]).not.toBe(originalSpans[index]);
		}
		expect(updatedSpans[0].textContent).toBe("11");
		expect(updatedSpans[3].textContent).toBe("41");

		cleanup(element);
	});

	test("keeps hash-matched items and rebuilds changed ones", async () => {
		const tag = uniqueTag();
		let items = ["alpha", "beta"];

		const MyElement = render(function* () {
			yield () =>
				html`<ul>
					${items.map((value) => html`<li>${value}</li>`)}
				</ul>`;
		});

		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		const [alphaNode, betaNode] = Array.from(
			element.shadowRoot!.querySelectorAll("li"),
		);

		// alpha stays (hash match keeps its node), beta slot changes to "gamma"
		// which has no match and is rebuilt as a fresh node.
		items = ["alpha", "gamma"];
		await element.update();
		await sleep();

		const result = Array.from(element.shadowRoot!.querySelectorAll("li"));
		expect(result.length).toBe(2);
		expect(result[0]).toBe(alphaNode);
		expect(result[1]).not.toBe(betaNode);
		expect(result[1].textContent).toContain("gamma");

		cleanup(element);
	});

	test("in-place reuse does not starve hash matches that appear later", async () => {
		const tag = uniqueTag();
		let items = ["a", "c"];

		const MyElement = render(function* () {
			yield () =>
				html`<ul>
					${items.map((value) => html`<li>${value}</li>`)}
				</ul>`;
		});

		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		const [aNode, cNode] = Array.from(
			element.shadowRoot!.querySelectorAll("li"),
		);

		// Inserting in the middle: hash for "c" must still find the existing cNode
		// rather than cNode being consumed by an in-place update for "b".
		items = ["a", "b", "c"];
		await element.update();
		await sleep();

		const after = Array.from(element.shadowRoot!.querySelectorAll("li"));
		expect(after.length).toBe(3);
		expect(after[0]).toBe(aNode);
		expect(after[2]).toBe(cNode);
		expect(after[1].textContent).toContain("b");

		cleanup(element);
	});

	test("rebuilds items when attribute values change on a same-structure list", async () => {
		const tag = uniqueTag();
		let items = [
			{ width: 10, label: "first" },
			{ width: 20, label: "second" },
		];

		const MyElement = render(function* () {
			yield () =>
				html`<ul>
					${items.map(
						(item) =>
							html`<li style="width:${item.width}px">${item.label}</li>`,
					)}
				</ul>`;
		});

		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		const originalLis = Array.from(element.shadowRoot!.querySelectorAll("li"));
		expect(originalLis[0].getAttribute("style")).toContain("10px");

		items = [
			{ width: 15, label: "first" },
			{ width: 25, label: "second" },
		];
		await element.update();
		await sleep();

		const updatedLis = Array.from(element.shadowRoot!.querySelectorAll("li"));
		// width changed => no hash match => each item is rebuilt as a fresh node
		// carrying the new attribute value
		expect(updatedLis[0]).not.toBe(originalLis[0]);
		expect(updatedLis[1]).not.toBe(originalLis[1]);
		expect(updatedLis[0].getAttribute("style")).toContain("15px");
		expect(updatedLis[1].getAttribute("style")).toContain("25px");

		cleanup(element);
	});

	test("reconciles nested lists across outer reorder and inner reorder", async () => {
		const tag = uniqueTag();
		let groups = [
			{ name: "a", items: ["a1", "a2"] },
			{ name: "b", items: ["b1", "b2"] },
		];

		const MyElement = render(function* () {
			yield () =>
				html`<ul>
					${groups.map(
						(group) =>
							html`<li>
								<h3>${group.name}</h3>
								<ul>
									${group.items.map((item) => html`<li>${item}</li>`)}
								</ul>
							</li>`,
					)}
				</ul>`;
		});

		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		const outerUl = element.shadowRoot!.querySelector("ul")!;
		const outerLisBefore = Array.from(outerUl.children) as Array<HTMLElement>;
		const aGroupNode = outerLisBefore[0];
		const bGroupNode = outerLisBefore[1];
		const aInnerItemsBefore = Array.from(
			aGroupNode.querySelector("ul")!.children,
		) as Array<HTMLElement>;
		const bInnerItemsBefore = Array.from(
			bGroupNode.querySelector("ul")!.children,
		) as Array<HTMLElement>;

		// Phase 1: pure outer reorder, inner items unchanged. Outer hashes
		// match, so hash-identity reuse should move whole groups (and their
		// inner subtrees) to the new positions without disturbing inner DOM.
		groups = [
			{ name: "b", items: ["b1", "b2"] },
			{ name: "a", items: ["a1", "a2"] },
		];
		await element.update();
		await sleep();

		const outerLisAfterSwap = Array.from(
			outerUl.children,
		) as Array<HTMLElement>;
		expect(outerLisAfterSwap[0]).toBe(bGroupNode);
		expect(outerLisAfterSwap[1]).toBe(aGroupNode);
		expect(Array.from(bGroupNode.querySelector("ul")!.children)).toEqual(
			bInnerItemsBefore,
		);
		expect(Array.from(aGroupNode.querySelector("ul")!.children)).toEqual(
			aInnerItemsBefore,
		);

		// Phase 2: inner reorder within one group, outer unchanged. The inner
		// change folds into group b's hash, so b no longer hash-matches and the
		// whole group is rebuilt (new outer node, fresh inner subtree). Group a
		// is untouched, so its node and inner subtree keep identity. This also
		// exercises re-entrant renderList without corrupting the sibling group.
		groups = [
			{ name: "b", items: ["b2", "b1"] },
			{ name: "a", items: ["a1", "a2"] },
		];
		await element.update();
		await sleep();

		const outerLisAfterInnerSwap = Array.from(
			outerUl.children,
		) as Array<HTMLElement>;
		expect(outerLisAfterInnerSwap[0]).not.toBe(bGroupNode);
		expect(outerLisAfterInnerSwap[1]).toBe(aGroupNode);

		const bInnerItemsAfter = Array.from(
			outerLisAfterInnerSwap[0].querySelector("ul")!.children,
		) as Array<HTMLElement>;
		expect(bInnerItemsAfter.map((node) => node.textContent!.trim())).toEqual([
			"b2",
			"b1",
		]);

		const aInnerItemsAfter = Array.from(
			aGroupNode.querySelector("ul")!.children,
		) as Array<HTMLElement>;
		expect(aInnerItemsAfter).toEqual(aInnerItemsBefore);

		cleanup(element);
	});

	test("handles lists with duplicate values across reorder and edit", async () => {
		const tag = uniqueTag();
		let items = ["a", "a", "b"];

		const MyElement = render(function* () {
			yield () =>
				html`<ul>
					${items.map((item) => html`<li>${item}</li>`)}
				</ul>`;
		});

		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		const before = Array.from(element.shadowRoot!.querySelectorAll("li"));
		expect(before.length).toBe(3);
		expect(before.map((node) => node.textContent?.trim())).toEqual([
			"a",
			"a",
			"b",
		]);

		items = ["b", "a", "a"];
		await element.update();
		await sleep();

		const afterReorder = Array.from(element.shadowRoot!.querySelectorAll("li"));
		expect(afterReorder.length).toBe(3);
		expect(afterReorder.map((node) => node.textContent?.trim())).toEqual([
			"b",
			"a",
			"a",
		]);

		items = ["b", "a", "c"];
		await element.update();
		await sleep();

		const afterEdit = Array.from(element.shadowRoot!.querySelectorAll("li"));
		expect(afterEdit.length).toBe(3);
		expect(afterEdit.map((node) => node.textContent?.trim())).toEqual([
			"b",
			"a",
			"c",
		]);

		cleanup(element);
	});

	test("clears to empty and re-populates without leaking DOM", async () => {
		const tag = uniqueTag();
		let items: Array<string> = ["a", "b", "c"];

		const MyElement = render(function* () {
			yield () =>
				html`<ul>
					${items.map((item) => html`<li>${item}</li>`)}
				</ul>`;
		});

		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		expect(element.shadowRoot!.querySelectorAll("li").length).toBe(3);

		items = [];
		await element.update();
		await sleep();

		expect(element.shadowRoot!.querySelectorAll("li").length).toBe(0);

		items = ["x", "y", "z"];
		await element.update();
		await sleep();

		const afterRepopulate = Array.from(
			element.shadowRoot!.querySelectorAll("li"),
		);
		expect(afterRepopulate.length).toBe(3);
		expect(afterRepopulate.map((node) => node.textContent?.trim())).toEqual([
			"x",
			"y",
			"z",
		]);

		cleanup(element);
	});

	test("appends a single item and keeps prior nodes untouched", async () => {
		const tag = uniqueTag();
		let items = ["a", "b"];

		const MyElement = render(function* () {
			yield () =>
				html`<ul>
					${items.map((item) => html`<li>${item}</li>`)}
				</ul>`;
		});

		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		const [aNode, bNode] = Array.from(
			element.shadowRoot!.querySelectorAll("li"),
		);

		items = ["a", "b", "c"];
		await element.update();
		await sleep();

		const afterAppend = Array.from(element.shadowRoot!.querySelectorAll("li"));
		expect(afterAppend.length).toBe(3);
		expect(afterAppend[0]).toBe(aNode);
		expect(afterAppend[1]).toBe(bNode);
		expect(afterAppend[2].textContent).toContain("c");

		cleanup(element);
	});

	test("reconciles a list with mixed template shapes", async () => {
		const tag = uniqueTag();
		let items: Array<{ kind: "item" | "divider"; value: string }> = [
			{ kind: "item", value: "one" },
			{ kind: "divider", value: "---" },
			{ kind: "item", value: "two" },
		];

		const MyElement = render(function* () {
			yield () =>
				html`<ul>
					${items.map((entry) =>
						entry.kind === "item"
							? html`<li>${entry.value}</li>`
							: html`<hr data-label="${entry.value}" />`,
					)}
				</ul>`;
		});

		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		const rootBefore = element.shadowRoot!.querySelector("ul")!;
		const liNodesBefore = Array.from(rootBefore.querySelectorAll("li"));
		const hrNodeBefore = rootBefore.querySelector("hr")!;
		expect(liNodesBefore.length).toBe(2);
		expect(hrNodeBefore.getAttribute("data-label")).toBe("---");

		// Pure reorder of mixed-shape entries. Hash matching must preserve
		// each node across the reshuffle even though neighbours at every
		// position change shape (pass-2 structural reuse must NOT kick in).
		items = [
			{ kind: "divider", value: "---" },
			{ kind: "item", value: "two" },
			{ kind: "item", value: "one" },
		];
		await element.update();
		await sleep();

		const rootAfter = element.shadowRoot!.querySelector("ul")!;
		const children = Array.from(rootAfter.children);
		expect(children[0].tagName).toBe("HR");
		expect(children[1].tagName).toBe("LI");
		expect(children[2].tagName).toBe("LI");

		const hrNodeAfter = rootAfter.querySelector("hr")!;
		expect(hrNodeAfter).toBe(hrNodeBefore);
		expect(hrNodeAfter.getAttribute("data-label")).toBe("---");

		const liNodesAfter = Array.from(rootAfter.querySelectorAll("li"));
		expect(liNodesAfter[0]).toBe(liNodesBefore[1]);
		expect(liNodesAfter[1]).toBe(liNodesBefore[0]);

		cleanup(element);
	});

	test("pops a trailing item without disturbing the monotonic prefix", async () => {
		const tag = uniqueTag();
		let items = ["a", "b", "c", "d"];

		const MyElement = render(function* () {
			yield () =>
				html`<ul>
					${items.map((item) => html`<li>${item}</li>`)}
				</ul>`;
		});

		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		const [aNode, bNode, cNode, dNode] = Array.from(
			element.shadowRoot!.querySelectorAll("li"),
		);

		items = ["a", "b", "c"];
		await element.update();
		await sleep();

		const afterPop = Array.from(element.shadowRoot!.querySelectorAll("li"));
		expect(afterPop.length).toBe(3);
		expect(afterPop[0]).toBe(aNode);
		expect(afterPop[1]).toBe(bNode);
		expect(afterPop[2]).toBe(cNode);
		expect(dNode.isConnected).toBe(false);

		cleanup(element);
	});

	test("shifts a leading item without disturbing the tail", async () => {
		const tag = uniqueTag();
		let items = ["a", "b", "c", "d"];

		const MyElement = render(function* () {
			yield () =>
				html`<ul>
					${items.map((item) => html`<li>${item}</li>`)}
				</ul>`;
		});

		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		const [aNode, bNode, cNode, dNode] = Array.from(
			element.shadowRoot!.querySelectorAll("li"),
		);

		items = ["b", "c", "d"];
		await element.update();
		await sleep();

		const afterShift = Array.from(element.shadowRoot!.querySelectorAll("li"));
		expect(afterShift.length).toBe(3);
		expect(afterShift[0]).toBe(bNode);
		expect(afterShift[1]).toBe(cNode);
		expect(afterShift[2]).toBe(dNode);
		expect(aNode.isConnected).toBe(false);

		cleanup(element);
	});

	test("replaces a bounded middle range while preserving stable ends", async () => {
		const tag = uniqueTag();
		let items = ["a", "x", "y", "z", "d"];

		const MyElement = render(function* () {
			yield () =>
				html`<ul>
					${items.map((item) => html`<li>${item}</li>`)}
				</ul>`;
		});

		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		const [aNode, xNode, yNode, zNode, dNode] = Array.from(
			element.shadowRoot!.querySelectorAll("li"),
		);

		// Ends are hash-stable; only the middle three change value. Head/tail
		// peel should isolate the middle so the reconciler's map is sized to
		// three slots, and the two end <li>s must keep identity untouched.
		items = ["a", "m", "n", "o", "d"];
		await element.update();
		await sleep();

		const afterMiddleSwap = Array.from(
			element.shadowRoot!.querySelectorAll("li"),
		);
		expect(afterMiddleSwap.length).toBe(5);
		expect(afterMiddleSwap[0]).toBe(aNode);
		expect(afterMiddleSwap[4]).toBe(dNode);
		expect(afterMiddleSwap[1].textContent).toContain("m");
		expect(afterMiddleSwap[2].textContent).toContain("n");
		expect(afterMiddleSwap[3].textContent).toContain("o");
		// the middle three have no hash match, so they are rebuilt as fresh nodes
		// rather than patched in place — only the peeled ends keep identity
		expect(afterMiddleSwap[1]).not.toBe(xNode);
		expect(afterMiddleSwap[2]).not.toBe(yNode);
		expect(afterMiddleSwap[3]).not.toBe(zNode);

		cleanup(element);
	});

	test("re-renders an identical list without disturbing DOM identity", async () => {
		const tag = uniqueTag();
		// New array reference each render, identical hash-per-item contents.
		// The binding still dirties (array path in update()), so renderList
		// runs; head peel should consume everything with zero DOM work and no
		// middle bookkeeping.
		let items = ["a", "b", "c"];

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

		items = ["a", "b", "c"];
		await element.update();
		await sleep();

		const afterNoop = Array.from(element.shadowRoot!.querySelectorAll("li"));
		expect(afterNoop.length).toBe(3);
		expect(afterNoop[0]).toBe(original[0]);
		expect(afterNoop[1]).toBe(original[1]);
		expect(afterNoop[2]).toBe(original[2]);

		cleanup(element);
	});

	test("appends several items in one update without touching prior nodes", async () => {
		const tag = uniqueTag();
		let items = ["a", "b"];

		const MyElement = render(function* () {
			yield () =>
				html`<ul>
					${items.map((item) => html`<li>${item}</li>`)}
				</ul>`;
		});

		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		const [aNode, bNode] = Array.from(
			element.shadowRoot!.querySelectorAll("li"),
		);

		items = ["a", "b", "c", "d", "e"];
		await element.update();
		await sleep();

		const afterAppend = Array.from(element.shadowRoot!.querySelectorAll("li"));
		expect(afterAppend.length).toBe(5);
		expect(afterAppend[0]).toBe(aNode);
		expect(afterAppend[1]).toBe(bNode);
		expect(afterAppend[2].textContent).toContain("c");
		expect(afterAppend[3].textContent).toContain("d");
		expect(afterAppend[4].textContent).toContain("e");

		cleanup(element);
	});

	test("prepends several items in one update without touching the surviving tail", async () => {
		const tag = uniqueTag();
		let items = ["d", "e"];

		const MyElement = render(function* () {
			yield () =>
				html`<ul>
					${items.map((item) => html`<li>${item}</li>`)}
				</ul>`;
		});

		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		const [dNode, eNode] = Array.from(
			element.shadowRoot!.querySelectorAll("li"),
		);

		items = ["a", "b", "c", "d", "e"];
		await element.update();
		await sleep();

		const afterPrepend = Array.from(element.shadowRoot!.querySelectorAll("li"));
		expect(afterPrepend.length).toBe(5);
		expect(afterPrepend[0].textContent).toContain("a");
		expect(afterPrepend[1].textContent).toContain("b");
		expect(afterPrepend[2].textContent).toContain("c");
		// Tail peel preserves both existing <li>s; the inserts land ahead of
		// them with no moves.
		expect(afterPrepend[3]).toBe(dNode);
		expect(afterPrepend[4]).toBe(eNode);

		cleanup(element);
	});

	test("deleting a middle item preserves identity of the monotonic prefix and the tail", async () => {
		const tag = uniqueTag();
		let items = ["a", "b", "c", "d", "e"];

		const MyElement = render(function* () {
			yield () =>
				html`<ul>
					${items.map((item) => html`<li>${item}</li>`)}
				</ul>`;
		});

		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		const [aNode, bNode, cNode, , eNode] = Array.from(
			element.shadowRoot!.querySelectorAll("li"),
		);

		items = ["a", "b", "c", "e"];
		await element.update();
		await sleep();

		const after = Array.from(element.shadowRoot!.querySelectorAll("li"));
		expect(after.length).toBe(4);
		expect(after[0]).toBe(aNode);
		expect(after[1]).toBe(bNode);
		expect(after[2]).toBe(cNode);
		expect(after[3]).toBe(eNode);

		cleanup(element);
	});

	test("wraps primitive list items in templates without forcing the caller to call html`` themselves", async () => {
		// content.ts toTemplateList (line 31) lifts each non-template entry into
		// `html\`${entry}\``. Callers that map straight to strings or numbers
		// should still render, and updates that change a primitive in place
		// must update the corresponding text without disturbing siblings.
		const tag = uniqueTag();
		let items: Array<string | number> = ["alpha", 2, "gamma"];

		const MyElement = render(function* () {
			yield () =>
				html`<ul>
					${items}
				</ul>`;
		});

		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		expect(element.shadowRoot?.textContent).toContain("alpha");
		expect(element.shadowRoot?.textContent).toContain("2");
		expect(element.shadowRoot?.textContent).toContain("gamma");

		items = ["alpha", 99, "gamma"];
		await element.update();
		await sleep();

		expect(element.shadowRoot?.textContent).toContain("99");
		expect(element.shadowRoot?.textContent).not.toContain(" 2 ");

		cleanup(element);
	});

	test("re-renders a list mutated in place on the same array reference", async () => {
		// A held array mutated in place (push / index assignment) and re-rendered
		// without allocating a fresh array: renderList diffs the live array against
		// its own snapshot, so the mutation is seen even though the binding's value
		// is `=== ` its prior value. The user's array is never rewritten into
		// HTMLTemplates as a side channel.
		const tag = uniqueTag();
		const items: Array<string> = ["a", "b", "c"];

		const MyElement = render(function* () {
			yield () => html`<ul>${items}</ul>`;
		});

		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		// bare primitive items render as adjacent text nodes with no separator
		const text = () =>
			element.shadowRoot!.textContent!.replace(/\s+/g, "").trim();
		expect(text()).toBe("abc");
		// the engine must not have replaced the caller's primitives with wrappers
		expect(items).toEqual(["a", "b", "c"]);

		items.push("d");
		items[0] = "A";
		await element.update();
		await sleep();

		expect(text()).toBe("Abcd");
		expect(items).toEqual(["A", "b", "c", "d"]);

		items.reverse();
		await element.update();
		await sleep();

		expect(text()).toBe("dcbA");

		cleanup(element);
	});

	test("static HTML comments in the template survive a render pass", async () => {
		// template-html.ts #findTargets walks every comment but only treats those
		// carrying the binding-marker prefix as markers. Static author
		// comments must pass through the tree walker untouched and not be picked
		// up as markers; if they were, the binding indices would shift and the
		// content binding below would lose its anchors.
		const tag = uniqueTag();
		let label = "first";

		const MyElement = render(function* () {
			yield () => html`<section><!-- author note -->${label}</section>`;
		});

		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		const section = element.shadowRoot?.querySelector("section")!;
		expect(section.textContent).toContain("first");

		const commentDataValues: Array<string> = [];
		for (const child of section.childNodes) {
			if (child.nodeType === Node.COMMENT_NODE) {
				commentDataValues.push((child as Comment).data);
			}
		}
		expect(commentDataValues).toContain(" author note ");

		label = "second";
		await element.update();
		await sleep();

		// The binding still resolves to the correct text after update, which proves
		// the static comment didn't get treated as an extra marker and shift the
		// content binding's start/end anchors.
		expect(section.textContent).toContain("second");

		cleanup(element);
	});

	test("renders and updates a dynamic HTML comment binding", async () => {
		// content.ts renderComment path: a comment whose content interpolates an
		// expression (binding.values.length > 1) renders as a real comment node
		// between its markers, and update() recreates it with the new value. No
		// other rendering test exercises this branch.
		const tag = uniqueTag();
		let note = "first";

		const MyElement = render(function* () {
			yield () => html`<section><!-- ${note} --></section>`;
		});

		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		const commentText = (section: Element) =>
			Array.from(section.childNodes)
				.filter((node) => node.nodeType === Node.COMMENT_NODE)
				.map((node) => (node as Comment).data);

		const section = element.shadowRoot!.querySelector("section")!;
		// the rendered comment carries the interpolated value; the bracketing
		// marker comments carry the binding identifier, never the user value
		expect(commentText(section)).toContain(" first ");

		note = "second";
		await element.update();
		await sleep();

		expect(commentText(section)).toContain(" second ");
		expect(commentText(section)).not.toContain(" first ");

		cleanup(element);
	});

	test("updates one expression in a multi-expression comment binding", async () => {
		// `<!-- ${a} and ${b} -->` folds both expressions into a single comment
		// binding; changing one must re-render the comment with both current values.
		const tag = uniqueTag();
		let left = "a";
		let right = "b";

		const MyElement = render(function* () {
			yield () => html`<section><!-- ${left} and ${right} --></section>`;
		});

		customElements.define(tag, MyElement);
		const element = mount(tag) as InstanceType<typeof MyElement>;
		await sleep();

		const commentText = (section: Element) =>
			Array.from(section.childNodes)
				.filter((node) => node.nodeType === Node.COMMENT_NODE)
				.map((node) => (node as Comment).data);

		const section = element.shadowRoot!.querySelector("section")!;
		expect(commentText(section)).toContain(" a and b ");

		right = "c";
		await element.update();
		await sleep();

		expect(commentText(section)).toContain(" a and c ");

		cleanup(element);
	});
});
