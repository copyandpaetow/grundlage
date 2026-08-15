//must come first — parser/html.ts runs `document.createElement` at module load
import "./ssr-setup";

import { afterEach, describe, expect, test } from "vitest";
import { component, html } from "../../src/index";

const flushMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0));

let nextTagId = 0;
const uniqueTag = (role: string) =>
	`defer-${role}-${nextTagId++}-${Date.now()}`;

const trackedElements: Array<HTMLElement> = [];
afterEach(() => {
	while (trackedElements.length) trackedElements.pop()!.remove();
});

class Quote {
	constructor(public text: string) {}
}

const childTagRenderingItsQuote = (): string => {
	const tag = uniqueTag("child");
	customElements.define(
		tag,
		component(
			function* (componentProps) {
				yield () =>
					html`<blockquote>${componentProps.quote?.text}</blockquote>`;
			},
			{
				props: {
					quote: (incoming: unknown) =>
						incoming instanceof Quote ? incoming : new Quote("…"),
				},
			},
		),
	);
	return tag;
};

const renderOnServer = async (
	body: () => Generator<unknown, void, unknown>,
): Promise<ShadowRoot> => {
	const tag = uniqueTag("parent");
	customElements.define(tag, component(body));
	const element = document.createElement(tag);
	trackedElements.push(element);
	document.body.appendChild(element);
	await flushMicrotasks();
	return element.shadowRoot!;
};

describe("defer-hydration: the server marks the children it owes a value", () => {
	test("the server-environment check fires in this node test process", () => {
		expect(typeof window).toBe("undefined");
	});

	test("a declared prop the attribute cannot carry marks the child", async () => {
		const childTag = childTagRenderingItsQuote();
		const shadowRoot = await renderOnServer(function* () {
			const quote = new Quote("said out loud");
			yield () => html`<${childTag} quote=${quote}></${childTag}>`;
		});

		expect(
			shadowRoot.querySelector(childTag)!.hasAttribute("defer-hydration"),
		).toBe(true);
	});

	test("a declared prop with a string spelling rides its attribute and is not marked", async () => {
		const childTag = childTagRenderingItsQuote();
		const shadowRoot = await renderOnServer(function* () {
			yield () => html`<${childTag} quote=${"plain text"}></${childTag}>`;
		});

		expect(
			shadowRoot.querySelector(childTag)!.hasAttribute("defer-hydration"),
		).toBe(false);
	});

	test("an undeclared name taking the property channel marks the child", async () => {
		const childTag = childTagRenderingItsQuote();
		const shadowRoot = await renderOnServer(function* () {
			yield () => html`<${childTag} rows=${[1, 2, 3]}></${childTag}>`;
		});

		expect(
			shadowRoot.querySelector(childTag)!.hasAttribute("defer-hydration"),
		).toBe(true);
	});

	test("a spread carrying an object marks the child, a spread of strings does not", async () => {
		const childTag = childTagRenderingItsQuote();
		const shadowRoot = await renderOnServer(function* () {
			yield () => html`
				<${childTag} id="carried" ${{ rows: [1] }}></${childTag}>
				<${childTag} id="spelled" ${{ title: "text" }}></${childTag}>
			`;
		});

		expect(
			shadowRoot.querySelector("#carried")!.hasAttribute("defer-hydration"),
		).toBe(true);
		expect(
			shadowRoot.querySelector("#spelled")!.hasAttribute("defer-hydration"),
		).toBe(false);
	});

	//the mark is written into the parent's detached fragment, so it is already on the child when
	//that fragment is connected; honouring it on the server would leave the child unrendered
	test("a marked child still runs its own server render", async () => {
		const childTag = uniqueTag("child");
		let childBodyRuns = 0;
		let quoteSeenByChild = "";
		customElements.define(
			childTag,
			component(
				function* (componentProps) {
					childBodyRuns++;
					quoteSeenByChild = componentProps.quote!.text;
					yield () => html`<blockquote>${quoteSeenByChild}</blockquote>`;
				},
				{
					props: {
						quote: (incoming: unknown) =>
							incoming instanceof Quote ? incoming : new Quote("…"),
					},
				},
			),
		);

		const shadowRoot = await renderOnServer(function* () {
			const quote = new Quote("said out loud");
			yield () => html`<${childTag} quote=${quote}></${childTag}>`;
		});

		expect(
			shadowRoot.querySelector(childTag)!.hasAttribute("defer-hydration"),
		).toBe(true);
		expect(childBodyRuns).toBe(1);
		expect(quoteSeenByChild).toBe("said out loud");
	});
});
