import { afterEach, describe, expect, test, vi } from "vitest";
import { component, ComponentErrorEvent, html, prop } from "../index";
import { DEFER_HYDRATION_ATTRIBUTE } from "../rendering/constants";
import type { BaseComponent, Schema, StandardSchemaV1 } from "../types";

const sleep = () => new Promise((resolve) => setTimeout(resolve, 0));
const nextFrame = () =>
	new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));

let nextTagId = 0;
const uniqueTag = () => `prop-kind-${nextTagId++}-${Date.now()}`;

const trackedElements: Array<HTMLElement> = [];
const mount = <Element extends HTMLElement>(element: Element): Element => {
	trackedElements.push(element);
	document.body.append(element);
	return element;
};

afterEach(() => {
	while (trackedElements.length) trackedElements.pop()!.remove();
	vi.restoreAllMocks();
	(globalThis as { __grundlage_ssr__?: boolean }).__grundlage_ssr__ = false;
});

const collectWarnings = (): Array<string> => {
	const warnings: Array<string> = [];
	vi.spyOn(console, "warn").mockImplementation((...parts) => {
		warnings.push(parts.map(String).join(" "));
	});
	return warnings;
};

type Habit = { id: string };
type HabitElement = BaseComponent & { habit: Habit; note: string | undefined };

const defineHabitCard = (): { tag: string; runs: Array<string> } => {
	const tag = uniqueTag();
	const runs: Array<string> = [];
	customElements.define(
		tag,
		component(
			function* ({ habit, note }) {
				runs.push(`${habit.id}:${note}`);
				yield html`<p>${habit.id}</p>`;
			},
			{
				props: {
					habit: prop.property<Habit>(),
					note: prop.optional(prop.property<string>()),
				},
			},
		),
	);
	return { tag, runs };
};

describe("a required prop", () => {
	test("a child its parent binds starts once, with the value", async () => {
		const { tag, runs } = defineHabitCard();
		const parentTag = uniqueTag();
		customElements.define(
			parentTag,
			component(function* () {
				yield html`<div>${html`<${tag} habit=${{ id: "a" }}></${tag}>`}</div>`;
			}),
		);
		mount(document.createElement(parentTag));
		await sleep();
		expect(runs).toEqual(["a:undefined"]);
	});

	test("an element appended before the assignment waits, then starts", async () => {
		const { tag, runs } = defineHabitCard();
		const element = mount(document.createElement(tag) as HabitElement);
		await sleep();
		expect(runs).toEqual([]);

		element.habit = { id: "b" };
		await sleep();
		expect(runs).toEqual(["b:undefined"]);
	});

	test("every write of the same task lands before the first run", async () => {
		const { tag, runs } = defineHabitCard();
		const element = mount(document.createElement(tag) as HabitElement);
		element.habit = { id: "c" };
		element.note = "second";
		await sleep();
		expect(runs).toEqual(["c:second"]);
	});

	test("update() does not start a body that still waits", async () => {
		const { tag, runs } = defineHabitCard();
		const element = mount(document.createElement(tag) as HabitElement);
		await element.update();
		await sleep();
		expect(runs).toEqual([]);
		expect(element.shadowRoot!.innerHTML).toBe("");
	});

	test("a later undefined is refused with a warning, and the value stays", async () => {
		const warnings = collectWarnings();
		const { tag, runs } = defineHabitCard();
		const element = mount(document.createElement(tag) as HabitElement);
		const habit = { id: "d" };
		element.habit = habit;
		await sleep();
		(element as { habit: unknown }).habit = undefined;
		await sleep();

		expect(element.habit).toBe(habit);
		expect(runs).toEqual(["d:undefined"]);
		expect(warnings).toEqual([
			expect.stringContaining(
				'prop "habit" is required and cannot become undefined',
			),
		]);
	});

	test("a required attribute set after connection starts the component", async () => {
		const tag = uniqueTag();
		const runs: Array<number> = [];
		customElements.define(
			tag,
			component(
				function* ({ count }) {
					runs.push(count);
					yield html`<p>${count}</p>`;
				},
				{ props: { count: prop.attribute(Number) } },
			),
		);
		const element = mount(document.createElement(tag));
		await sleep();
		expect(runs).toEqual([]);
		element.setAttribute("count", "3");
		await sleep();
		expect(runs).toEqual([3]);
	});

	test("warns a frame after connection while it is still missing", async () => {
		const warnings = collectWarnings();
		const { tag } = defineHabitCard();
		mount(document.createElement(tag));
		await nextFrame();
		expect(warnings).toEqual([
			expect.stringContaining('waits for its required prop "habit"'),
		]);
	});

	test("on the server, a missing one ends the component with the fix in the message", async () => {
		(globalThis as { __grundlage_ssr__?: boolean }).__grundlage_ssr__ = true;
		vi.spyOn(console, "error").mockImplementation(() => {});
		const { tag } = defineHabitCard();
		const element = document.createElement(tag);
		const errors: Array<unknown> = [];
		element.addEventListener(ComponentErrorEvent.eventName, (event) =>
			errors.push((event as ComponentErrorEvent).error),
		);
		mount(element);
		await sleep();
		expect(String(errors[0])).toMatch(
			/prop "habit" is required, and nothing supplied it before the server rendered.*Give it a fallback/,
		);
	});
});

describe("a property prop", () => {
	test("observes no attribute and never reflects", async () => {
		const { tag, runs } = defineHabitCard();
		const element = mount(document.createElement(tag) as HabitElement);
		element.habit = { id: "e" };
		element.setAttribute("habit", "ignored");
		await sleep();
		expect(element.habit).toEqual({ id: "e" });
		expect(element.getAttribute("habit")).toBe("ignored");
		expect(runs).toEqual(["e:undefined"]);
	});

	test("takes null as a value", async () => {
		const tag = uniqueTag();
		const seen: Array<unknown> = [];
		customElements.define(
			tag,
			component(
				function* () {
					yield function* view({ selected }) {
						seen.push(selected);
						yield html`<p></p>`;
					};
				},
				{ props: { selected: prop.property<Habit | null>({ id: "f" }) } },
			),
		);
		const element = mount(
			document.createElement(tag) as BaseComponent & {
				selected: Habit | null;
			},
		);
		await sleep();
		element.selected = null;
		await sleep();
		expect(seen).toEqual([{ id: "f" }, null]);
	});

	test("on the server, a binding to one marks the child to wait for its parent", async () => {
		(globalThis as { __grundlage_ssr__?: boolean }).__grundlage_ssr__ = true;
		const childTag = uniqueTag();
		customElements.define(
			childTag,
			component(
				function* ({ label }) {
					yield html`<p>${label}</p>`;
				},
				{ props: { label: prop.property<string>() } },
			),
		);
		const parentTag = uniqueTag();
		customElements.define(
			parentTag,
			component(function* () {
				yield html`<${childTag} label=${"text"}></${childTag}>`;
			}),
		);
		const parent = mount(document.createElement(parentTag));
		await sleep();
		const child = parent.shadowRoot!.querySelector(childTag)!;
		expect(child.hasAttribute(DEFER_HYDRATION_ATTRIBUTE)).toBe(true);
		expect(child.hasAttribute("label")).toBe(false);
	});
});

describe("a binding before definition", () => {
	test("arrives with its type, and the attribute it wrote for CSS goes for a property prop", async () => {
		const childTag = uniqueTag();
		const parentTag = uniqueTag();
		customElements.define(
			parentTag,
			component(function* () {
				yield html`<${childTag} data=${{ id: "g" }} label=${"hello"} level=${2} open=${true}></${childTag}>`;
			}),
		);
		const parent = mount(document.createElement(parentTag));
		await sleep();
		const child = parent.shadowRoot!.querySelector(childTag)!;
		expect(child.getAttribute("label")).toBe("hello");

		const seen: Array<unknown> = [];
		customElements.define(
			childTag,
			component(
				function* ({ data, label, level, open }) {
					seen.push({ data, label, level, open });
					yield html`<p></p>`;
				},
				{
					props: {
						data: prop.property<Habit>(),
						label: prop.property<string>(),
						level: prop.attribute(Number),
						open: prop.attribute(Boolean),
					},
				},
			),
		);
		await sleep();
		expect(seen).toEqual([
			{ data: { id: "g" }, label: "hello", level: 2, open: true },
		]);
		expect(child.hasAttribute("label")).toBe(false);
		expect(child.getAttribute("level")).toBe("2");
		expect(Object.keys(child)).toEqual([]);
	});

	test("an element that is never defined keeps the attribute for CSS", async () => {
		const parentTag = uniqueTag();
		customElements.define(
			parentTag,
			component(function* () {
				yield html`<styled-only-element size=${"large"}></styled-only-element>`;
			}),
		);
		const parent = mount(document.createElement(parentTag));
		await sleep();
		const child = parent.shadowRoot!.querySelector("styled-only-element")!;
		expect(child.getAttribute("size")).toBe("large");
	});
});

describe("a dropped binding", () => {
	test("is absence: a prop with a fallback goes back to it, a required one keeps its value", async () => {
		const warnings = collectWarnings();
		const childTag = uniqueTag();
		const seen: Array<unknown> = [];
		customElements.define(
			childTag,
			component(
				function* () {
					yield function* view({ selected, items }) {
						seen.push({ selected, items });
						yield html`<p></p>`;
					};
				},
				{
					props: {
						selected: prop.property<Habit | null>(),
						items: prop.property<Array<string>>(["fallback"]),
					},
				},
			),
		);
		let isBound = true;
		const parentTag = uniqueTag();
		customElements.define(
			parentTag,
			component(function* () {
				yield function* view() {
					yield html`<${childTag} ${isBound ? { selected: null, items: ["bound"] } : {}}></${childTag}>`;
				};
			}),
		);
		const parent = mount(document.createElement(parentTag) as BaseComponent);
		await sleep();
		isBound = false;
		await parent.update();
		await sleep();

		expect(seen).toEqual([
			{ selected: null, items: ["bound"] },
			{ selected: null, items: ["fallback"] },
		]);
		expect(warnings).toEqual([
			expect.stringContaining(
				'prop "selected" is required and cannot become undefined',
			),
		]);
	});
});

const habitSchema: StandardSchemaV1<unknown, Habit> = {
	"~standard": {
		version: 1,
		vendor: "test",
		validate: (value) =>
			typeof value === "object" &&
			value !== null &&
			typeof (value as Habit).id === "string"
				? { value: value as Habit }
				: { issues: [{ message: "a habit needs an id" }] },
	},
};

describe("a Standard Schema", () => {
	test("refuses an invalid value with the schema's own message, then takes a valid one", async () => {
		const warnings = collectWarnings();
		const tag = uniqueTag();
		const runs: Array<unknown> = [];
		customElements.define(
			tag,
			component(
				function* ({ habit }) {
					runs.push(habit);
					yield html`<p></p>`;
				},
				{ props: { habit: prop.property(habitSchema) } },
			),
		);
		const element = mount(
			document.createElement(tag) as BaseComponent & {
				habit: unknown;
			},
		);
		element.habit = { name: "no id" };
		await sleep();
		expect(runs).toEqual([]);
		expect(warnings).toContainEqual(
			expect.stringContaining("a habit needs an id"),
		);

		element.habit = { id: "h" };
		await sleep();
		expect(runs).toEqual([{ id: "h" }]);
	});

	test("a fallback it rejects throws at definition, with its message", () => {
		expect(() =>
			component(function* () {}, {
				//a JavaScript caller gets past the fallback's type
				props: {
					habit: prop.property(habitSchema, { nope: 1 } as unknown as Habit),
				},
			}),
		).toThrow(/not a value its schema accepts: a habit needs an id/);
	});

	test("an asynchronous one throws when it validates", () => {
		const asyncSchema: StandardSchemaV1<unknown, Habit> = {
			"~standard": {
				version: 1,
				vendor: "test",
				validate: async (value) => ({ value: value as Habit }),
			},
		};
		expect(() =>
			component(function* () {}, {
				props: { habit: prop.property(asyncSchema, { id: "i" }) },
			}),
		).toThrow(/validated asynchronously/);
	});
});

describe("prop.oneOf", () => {
	test("refuses a value outside its list and keeps the fallback", async () => {
		const warnings = collectWarnings();
		const tag = uniqueTag();
		const seen: Array<string> = [];
		customElements.define(
			tag,
			component(
				function* ({ variant }) {
					seen.push(variant);
					yield html`<p></p>`;
				},
				{
					props: {
						variant: prop.attribute(
							prop.oneOf("primary", "secondary"),
							"primary",
						),
					},
				},
			),
		);
		const host = mount(document.createElement("div"));
		host.innerHTML = `<${tag} variant="tertiary"></${tag}>`;
		await sleep();
		expect(seen).toEqual(["primary"]);
		expect(warnings).toEqual([
			expect.stringContaining('prop "variant" refused a string'),
		]);
	});
});

describe("prop.unreflected", () => {
	test("a property write leaves the attribute, and an attribute write moves the property", async () => {
		const tag = uniqueTag();
		customElements.define(
			tag,
			component(
				function* ({ value }) {
					yield function* view() {
						yield html`<p>${value}</p>`;
					};
				},
				{ props: { value: prop.unreflected(prop.attribute(Number, 0)) } },
			),
		);
		const host = mount(document.createElement("div"));
		host.innerHTML = `<${tag} value="3"></${tag}>`;
		const element = host.firstElementChild as BaseComponent & { value: number };
		await sleep();
		element.value = 4;
		expect(element.getAttribute("value")).toBe("3");
		element.setAttribute("value", "5");
		expect(element.value).toBe(5);
	});
});

describe("definition-time checks", () => {
	test.each<[string, () => unknown, RegExp]>([
		[
			"optional() of a prop with a fallback",
			//a JavaScript caller gets past the types
			() => prop.optional(prop.attribute(Number, 0) as never),
			/takes a prop without a fallback/,
		],
		[
			"unreflected() of a property prop",
			() => prop.unreflected(prop.property<string>() as never),
			/takes a prop.attribute/,
		],
		[
			"unreflected() of an optional prop",
			() => prop.unreflected(prop.optional(prop.attribute(Number)) as never),
			/goes inside prop.optional/,
		],
		[
			"a fallback of undefined",
			() =>
				component(function* () {}, {
					props: {
						label: prop.property<string | undefined>(undefined),
					} as Schema,
				}),
			/is undefined, which is no fallback/,
		],
	])("%s throws", (_, define, message) => {
		expect(define).toThrow(message);
	});
});
