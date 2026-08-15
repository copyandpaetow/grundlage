import { describe, expect, test } from "vitest";
import { component, html } from "../index";
import { BaseComponent, ComponentProps } from "../types";

const sleep = (duration = 0) =>
	new Promise((resolve) => setTimeout(resolve, duration));

let tagId = 0;
const uniqueTag = () => `props-object-${tagId++}-${Date.now()}`;

const mount = (tag: string): BaseComponent => {
	const element = document.createElement(tag) as BaseComponent;
	document.body.appendChild(element);
	return element;
};

describe("the object a component receives", () => {
	test("carries host plus the declared props, and nothing else", async () => {
		const tag = uniqueTag();
		let received: ComponentProps<{
			label: [StringConstructor, string];
		}> | null = null;
		customElements.define(
			tag,
			component(
				function* (componentProps) {
					received = componentProps;
					yield () => html`<p>x</p>`;
				},
				{ props: { label: [String, "anon"] } },
			),
		);
		const element = mount(tag);
		await sleep();

		expect(Object.keys(received!).sort()).toEqual(["host", "label"]);
		expect(received!.host).toBe(element);
		expect(received!.label).toBe("anon");
		element.remove();
	});

	test("a read sees what the store holds at the moment of access", async () => {
		const tag = uniqueTag();
		let componentProps: ComponentProps<{ userid: StringConstructor }> | null =
			null;
		customElements.define(
			tag,
			component(
				function* (received) {
					componentProps = received;
					yield () => html`<p>x</p>`;
				},
				{ props: { userid: String } },
			),
		);
		const element = document.createElement(tag);
		element.setAttribute("userid", "7");
		document.body.appendChild(element);
		await sleep();

		expect(componentProps!.userid).toBe("7");
		element.setAttribute("userid", "8");
		expect(componentProps!.userid).toBe("8");
		element.remove();
	});

	test("the write spelling is host, and it parses, reflects and schedules", async () => {
		const tag = uniqueTag();
		let componentProps: ComponentProps<{
			userid: StringConstructor;
		}> | null = null;
		let renderCount = 0;
		customElements.define(
			tag,
			component(
				function* (received) {
					componentProps = received;
					yield () => {
						renderCount++;
						return html`<p>x</p>`;
					};
				},
				{ props: { userid: String } },
			),
		);
		const element = document.createElement(tag) as BaseComponent;
		element.setAttribute("userid", "7");
		document.body.appendChild(element);
		await sleep();
		renderCount = 0;

		componentProps!.host.userid = "9";
		expect(componentProps!.userid).toBe("9");
		expect(element.getAttribute("userid")).toBe("9");
		await sleep();
		expect(renderCount).toBe(1);
		element.remove();
	});

	test("spreading takes a snapshot; holding the object keeps the live view", async () => {
		const tag = uniqueTag();
		let componentProps: ComponentProps<{ userid: StringConstructor }> | null =
			null;
		customElements.define(
			tag,
			component(
				function* (received) {
					componentProps = received;
					yield () => html`<p>x</p>`;
				},
				{ props: { userid: String } },
			),
		);
		const element = document.createElement(tag);
		element.setAttribute("userid", "7");
		document.body.appendChild(element);
		await sleep();

		const frozen = { ...componentProps! };
		expect(frozen.userid).toBe("7");
		expect(frozen.host).toBe(element);

		element.setAttribute("userid", "8");
		expect(frozen.userid).toBe("7");
		expect(componentProps!.userid).toBe("8");
		element.remove();
	});

	test("two instances hold two objects", async () => {
		const tag = uniqueTag();
		const received: Array<unknown> = [];
		customElements.define(
			tag,
			component(function* (componentProps) {
				received.push(componentProps);
				yield () => html`<p>x</p>`;
			}),
		);
		const first = mount(tag);
		const second = mount(tag);
		await sleep();

		expect(received.length).toBe(2);
		expect(received[0]).not.toBe(received[1]);
		first.remove();
		second.remove();
	});
});

describe("one calling convention", () => {
	test("an inner generator receives the same object", async () => {
		const tag = uniqueTag();
		let outer: unknown = null;
		let inner: unknown = null;
		customElements.define(
			tag,
			component(
				function* (componentProps) {
					outer = componentProps;
					yield function* (received: ComponentProps) {
						inner = received;
						yield () => html`<p>inner</p>`;
					};
				},
				{ props: { label: [String, "x"] } },
			),
		);
		const element = mount(tag);
		await sleep();

		expect(inner).toBe(outer);
		element.remove();
	});

	test("a mixin called through yield* takes whatever the caller passes", async () => {
		const tag = uniqueTag();
		const userCard = function* ({
			host,
			userId,
		}: {
			host: BaseComponent;
			userId: string | undefined;
		}) {
			yield () => html`<p>${userId} on ${host.localName}</p>`;
		};

		customElements.define(
			tag,
			component(
				function* (componentProps) {
					yield* userCard({
						...componentProps,
						userId: componentProps.activeUserId,
					});
				},
				{ props: { activeUserId: String } },
			),
		);
		const element = document.createElement(tag);
		element.setAttribute("activeuserid", "ada");
		document.body.appendChild(element);
		await sleep();

		expect(element.shadowRoot?.textContent).toContain("ada");
		element.remove();
	});
});
