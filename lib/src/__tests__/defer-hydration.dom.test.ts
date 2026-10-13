import { afterEach, describe, expect, test } from "vitest";
import { component, html } from "../index";
import { DEFER_HYDRATION_ATTRIBUTE } from "../rendering/constants";
import { releaseDeferredChildren } from "../rendering/defer-hydration";

const flushMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0));

let nextTagId = 0;
const uniqueTag = () => `deferred-el-${nextTagId++}-${Date.now()}`;

const trackedElements: Array<HTMLElement> = [];
afterEach(() => {
	while (trackedElements.length) trackedElements.pop()!.remove();
});

interface DeferrableElement extends HTMLElement {
	label?: string;
}

const defineCountingComponent = (): {
	tag: string;
	bodyRunsOf: () => number;
} => {
	const tag = uniqueTag();
	let bodyRuns = 0;
	customElements.define(
		tag,
		component(
			function* (componentProps) {
				bodyRuns++;
				yield () => html`<p>${componentProps.label ?? "nothing yet"}</p>`;
			},
			{ props: { label: String } },
		),
	);
	return { tag, bodyRunsOf: () => bodyRuns };
};

const connectMarked = (tag: string): DeferrableElement => {
	const element = document.createElement(tag) as DeferrableElement;
	element.setAttribute(DEFER_HYDRATION_ATTRIBUTE, "");
	trackedElements.push(element);
	document.body.appendChild(element);
	return element;
};

describe("defer-hydration: a marked child waits for its parent", () => {
	test("the mark holds the mount at connect", async () => {
		const { tag, bodyRunsOf } = defineCountingComponent();
		const element = connectMarked(tag);
		await flushMicrotasks();

		expect(bodyRunsOf()).toBe(0);
		expect(element.shadowRoot!.textContent).toBe("");
	});

	test("removing the mark mounts once, on the value that landed while it waited", async () => {
		const { tag, bodyRunsOf } = defineCountingComponent();
		const element = connectMarked(tag);
		await flushMicrotasks();

		element.label = "supplied";
		element.removeAttribute(DEFER_HYDRATION_ATTRIBUTE);
		await flushMicrotasks();

		expect(bodyRunsOf()).toBe(1);
		expect(element.shadowRoot!.textContent).toBe("supplied");
	});

	test("an unmarked element mounts at connect, as it always did", async () => {
		const { tag, bodyRunsOf } = defineCountingComponent();
		const element = document.createElement(tag) as DeferrableElement;
		trackedElements.push(element);
		document.body.appendChild(element);
		await flushMicrotasks();

		expect(bodyRunsOf()).toBe(1);
		expect(element.shadowRoot!.textContent).toBe("nothing yet");
	});

	//a prop write while parked funnels into update(), which already returns early with no task
	test("a prop assigned while parked schedules nothing and mounts once on release", async () => {
		const { tag, bodyRunsOf } = defineCountingComponent();
		const element = connectMarked(tag);

		element.label = "first";
		element.label = "second";
		await flushMicrotasks();
		expect(bodyRunsOf()).toBe(0);

		element.removeAttribute(DEFER_HYDRATION_ATTRIBUTE);
		await flushMicrotasks();

		expect(bodyRunsOf()).toBe(1);
		expect(element.shadowRoot!.textContent).toBe("second");
	});

	test("a disconnected element is not mounted by the release, but a later connect is", async () => {
		const { tag, bodyRunsOf } = defineCountingComponent();
		const element = connectMarked(tag);
		await flushMicrotasks();

		element.remove();
		element.removeAttribute(DEFER_HYDRATION_ATTRIBUTE);
		await flushMicrotasks();
		expect(bodyRunsOf()).toBe(0);

		document.body.appendChild(element);
		await flushMicrotasks();
		expect(bodyRunsOf()).toBe(1);
	});

	//the parked state is the absent task plus the attribute, and the attribute travels with the
	//element, so a reconnect re-parks without a field to restore
	test("a reconnect while still marked stays parked", async () => {
		const { tag, bodyRunsOf } = defineCountingComponent();
		const element = connectMarked(tag);
		await flushMicrotasks();

		element.remove();
		await flushMicrotasks();
		document.body.appendChild(element);
		await flushMicrotasks();

		expect(bodyRunsOf()).toBe(0);

		element.removeAttribute(DEFER_HYDRATION_ATTRIBUTE);
		await flushMicrotasks();
		expect(bodyRunsOf()).toBe(1);
	});

	test("a client render never marks its children", async () => {
		const childTag = uniqueTag();
		customElements.define(
			childTag,
			component(function* () {
				yield () => html`<span>child</span>`;
			}),
		);
		const parentTag = uniqueTag();
		customElements.define(
			parentTag,
			component(function* () {
				yield () => html`<${childTag} rows=${[1, 2]}></${childTag}>`;
			}),
		);

		const parent = document.createElement(parentTag);
		trackedElements.push(parent);
		document.body.appendChild(parent);
		await flushMicrotasks();

		expect(
			parent
				.shadowRoot!.querySelector(childTag)!
				.hasAttribute(DEFER_HYDRATION_ATTRIBUTE),
		).toBe(false);
	});

	test("defer-hydration is refused as a prop name", () => {
		expect(() =>
			component(function* () {}, { props: { "defer-hydration": String } }),
		).toThrow(/reserved/);
	});
});

describe("releaseDeferredChildren", () => {
	test("clears this root's marks and stops at a nested shadow root", () => {
		const host = document.createElement("div");
		trackedElements.push(host);
		document.body.appendChild(host);
		const shadowRoot = host.attachShadow({ mode: "open" });

		const direct = document.createElement("span");
		direct.setAttribute(DEFER_HYDRATION_ATTRIBUTE, "");
		const nestedHost = document.createElement("div");
		shadowRoot.append(direct, nestedHost);

		const deeper = document.createElement("span");
		deeper.setAttribute(DEFER_HYDRATION_ATTRIBUTE, "");
		nestedHost.attachShadow({ mode: "open" }).append(deeper);

		releaseDeferredChildren(shadowRoot);

		expect(direct.hasAttribute(DEFER_HYDRATION_ATTRIBUTE)).toBe(false);
		expect(deeper.hasAttribute(DEFER_HYDRATION_ATTRIBUTE)).toBe(true);
	});
});
