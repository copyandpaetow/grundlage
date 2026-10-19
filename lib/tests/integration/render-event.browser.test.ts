import { afterEach, describe, expect, test } from "vitest";
import { component, html } from "../../src/index";

const sleep = (milliseconds = 0) =>
	new Promise((resolve) => setTimeout(resolve, milliseconds));

//the same browser plays the server: the flag is what isServer() reads
const serverFlagHolder = globalThis as { __grundlage_ssr__?: boolean };

interface AnnouncedRender {
	event: Event;
	//read during the dispatch: composedPath() is empty once it ends
	origin: EventTarget;
}

let tagCount = 0;
const uniqueTag = (role: string) => `test-render-event-${role}-${tagCount++}`;

const containers: Array<HTMLElement> = [];

afterEach(async () => {
	serverFlagHolder.__grundlage_ssr__ = false;
	while (containers.length > 0) containers.pop()!.remove();
	await sleep();
});

//the listener sits on an ancestor, where a server render listens, and cancels the render of one tag
const mountListening = (tag: string, cancelledTag: string | null = null) => {
	const container = document.createElement("div");
	const announced: Array<AnnouncedRender> = [];
	container.addEventListener("grundlage-render", (event) => {
		const origin = event.composedPath()[0];
		announced.push({ event, origin });
		if (origin instanceof Element && origin.localName === cancelledTag)
			event.preventDefault();
	});
	const element = document.createElement(tag);
	container.append(element);
	containers.push(container);
	document.body.append(container);
	return { element, announced };
};

describe("grundlage-render on the server", () => {
	test("a component about to run announces its render to its ancestors, bubbling, composed and cancelable", () => {
		serverFlagHolder.__grundlage_ssr__ = true;
		const tag = uniqueTag("runs");
		customElements.define(
			tag,
			component(function* () {
				yield html`<p>painted</p>`;
			}),
		);

		const { element, announced } = mountListening(tag);

		expect(announced).toHaveLength(1);
		expect(announced[0].origin).toBe(element);
		expect(announced[0].event.bubbles).toBe(true);
		expect(announced[0].event.composed).toBe(true);
		expect(announced[0].event.cancelable).toBe(true);
		expect(element.shadowRoot!.textContent).toContain("painted");
	});

	test("a cancelled render leaves the component unstarted: its body never runs and nothing paints", async () => {
		serverFlagHolder.__grundlage_ssr__ = true;
		let hasRun = false;
		const tag = uniqueTag("cancelled");
		customElements.define(
			tag,
			component(function* () {
				hasRun = true;
				yield html`<p>painted</p>`;
			}),
		);

		const { element } = mountListening(tag, tag);
		await sleep();

		expect(hasRun).toBe(false);
		expect(element.shadowRoot!.childNodes).toHaveLength(0);
	});

	test("a nested child's render crosses its parent's shadow root, and cancelling it leaves only that child unstarted", async () => {
		serverFlagHolder.__grundlage_ssr__ = true;
		let childHasRun = false;
		const childTag = uniqueTag("child");
		const parentTag = uniqueTag("parent");
		customElements.define(
			childTag,
			component(function* () {
				childHasRun = true;
				yield html`<p>child</p>`;
			}),
		);
		customElements.define(
			parentTag,
			component(function* () {
				yield html`<section>${childOf(childTag)}</section>`;
			}),
		);

		const { element, announced } = mountListening(parentTag, childTag);
		await sleep();

		const child = element.shadowRoot!.querySelector(childTag)!;
		expect(announced).toHaveLength(2);
		expect(announced[0].origin).toBe(element);
		expect(announced[1].origin).toBe(child);
		expect(element.shadowRoot!.querySelector("section")).not.toBeNull();
		expect(childHasRun).toBe(false);
		expect(child.shadowRoot!.childNodes).toHaveLength(0);
	});
});

describe("grundlage-render in the browser", () => {
	test("nothing is announced: no browser listener decides whether a component runs", () => {
		const tag = uniqueTag("browser");
		customElements.define(
			tag,
			component(function* () {
				yield html`<p>painted</p>`;
			}),
		);

		const { element, announced } = mountListening(tag);

		expect(element.shadowRoot!.textContent).toContain("painted");
		expect(announced).toEqual([]);
	});
});

//a child tag known only at run time, so it is spliced into the template as a dynamic tag
const childOf = (childTag: string) => html`<${childTag}></${childTag}>`;
