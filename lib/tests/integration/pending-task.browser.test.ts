import { afterEach, describe, expect, test } from "vitest";
import { awaited, component, html, load } from "../../src/index";

const sleep = (milliseconds = 0) =>
	new Promise((resolve) => setTimeout(resolve, milliseconds));

//the same browser plays the server: the flag is what isServer() reads
const serverFlagHolder = globalThis as { __grundlage_ssr__?: boolean };

interface PendingTaskEventShape extends Event {
	readonly complete: Promise<unknown>;
}

interface AnnouncedTask {
	event: PendingTaskEventShape;
	//read during the dispatch: composedPath() is empty once it ends
	origin: EventTarget;
}

let tagCount = 0;
const uniqueTag = (role: string) => `test-pending-task-${role}-${tagCount++}`;

const containers: Array<HTMLElement> = [];

afterEach(async () => {
	serverFlagHolder.__grundlage_ssr__ = false;
	while (containers.length > 0) containers.pop()!.remove();
	await sleep();
});

//the listener sits on an ancestor in the capture phase, where a server render listens
const mountListening = (tag: string) => {
	const container = document.createElement("div");
	const announced: Array<AnnouncedTask> = [];
	container.addEventListener(
		"pending-task",
		(event) =>
			announced.push({
				event: event as PendingTaskEventShape,
				origin: event.composedPath()[0],
			}),
		{ capture: true },
	);
	const element = document.createElement(tag);
	container.append(element);
	containers.push(container);
	document.body.append(container);
	return { element, announced };
};

describe("pending-task on the server", () => {
	test("a run waiting on a promise announces it to its ancestors, composed and bubbling", async () => {
		serverFlagHolder.__grundlage_ssr__ = true;
		const waited = Promise.resolve("value");
		const tag = uniqueTag("waits");
		customElements.define(
			tag,
			component(function* () {
				const value = yield* awaited(waited);
				yield html`<p>${value}</p>`;
			}),
		);

		const { element, announced } = mountListening(tag);

		expect(announced).toHaveLength(1);
		expect(announced[0].origin).toBe(element);
		expect(announced[0].event.bubbles).toBe(true);
		expect(announced[0].event.composed).toBe(true);
		expect(announced[0].event.complete).toBe(waited);
	});

	test("a nested child's task crosses its parent's shadow root", async () => {
		serverFlagHolder.__grundlage_ssr__ = true;
		const childTag = uniqueTag("child");
		const parentTag = uniqueTag("parent");
		customElements.define(
			childTag,
			component(function* () {
				yield sleep(5);
				yield html`<p>child</p>`;
			}),
		);
		customElements.define(
			parentTag,
			component(function* () {
				yield html`<section>${childOf(childTag)}</section>`;
			}),
		);

		const { element, announced } = mountListening(parentTag);

		expect(announced).toHaveLength(1);
		const child = element.shadowRoot!.querySelector(childTag);
		expect(announced[0].origin).toBe(child);
	});

	test("a load() that waits announces its fetcher's promise", async () => {
		serverFlagHolder.__grundlage_ssr__ = true;
		const fetched = Promise.resolve({ title: "a post" });
		const tag = uniqueTag("loads");
		customElements.define(
			tag,
			component(function* () {
				const post = yield* load(() => fetched);
				yield html`<p>${post.title}</p>`;
			}),
		);

		const { announced } = mountListening(tag);

		expect(announced).toHaveLength(1);
		expect(announced[0].event.complete).toBe(fetched);
	});

	test("a task settles only after its run went on, so the child that run paints has announced its own", async () => {
		serverFlagHolder.__grundlage_ssr__ = true;
		const childTag = uniqueTag("late-child");
		const parentTag = uniqueTag("waiting-parent");
		customElements.define(
			childTag,
			component(function* () {
				yield sleep(5);
				yield html`<p>child</p>`;
			}),
		);
		customElements.define(
			parentTag,
			component(function* () {
				yield sleep(5);
				yield html`<section>${childOf(childTag)}</section>`;
			}),
		);

		//awaited from inside the dispatch, the way a listener that waits for each task does
		const container = document.createElement("div");
		containers.push(container);
		let announcedCount = 0;
		let announcedWhenParentSettled = 0;
		let parentSettled: Promise<void> | null = null;
		container.addEventListener(
			"pending-task",
			(event) => {
				announcedCount++;
				parentSettled ??= (event as PendingTaskEventShape).complete.then(() => {
					announcedWhenParentSettled = announcedCount;
				});
			},
			{ capture: true },
		);
		container.append(document.createElement(parentTag));
		document.body.append(container);
		await parentSettled;

		expect(announcedWhenParentSettled).toBe(2);
	});

	test("a run that paints without waiting announces nothing", () => {
		serverFlagHolder.__grundlage_ssr__ = true;
		const tag = uniqueTag("paints");
		customElements.define(
			tag,
			component(function* () {
				yield html`<p>painted</p>`;
			}),
		);

		const { announced } = mountListening(tag);

		expect(announced).toEqual([]);
	});
});

describe("pending-task in the browser", () => {
	test("nothing is announced: no browser listener waits for these", async () => {
		const tag = uniqueTag("browser");
		customElements.define(
			tag,
			component(function* () {
				const value = yield* awaited(Promise.resolve("value"));
				yield html`<p>${value}</p>`;
			}),
		);

		const { element, announced } = mountListening(tag);
		await sleep();

		expect(element.shadowRoot!.textContent).toContain("value");
		expect(announced).toEqual([]);
	});
});

//a child tag known only at run time, so it is spliced into the template as a dynamic tag
const childOf = (childTag: string) => html`<${childTag}></${childTag}>`;
