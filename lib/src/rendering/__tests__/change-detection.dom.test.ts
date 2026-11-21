import { expect, test } from "vitest";
import { component, html, prop } from "../../index";

type UpdatableElement = HTMLElement & { update(): Promise<void> };

let tagCount = 0;
const mountComponent = (body: Parameters<typeof component>[0]) => {
	const tag = `change-detection-${tagCount++}`;
	customElements.define(tag, component(body));
	const element = document.createElement(tag) as UpdatableElement;
	document.body.append(element);
	return element;
};

//4181·M = 2584·2^32 + 423877 for the old multiplier, so a weighted sum read the move from (4182, 0)
//to (1, 423877) as unchanged
test("a list row whose values trade 4181 for 423877 is repainted", async () => {
	let rows: Array<[number, number]> = [[4182, 0]];
	const element = mountComponent(function* () {
		yield function* view() {
			yield html`<ul>
				${rows.map(([first, second]) => html`<li>${first}: ${second}</li>`)}
			</ul>`;
		};
	});
	await element.update();
	rows = [[1, 423877]];
	await element.update();
	expect(element.shadowRoot!.querySelector("li")!.textContent).toBe("1: 423877");
	element.remove();
});

test("an attribute of two holes whose values trade 4181 for 423877 is rewritten", async () => {
	let position: [number, number] = [4182, 0];
	const element = mountComponent(function* () {
		yield function* view() {
			yield html`<p data-position="${position[0]},${position[1]}">p</p>`;
		};
	});
	await element.update();
	position = [1, 423877];
	await element.update();
	expect(element.shadowRoot!.querySelector("p")!.getAttribute("data-position")).toBe("1,423877");
	element.remove();
});

//walked again at every back-reference, three posts took about 3^21 steps on every paint
test("a hole holding posts that point back at their user paints, and repaints a changed title", async () => {
	const user = {
		name: "ada",
		posts: [] as Array<{ title: string; author: unknown }>,
	};
	for (const title of ["first", "second", "third"]) user.posts.push({ title, author: user });
	const element = mountComponent(function* () {
		yield function* view() {
			yield html`<ul data-user=${user}>
				${user.posts.map((post) => html`<li>${post.title}</li>`)}
			</ul>`;
		};
	});
	const titles = () =>
		[...element.shadowRoot!.querySelectorAll("li")].map((item) => item.textContent);
	await element.update();
	expect(titles()).toEqual(["first", "second", "third"]);
	user.posts[1].title = "changed";
	await element.update();
	expect(titles()).toEqual(["first", "changed", "third"]);
	element.remove();
});

test("a hole holding a Symbol.for symbol paints and keeps painting", async () => {
	const status = { kind: Symbol.for("order") };
	const element = mountComponent(function* () {
		yield function* view() {
			yield html`<p data-status=${status}>status</p>`;
		};
	});
	await element.update();
	status.kind = Symbol.for("invoice");
	await element.update();
	expect(element.shadowRoot!.textContent).toBe("status");
	element.remove();
});

//a prop.property takes null as a value and undefined as absence, so its binding's gate tells them apart
test("a prop.property binding that moves from undefined to null hands the child null", async () => {
	const childTag = `change-detection-${tagCount++}`;
	customElements.define(
		childTag,
		component(
			function* () {
				yield function* view({ label }) {
					yield html`<p>${String(label)}</p>`;
				};
			},
			{ props: { label: prop.property<string | null>("fallback") } },
		),
	);
	let label: string | null | undefined = undefined;
	const parent = mountComponent(function* () {
		yield function* view() {
			yield html`<${childTag} label=${label}></${childTag}>`;
		};
	});
	const childText = () => parent.shadowRoot!.querySelector(childTag)!.shadowRoot!.textContent;
	await parent.update();
	expect(childText()).toBe("fallback");
	label = null;
	await parent.update();
	expect(childText()).toBe("null");
	parent.remove();
});

test("a prop.property binding that moves from null to undefined hands the child its fallback", async () => {
	const childTag = `change-detection-${tagCount++}`;
	customElements.define(
		childTag,
		component(
			function* () {
				yield function* view({ label }) {
					yield html`<p>${String(label)}</p>`;
				};
			},
			{ props: { label: prop.property<string | null>("fallback") } },
		),
	);
	let label: string | null | undefined = null;
	const parent = mountComponent(function* () {
		yield function* view() {
			yield html`<${childTag} label=${label}></${childTag}>`;
		};
	});
	const childText = () => parent.shadowRoot!.querySelector(childTag)!.shadowRoot!.textContent;
	await parent.update();
	expect(childText()).toBe("null");
	label = undefined;
	await parent.update();
	expect(childText()).toBe("fallback");
	parent.remove();
});

test("data with its own constructor key, changed in place, reaches the child", async () => {
	const childTag = `change-detection-${tagCount++}`;
	customElements.define(
		childTag,
		component(
			function* () {
				yield function* view({ data }) {
					yield html`<p>${JSON.stringify(data)}</p>`;
				};
			},
			{ props: { data: prop.property<unknown>() } },
		),
	);
	const car = JSON.parse('{"constructor":"ferrari","points":1}') as { points: number };
	const parent = mountComponent(function* () {
		yield function* view() {
			yield html`<${childTag} data=${car}></${childTag}>`;
		};
	});
	const childText = () => parent.shadowRoot!.querySelector(childTag)!.shadowRoot!.textContent;
	await parent.update();
	expect(childText()).toBe('{"constructor":"ferrari","points":1}');
	car.points = 2;
	await parent.update();
	expect(childText()).toBe('{"constructor":"ferrari","points":2}');
	parent.remove();
});

test("an Object.groupBy result, changed in place, reaches the child", async () => {
	const childTag = `change-detection-${tagCount++}`;
	customElements.define(
		childTag,
		component(
			function* () {
				yield function* view({ data }) {
					yield html`<p>${JSON.stringify(data)}</p>`;
				};
			},
			{ props: { data: prop.property<unknown>() } },
		),
	);
	const groups = Object.groupBy([{ team: "red", points: 1 }], (row) => row.team);
	const parent = mountComponent(function* () {
		yield function* view() {
			yield html`<${childTag} data=${groups}></${childTag}>`;
		};
	});
	const childText = () => parent.shadowRoot!.querySelector(childTag)!.shadowRoot!.textContent;
	await parent.update();
	expect(childText()).toBe('{"red":[{"team":"red","points":1}]}');
	groups.red!.push({ team: "red", points: 2 });
	await parent.update();
	expect(childText()).toBe('{"red":[{"team":"red","points":1},{"team":"red","points":2}]}');
	parent.remove();
});
