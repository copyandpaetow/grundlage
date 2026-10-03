import { describe, expect, test, vi } from "vitest";
import { component, html } from "../index";
import * as grundlage from "../index";
import {
	BaseComponent,
	ComponentOptions,
	ComponentProps,
	Schema,
	PropEntry,
	Template,
} from "../types";

//The slot half of the light-DOM spec (light-dom/RULES.md R8—R22). Slots are a schema entry, so
//most of these rules hold in both modes; the mode only decides what happens to a child no entry
//claims. Gated on the exports existing, so the suite turns itself on when §3 lands.

//neither export exists yet; typed as the schema entry each one will be, so these suites typecheck
//against the target API instead of around it
const { Slot, DefaultSlot } = grundlage as typeof grundlage & {
	Slot: PropEntry;
	DefaultSlot: PropEntry;
};
const slotsShip =
	(Slot as unknown) !== undefined && (DefaultSlot as unknown) !== undefined;

const isRealBrowser =
	typeof (window as { happyDOM?: unknown }).happyDOM === "undefined";
const ships = slotsShip && isRealBrowser;

const light = <DeclaredSchema extends Schema>(
	props?: DeclaredSchema,
): ComponentOptions<DeclaredSchema> =>
	({ mode: "light", props }) as unknown as ComponentOptions<DeclaredSchema>;

let tagId = 0;
const uniqueTag = () => `slot-el-${tagId++}-${Date.now()}`;

const sleep = (duration = 0) =>
	new Promise((resolve) => setTimeout(resolve, duration));

const define = (
	generator: Parameters<typeof component>[0],
	options?: ComponentOptions,
): string => {
	const tag = uniqueTag();
	customElements.define(tag, component(generator, options));
	return tag;
};

//markup first, then the definition: adoption reads the children the page wrote, and upgrading a
//parsed element is the only way to get that order in a test
const withChildren = (tag: string, children: string): BaseComponent => {
	const holder = document.createElement("div");
	holder.innerHTML = `<${tag}>${children}</${tag}>`;
	document.body.append(holder);
	return holder.firstElementChild as BaseComponent;
};

const readSlot = (host: BaseComponent, propName: string): unknown =>
	(host as unknown as Record<string, unknown>)[propName];

const writeSlot = (
	host: BaseComponent,
	propName: string,
	value: unknown,
): void => {
	(host as unknown as Record<string, unknown>)[propName] = value;
};

const silenced = <T>(run: () => T): [T, Array<unknown>] => {
	const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
	const result = run();
	const calls = consoleWarn.mock.calls.map((call) => call[0]);
	consoleWarn.mockRestore();
	return [result, calls];
};

describe("R8—R9 — a slot is a prop", () => {
	test.skipIf(!slotsShip)(
		"a slot key is absent from observedAttributes and present in declaredPropNames",
		() => {
			const tag = define(
				function* (props) {
					yield () => html`<header>${props.heading}</header>`;
				},
				light({ heading: Slot }),
			);
			const definition = customElements.get(tag) as CustomElementConstructor & {
				observedAttributes: Array<string>;
				declaredPropNames: ReadonlySet<string>;
			};

			expect(definition.observedAttributes).not.toContain("heading");
			expect(definition.declaredPropNames.has("heading")).toBe(true);
		},
	);

	test.skipIf(!slotsShip)("one name cannot carry two entries", () => {
		expect(() =>
			define(
				function* () {
					yield () => html`<p>x</p>`;
				},
				light({ heading: Slot, hEading: String }),
			),
		).toThrow();
	});

	test.skipIf(!slotsShip)(
		"two default slots are refused at define time",
		() => {
			expect(() =>
				define(
					function* () {
						yield () => html`<p>x</p>`;
					},
					light({ body: DefaultSlot, rest: DefaultSlot }),
				),
			).toThrow();
		},
	);

	test.skipIf(!slotsShip)(
		"a closed root cannot be claimed, and says so",
		() => {
			const [, warnings] = silenced(() =>
				define(
					function* () {
						yield () => html`<p>x</p>`;
					},
					{ mode: "closed", props: { heading: Slot } } as ComponentOptions,
				),
			);
			expect(warnings.length).toBe(1);
		},
	);

	test.skipIf(!slotsShip)(
		"R9 — a slot name is matched verbatim, and a mismatch leaves the child in place",
		async () => {
			const tag = define(
				function* (props) {
					yield () => html`<header>${props.sideBar}</header>`;
				},
				light({ sideBar: Slot }),
			);
			const host = withChildren(
				tag,
				`<span slot="sideBar">matched</span><span slot="sidebar">not</span>`,
			);
			await sleep();

			expect(host.querySelector("header")?.textContent).toBe("matched");
			expect(readSlot(host, "sideBar")).toHaveLength(1);
		},
	);

	test.skipIf(!slotsShip)(
		"an attribute spelled like a slot is inert, and warns",
		async () => {
			const tag = define(
				function* (props) {
					yield () => html`<header>${props.heading}</header>`;
				},
				light({ heading: Slot }),
			);
			const [host, warnings] = silenced(() => {
				const holder = document.createElement("div");
				holder.innerHTML = `<${tag} heading="Ada"></${tag}>`;
				document.body.append(holder);
				return holder.firstElementChild as BaseComponent;
			});
			await sleep();

			expect(host.querySelector("header")?.textContent).toBe("");
			expect(warnings.length).toBe(1);
		},
	);
});

describe("R13—R15 — adoption", () => {
	test.skipIf(!slotsShip)(
		"R13 — declaring a slot drains the children before the body runs",
		async () => {
			let childCountDuringBody = -1;
			const tag = define(
				function* (props) {
					const host = yield () => html`<article>${props.body}</article>`;
					childCountDuringBody = (host as Element).children.length;
				},
				light({ body: DefaultSlot }),
			);
			const host = withChildren(tag, "<p>from the page</p>");
			await sleep();

			expect(childCountDuringBody).toBe(1);
			expect(host.querySelector("article > p")?.textContent).toBe(
				"from the page",
			);
		},
	);

	test.skipIf(!slotsShip)(
		"R15 — the node is the page's own, moved and not rewritten",
		async () => {
			const tag = define(
				function* (props) {
					yield () => html`<header>${props.heading}</header>`;
				},
				light({ heading: Slot }),
			);
			const holder = document.createElement("div");
			holder.innerHTML = `<${tag}><h2 slot="heading">Ada</h2></${tag}>`;
			document.body.append(holder);
			const authored = holder.querySelector("h2")!;
			await sleep();

			expect(holder.querySelector("header > h2")).toBe(authored);
			expect(authored.getAttribute("slot")).toBe("heading");
		},
	);

	test.skipIf(!slotsShip)(
		"R14 — light mode destroys an unmatched child and warns; shadow mode leaves it",
		async () => {
			const renderTree = function* (props: ComponentProps) {
				yield () => html`<header>${props.heading}</header>`;
			};
			const lightTag = define(renderTree, light({ heading: Slot }));
			const shadowTag = define(renderTree, { props: { heading: Slot } });

			const [lightHost, warnings] = silenced(() =>
				withChildren(lightTag, `<span slot="badges">1843</span>`),
			);
			const shadowHost = withChildren(
				shadowTag,
				`<span slot="badges">1843</span>`,
			);
			await sleep();

			expect(lightHost.querySelector("[slot='badges']")).toBeNull();
			expect(warnings.length).toBe(1);
			expect(shadowHost.querySelector("[slot='badges']")).not.toBeNull();
		},
	);

	test.skipIf(!slotsShip)(
		"whitespace between the tags is not content, so the fallback still shows",
		async () => {
			const tag = define(
				function* (props) {
					yield () => html`<footer>${props.footer}</footer>`;
				},
				light({ footer: [Slot, html`<i>—</i>`] as never }),
			);
			const host = withChildren(tag, "\n\t\n");
			await sleep();

			expect(host.querySelector("footer > i")?.textContent).toBe("—");
		},
	);
});

describe("R10—R12 — the value", () => {
	test.skipIf(!slotsShip)(
		"R10 — a bare node and a fragment both normalize to an array at assignment",
		async () => {
			const tag = define(
				function* (props) {
					yield () => html`<header>${props.heading}</header>`;
				},
				light({ heading: Slot }),
			);
			const host = withChildren(tag, "");
			await sleep();

			const single = document.createElement("b");
			writeSlot(host, "heading", single);
			await host.update();
			expect(readSlot(host, "heading")).toEqual([single]);

			const fragment = document.createDocumentFragment();
			fragment.append(document.createElement("i"), document.createElement("u"));
			writeSlot(host, "heading", fragment);
			await host.update();
			expect(readSlot(host, "heading")).toHaveLength(2);
		},
	);

	test.skipIf(!ships)(
		"R11 — a Template is copied into both holes, a live node is moved into the first",
		async () => {
			const tag = define(
				function* (props) {
					yield () =>
						html`<header>${props.heading}</header>
							<nav>${props.heading}</nav>`;
				},
				light({ heading: Slot }),
			);
			const host = withChildren(tag, "");
			await sleep();

			writeSlot(host, "heading", html`<h2>Ada</h2>` as Template);
			await host.update();
			expect(host.querySelectorAll("h2").length).toBe(2);

			const [, warnings] = silenced(() => {
				writeSlot(host, "heading", document.createElement("h3"));
			});
			await host.update();
			expect(host.querySelector("header > h3")).not.toBeNull();
			expect(host.querySelector("nav > h3")).toBeNull();
			expect(warnings.length).toBe(1);
		},
	);

	test.skipIf(!slotsShip)(
		"R12 — the stored array is frozen, so a push throws instead of landing a render late",
		async () => {
			const tag = define(
				function* (props) {
					yield () => html`<header>${props.heading}</header>`;
				},
				light({ heading: Slot }),
			);
			const host = withChildren(tag, `<h2 slot="heading">Ada</h2>`);
			await sleep();

			expect(() =>
				(readSlot(host, "heading") as Array<Node>).push(
					document.createElement("b"),
				),
			).toThrow(TypeError);
		},
	);

	test.skipIf(!slotsShip)(
		"R12 — re-committing the same value is zero DOM writes",
		async () => {
			const tag = define(
				function* (props) {
					yield () => html`<header>${props.heading}</header>`;
				},
				light({ heading: Slot }),
			);
			const host = withChildren(tag, `<h2 slot="heading">Ada</h2>`);
			await sleep();

			const observer = new MutationObserver(() => {});
			observer.observe(host, { childList: true, subtree: true });
			writeSlot(host, "heading", readSlot(host, "heading"));
			await host.update();
			const records = observer.takeRecords();
			observer.disconnect();

			expect(records).toEqual([]);
		},
	);
});

describe("R16—R20 — fallbacks and ownership", () => {
	test.skipIf(!slotsShip)(
		"R16 — absence writes the fallback; an empty array is a value that renders nothing",
		async () => {
			const tag = define(
				function* (props) {
					yield () => html`<footer>${props.footer}</footer>`;
				},
				light({ footer: [Slot, html`<i>—</i>`] as never }),
			);
			const host = withChildren(tag, "");
			await sleep();
			expect(host.querySelector("footer > i")?.textContent).toBe("—");

			writeSlot(host, "footer", []);
			await host.update();
			expect(host.querySelector("footer")?.textContent).toBe("");

			writeSlot(host, "footer", null);
			await host.update();
			expect(host.querySelector("footer > i")?.textContent).toBe("—");
		},
	);

	test.skipIf(!slotsShip)(
		"R16 — an array-of-nodes fallback is refused at define time",
		() => {
			expect(() =>
				define(
					function* () {
						yield () => html`<p>x</p>`;
					},
					light({ footer: [Slot, [document.createElement("i")]] as never }),
				),
			).toThrow();
		},
	);

	test.skipIf(!slotsShip)(
		"R17 — a declared fallback means the store is never absent",
		async () => {
			const withFallback = define(
				function* (props) {
					yield () =>
						html`<div>
							${props.footer && html`<aside>${props.footer}</aside>`}
						</div>`;
				},
				light({ footer: [Slot, html`<i>—</i>`] as never }),
			);
			const bare = define(
				function* (props) {
					yield () =>
						html`<div>
							${props.footer && html`<aside>${props.footer}</aside>`}
						</div>`;
				},
				light({ footer: Slot }),
			);

			const fallbackHost = withChildren(withFallback, "");
			const bareHost = withChildren(bare, "");
			await sleep();

			expect(fallbackHost.querySelector("aside")).not.toBeNull();
			expect(bareHost.querySelector("aside")).toBeNull();
		},
	);

	test.skipIf(!slotsShip)(
		"R18 — a property assignment beats authored markup, and warns",
		async () => {
			const tag = define(
				function* (props) {
					yield () => html`<header>${props.heading}</header>`;
				},
				light({ heading: Slot }),
			);
			const holder = document.createElement("div");
			holder.innerHTML = `<${tag}><h2 slot="heading">Ada</h2></${tag}>`;
			const host = holder.firstElementChild as BaseComponent;
			const [, warnings] = silenced(() => {
				writeSlot(host, "heading", html`<h2>Grace</h2>` as Template);
				document.body.append(holder);
			});
			await sleep();

			expect(host.querySelector("header")?.textContent).toBe("Grace");
			expect(warnings.length).toBe(1);
		},
	);

	test.skipIf(!ships)(
		"R19 — live nodes render in the first hole only, and the second warns rather than falling back",
		async () => {
			const tag = define(
				function* (props) {
					yield () =>
						html`<header>${props.heading}</header>
							<nav>${props.heading}</nav>`;
				},
				light({ heading: [Slot, html`<h2>Untitled</h2>`] as never }),
			);
			const host = withChildren(tag, "");
			const [, warnings] = silenced(() => {
				writeSlot(host, "heading", [document.createElement("h3")]);
			});
			await host.update();

			expect(host.querySelector("header > h3")).not.toBeNull();
			expect(host.querySelector("nav")?.children.length).toBe(0);
			expect(warnings.length).toBe(1);
		},
	);

	test.skipIf(!ships)(
		"R20 — a value passed down stays the outer component's across an update",
		async () => {
			customElements.define(
				"slot-r20-child",
				component(
					function* (props) {
						yield () => html`<b>${props.label}</b>`;
					},
					light({ label: [Slot, html`<i>inner</i>`] as never }),
				),
			);
			const parent = withChildren(
				define(
					function* (props) {
						yield () =>
							html`<slot-r20-child label=${props.heading}></slot-r20-child>`;
					},
					light({ heading: Slot }),
				),
				`<h2 slot="heading">Ada</h2>`,
			);
			await sleep();
			const authored = parent.querySelector("h2")!;
			expect(parent.querySelector("slot-r20-child b")?.firstElementChild).toBe(
				authored,
			);

			await parent.update();
			await sleep();
			expect(parent.querySelector("slot-r20-child b")?.firstElementChild).toBe(
				authored,
			);
		},
	);
});

describe("R21—R22 — <slot> and late children", () => {
	test.skipIf(!slotsShip)(
		"R21 — any <slot> in a light template is fatal, and names the declaration to write",
		async () => {
			const consoleError = vi
				.spyOn(console, "error")
				.mockImplementation(() => {});
			const host = withChildren(
				define(function* () {
					yield () => html`<slot name="heading"></slot>`;
				}, light()),
				"",
			);
			await sleep();
			const reported = String(consoleError.mock.calls[0]?.[1] ?? "");
			consoleError.mockRestore();

			expect(host.hasAttribute("component-error")).toBe(true);
			expect(reported).toContain("light mode");
		},
	);

	test.skipIf(!slotsShip)(
		"R21 — a <slot> colliding with a declared name is fatal in shadow mode too",
		async () => {
			const consoleError = vi
				.spyOn(console, "error")
				.mockImplementation(() => {});
			const host = withChildren(
				define(
					function* () {
						yield () => html`<slot name="heading"></slot>`;
					},
					{ props: { heading: Slot } } as ComponentOptions,
				),
				"",
			);
			await sleep();
			consoleError.mockRestore();

			expect(host.hasAttribute("component-error")).toBe(true);
		},
	);

	test.skipIf(!slotsShip)(
		"R21 — a <slot> for an undeclared name is the platform's, and renders",
		async () => {
			const host = withChildren(
				define(
					function* () {
						yield () => html`<slot name="badges"></slot>`;
					},
					{ props: { heading: Slot } } as ComponentOptions,
				),
				`<span slot="badges">1843</span>`,
			);
			await sleep();

			expect(host.hasAttribute("component-error")).toBe(false);
			expect(host.shadowRoot?.querySelector("slot")).not.toBeNull();
		},
	);

	test.skipIf(!slotsShip)(
		"R22 — a child appended after mount is routed by its slot attribute, a frame late, and warns",
		async () => {
			const tag = define(
				function* (props) {
					yield () => html`<header>${props.heading}</header>`;
				},
				light({ heading: Slot }),
			);
			const host = withChildren(tag, "");
			await sleep();

			const late = document.createElement("h2");
			late.setAttribute("slot", "heading");
			const [, warnings] = silenced(() => host.append(late));
			await sleep();

			expect(host.querySelector("header > h2")).toBe(late);
			expect(warnings.length).toBe(1);
		},
	);

	test.skipIf(!slotsShip)(
		"R22 — insertBefore against an adopted reference node is broken by adoption",
		async () => {
			const tag = define(
				function* (props) {
					yield () => html`<header>${props.heading}</header>`;
				},
				light({ heading: Slot }),
			);
			const holder = document.createElement("div");
			holder.innerHTML = `<${tag}><h2 slot="heading">Ada</h2></${tag}>`;
			document.body.append(holder);
			const host = holder.firstElementChild as BaseComponent;
			const adopted = holder.querySelector("h2")!;
			await sleep();

			expect(() =>
				host.insertBefore(document.createElement("b"), adopted),
			).toThrow();
		},
	);
});
