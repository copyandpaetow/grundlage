//must come first — parser/html.ts runs `document.createElement` at module load
import "./ssr-setup";

import { afterEach, describe, expect, test, vi } from "vitest";
import { html, component } from "../../src/index";
import * as grundlage from "../../src/index";
import {
	ComponentConstructor,
	ComponentOptions,
	Schema,
	PropEntry,
} from "../../src/types";

//What the server *emits* for a light-DOM render (light-dom/PLAN.md §1.1, §3.5, §4.6, §5.1).
//The claim that reads this output back is the browser half, in light-dom-ssr.browser.test.ts.
//Nested components never paint under happy-dom, so every case here is one host deep.

//neither export exists yet; typed as the schema entry each one will be, so these suites typecheck
//against the target API instead of around it
const { Slot, DefaultSlot } = grundlage as typeof grundlage & {
	Slot: PropEntry;
	DefaultSlot: PropEntry;
};

const light = <DeclaredSchema extends Schema>(
	props?: DeclaredSchema,
): ComponentOptions<DeclaredSchema> =>
	({ mode: "light", props }) as unknown as ComponentOptions<DeclaredSchema>;

//read off the class, never an instance: constructing one today throws inside
//`attachShadow({ mode: "light" })`
const lightModeShips =
	Object.getOwnPropertyDescriptor(
		component(function* () {}, light()).prototype,
		"renderRoot",
	) !== undefined;
const slotsShip =
	(Slot as unknown) !== undefined && (DefaultSlot as unknown) !== undefined;
const ships = lightModeShips && slotsShip;

const LIGHT_DOM_ATTRIBUTE = "light-dom";
const SLOT_SCOPE_ATTRIBUTE = "slot-scope";
const slotOpenMarker = (scope: string, key: string) =>
	`<!--^.^ slot-${scope}-${key}-->`;
const slotCloseMarker = (scope: string, key: string) =>
	`<!--^.^ /slot-${scope}-${key}-->`;

const flushMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0));

let nextTagId = 0;
const uniqueTag = () => `light-ssr-${nextTagId++}-${Date.now()}`;

const trackedElements: Array<HTMLElement> = [];
afterEach(() => {
	while (trackedElements.length) trackedElements.pop()!.remove();
});

//markup first, then the definition: adoption reads the children the page wrote, and upgrading a
//parsed element is the only way to get that order
const renderOnServer = async (
	ComponentClass: ComponentConstructor,
	children = "",
): Promise<HTMLElement> => {
	const tag = uniqueTag();
	const holder = document.createElement("div");
	holder.innerHTML = `<${tag}>${children}</${tag}>`;
	document.body.append(holder);
	trackedElements.push(holder);
	customElements.define(tag, ComponentClass);
	customElements.upgrade(holder);
	await flushMicrotasks();
	return holder.firstElementChild as HTMLElement;
};

const renderRootOf = (element: HTMLElement): ParentNode =>
	(element as HTMLElement & { renderRoot?: ParentNode }).renderRoot ??
	element.shadowRoot ??
	element;

const serializedRenderOf = (element: HTMLElement): string =>
	(renderRootOf(element) as Element).innerHTML;

const warningsFrom = async (run: () => Promise<unknown>) => {
	const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
	await run();
	const calls = consoleWarn.mock.calls.slice();
	consoleWarn.mockRestore();
	return calls;
};

describe("the server signal is on in this process", () => {
	test("`window` is undefined, so isServer() is true without the override flag", () => {
		expect(typeof window).toBe("undefined");
	});
});

describe("§1.1 — the light-dom stamp", () => {
	test.skipIf(!lightModeShips)(
		"a light host renders into its own child list and attaches no shadow root",
		async () => {
			const element = await renderOnServer(
				component(function* () {
					yield () => html`<article>Ada</article>`;
				}, light()),
			);

			expect(element.shadowRoot).toBeNull();
			expect(element.querySelector("article")?.textContent).toBe("Ada");
			expect(renderRootOf(element)).toBe(element);
		},
	);

	test.skipIf(!lightModeShips)(
		"the library stamps light-dom itself, so a client-only render carries it too",
		async () => {
			const element = await renderOnServer(
				component(function* () {
					yield () => html`<article>Ada</article>`;
				}, light()),
			);

			expect(element.hasAttribute(LIGHT_DOM_ATTRIBUTE)).toBe(true);
			expect(element.getAttribute(LIGHT_DOM_ATTRIBUTE)).toBe("");
		},
	);

	test.skipIf(!lightModeShips)("a shadow host is not stamped", async () => {
		const element = await renderOnServer(
			component(function* () {
				yield () => html`<article>Ada</article>`;
			}),
		);

		expect(element.hasAttribute(LIGHT_DOM_ATTRIBUTE)).toBe(false);
	});
});

describe("§3.5 — the marker pair the server writes at adoption", () => {
	test.skipIf(!ships)(
		"a host that adopted something stamps a scope and brackets each adopted range",
		async () => {
			const element = await renderOnServer(
				component(
					function* (props) {
						yield () => html`<article>${props.heading}</article>`;
					},
					light({ heading: Slot }),
				),
				`<h2 slot="heading">Ada Lovelace</h2>`,
			);

			const scope = element.getAttribute(SLOT_SCOPE_ATTRIBUTE);
			expect(scope).not.toBeNull();
			expect(serializedRenderOf(element)).toContain(
				`${slotOpenMarker(scope!, "heading")}<h2 slot="heading">Ada Lovelace</h2>${slotCloseMarker(scope!, "heading")}`,
			);
		},
	);

	test.skipIf(!ships)(
		"the suffix carries the prop key, which is not the slot name for the default slot",
		async () => {
			const element = await renderOnServer(
				component(
					function* (props) {
						yield () => html`<article>${props.body}</article>`;
					},
					light({ body: DefaultSlot }),
				),
				`<p>unnamed</p>`,
			);

			const scope = element.getAttribute(SLOT_SCOPE_ATTRIBUTE)!;
			expect(serializedRenderOf(element)).toContain(
				slotOpenMarker(scope, "body"),
			);
		},
	);

	test.skipIf(!ships)(
		"a declared slot the consumer left empty gets no pair at all",
		async () => {
			const element = await renderOnServer(
				component(
					function* (props) {
						yield () =>
							html`<article>${props.heading}${props.footer}</article>`;
					},
					light({ heading: Slot, footer: Slot }),
				),
				`<h2 slot="heading">Ada</h2>`,
			);

			const scope = element.getAttribute(SLOT_SCOPE_ATTRIBUTE)!;
			const serialized = serializedRenderOf(element);
			expect(serialized).toContain(slotOpenMarker(scope, "heading"));
			expect(serialized).not.toContain(slotOpenMarker(scope, "footer"));
		},
	);

	test.skipIf(!ships)(
		"a host that adopted nothing is left without the attribute, which is the claim's early return",
		async () => {
			const element = await renderOnServer(
				component(
					function* (props) {
						yield () => html`<article>${props.heading}</article>`;
					},
					light({ heading: Slot }),
				),
			);

			expect(element.hasAttribute(SLOT_SCOPE_ATTRIBUTE)).toBe(false);
		},
	);

	test.skipIf(!ships)("the pair is emitted in shadow mode too", async () => {
		const element = await renderOnServer(
			component(
				function* (props) {
					yield () => html`<article>${props.heading}</article>`;
				},
				{ props: { heading: Slot } } as ComponentOptions,
			),
			`<h2 slot="heading">Ada</h2>`,
		);

		const scope = element.getAttribute(SLOT_SCOPE_ATTRIBUTE);
		expect(scope).not.toBeNull();
		expect(element.shadowRoot!.innerHTML).toContain(
			slotOpenMarker(scope!, "heading"),
		);
	});

	test.skipIf(!ships)(
		"two hosts in one subtree never share a scope",
		async () => {
			const define = () =>
				component(
					function* (props) {
						yield () => html`<article>${props.heading}</article>`;
					},
					light({ heading: Slot }),
				);
			const first = await renderOnServer(define(), `<h2 slot="heading">a</h2>`);
			const second = await renderOnServer(
				define(),
				`<h2 slot="heading">b</h2>`,
			);

			expect(first.getAttribute(SLOT_SCOPE_ATTRIBUTE)).not.toBe(
				second.getAttribute(SLOT_SCOPE_ATTRIBUTE),
			);
		},
	);

	test.skipIf(!ships)(
		"a hyphenated key stays unambiguous against a multi-digit scope",
		async () => {
			//PROP_NAME_PATTERN forbids a key from starting with a digit, so the scope is the leading
			//digit run and the key is everything past the hyphen after it
			let element!: HTMLElement;
			for (let index = 0; index <= 10; index++)
				element = await renderOnServer(
					component(
						function* (props) {
							yield () => html`<article>${props["sub-title"]}</article>`;
						},
						light({ "sub-title": Slot }),
					),
					`<p slot="sub-title">deep</p>`,
				);

			const scope = element.getAttribute(SLOT_SCOPE_ATTRIBUTE)!;
			expect(scope.length).toBeGreaterThan(1);
			expect(serializedRenderOf(element)).toContain(
				slotOpenMarker(scope, "sub-title"),
			);
		},
	);
});

describe("§4.6 / R24 — the discard warning, on the side that knows", () => {
	const cardWithNoNoteSlot = () =>
		component(
			function* (props) {
				yield () => html`<article>${props.heading}</article>`;
			},
			light({ heading: Slot }),
		);

	test.skipIf(!ships)(
		"a light host names the count of children no entry claims",
		async () => {
			const calls = await warningsFrom(() =>
				renderOnServer(
					cardWithNoNoteSlot(),
					`<h2 slot="heading">Ada</h2><p slot="note">one</p><p slot="note">two</p>`,
				),
			);

			expect(calls.length).toBe(1);
			expect(String(calls[0][0])).toContain("2 of its children");
			expect(calls[0][1]).toHaveLength(2);
		},
	);

	test.skipIf(!ships)(
		"it fires while the discarded nodes are still in the document",
		async () => {
			let connectedAtWarnTime: boolean | null = null;
			const consoleWarn = vi
				.spyOn(console, "warn")
				.mockImplementation((_message, discarded) => {
					connectedAtWarnTime = (discarded as Array<ChildNode>).every(
						(node) => node.isConnected,
					);
				});
			await renderOnServer(
				cardWithNoNoteSlot(),
				`<h2 slot="heading">Ada</h2><p slot="note">lost</p>`,
			);
			consoleWarn.mockRestore();

			expect(connectedAtWarnTime).toBe(true);
		},
	);

	test.skipIf(!ships)(
		"whitespace between elements is not a discarded child",
		async () => {
			const calls = await warningsFrom(() =>
				renderOnServer(
					cardWithNoNoteSlot(),
					`\n\t<h2 slot="heading">Ada</h2>\n`,
				),
			);

			expect(calls).toHaveLength(0);
		},
	);

	test.skipIf(!ships)(
		"an SSR payload script is not a discarded child",
		async () => {
			const calls = await warningsFrom(() =>
				renderOnServer(
					cardWithNoNoteSlot(),
					`<script type="application/json" data-ssr>{"name":"Ada"}</script><h2 slot="heading">Ada</h2>`,
				),
			);

			expect(calls).toHaveLength(0);
		},
	);

	test.skipIf(!ships)(
		"shadow mode never warns: an unmatched child stays in the child list and nothing was destroyed",
		async () => {
			const calls = await warningsFrom(() =>
				renderOnServer(
					component(
						function* (props) {
							yield () => html`<article>${props.heading}</article>`;
						},
						{ props: { heading: Slot } } as ComponentOptions,
					),
					`<h2 slot="heading">Ada</h2><p slot="note">kept</p>`,
				),
			);

			expect(calls).toHaveLength(0);
		},
	);
});

describe("§5.1 / R27 — what a server fatal leaves behind", () => {
	test.skipIf(!lightModeShips)(
		"a fatal before the first paint flags the element and writes nothing into it",
		async () => {
			const consoleError = vi
				.spyOn(console, "error")
				.mockImplementation(() => {});
			const element = await renderOnServer(
				component(function* () {
					throw new Error("no data");
				}, light()),
			);
			const [message, thrown] = consoleError.mock.calls[0] ?? [];
			consoleError.mockRestore();

			expect(element.hasAttribute("component-error")).toBe(true);
			expect(element.getAttribute("component-error")).toBe("");
			expect(element.childNodes).toHaveLength(0);
			expect(String(message)).toContain("fatal render error in");
			//an object, so devtools keeps the stack expandable
			expect(thrown).toBeInstanceOf(Error);
		},
	);

	test.skipIf(!lightModeShips)(
		"a fatal after a good paint leaves that paint on screen, flagged",
		async () => {
			const consoleError = vi
				.spyOn(console, "error")
				.mockImplementation(() => {});
			const element = await renderOnServer(
				component(function* () {
					yield () => html`<article>painted</article>`;
					throw new Error("too late");
				}, light()),
			);
			consoleError.mockRestore();

			//the server stops at the first renderable yield, so this fatal is unreachable on the
			//server — the assertion is that the paint is what ships either way
			expect(element.querySelector("article")?.textContent).toBe("painted");
		},
	);

	test.skipIf(!lightModeShips)(
		"the flag never carries the message: it is serialized into shipped HTML",
		async () => {
			const consoleError = vi
				.spyOn(console, "error")
				.mockImplementation(() => {});
			const element = await renderOnServer(
				component(function* () {
					throw new Error("secret internal detail");
				}, light()),
			);
			consoleError.mockRestore();

			expect(element.outerHTML).not.toContain("secret internal detail");
		},
	);
});
