import { describe, expect, test, vi } from "vitest";
import { html, component } from "../../src/index";
import * as grundlage from "../../src/index";
import {
	ComponentConstructor,
	ComponentOptions,
	Schema,
	Parse,
} from "../../src/types";

//The claim that reads the server's slot markers back (light-dom/PLAN.md §3.5, §4.5, §4.6, R20—R27).
//Everything here is a real round trip: render with the server flag on, serialize, re-parse into an
//element nothing has upgraded yet, then define — the order a real page loads in. Chromium only,
//because a nested component never paints under happy-dom.

//neither export exists yet; typed as the schema entry each one will be, so these suites typecheck
//against the target API instead of around it
const { Slot, DefaultSlot } = grundlage as typeof grundlage & {
	Slot: Parse;
	DefaultSlot: Parse;
};

const light = <DeclaredSchema extends Schema>(
	props?: DeclaredSchema,
): ComponentOptions<DeclaredSchema> =>
	({ mode: "light", props }) as unknown as ComponentOptions<DeclaredSchema>;

//read off the class, never an instance: constructing one today throws inside
//`attachShadow({ mode: "light" })`, and a constructor's throw is reported to the page whether or
//not the caller catches it — which would fail this file before a test ran
const lightModeShips =
	Object.getOwnPropertyDescriptor(
		component(function* () {}, light()).prototype,
		"renderRoot",
	) !== undefined;
const slotsShip =
	(Slot as unknown) !== undefined && (DefaultSlot as unknown) !== undefined;
const ships = lightModeShips && slotsShip;

const SLOT_SCOPE_ATTRIBUTE = "slot-scope";
const ERROR_ATTRIBUTE = "component-error";

describe.skipIf("happyDOM" in globalThis)("light-DOM hydration", () => {
	const sleep = (duration = 0) =>
		new Promise((resolve) => setTimeout(resolve, duration));

	let tagId = 0;
	const uniqueTag = () => `light-hydrate-${tagId++}-${Date.now()}`;

	const trackedElements: Array<HTMLElement> = [];
	const track = <T extends HTMLElement>(element: T): T => {
		trackedElements.push(element);
		return element;
	};
	const cleanup = () => {
		while (trackedElements.length) trackedElements.pop()!.remove();
	};

	const serializeHost = (element: HTMLElement): string => {
		const attributes = Array.from(element.attributes)
			.map((attribute) => ` ${attribute.name}="${attribute.value}"`)
			.join("");
		const inner = element.shadowRoot
			? element.getHTML({ serializableShadowRoots: true })
			: element.innerHTML;
		return `<${element.localName}${attributes}>${inner}</${element.localName}>`;
	};

	//markup first, then the definition, so adoption sees the children the page wrote
	const serverRender = async (
		tag: string,
		ComponentClass: ComponentConstructor,
		children = "",
	): Promise<string> => {
		(globalThis as { __grundlage_ssr__?: boolean }).__grundlage_ssr__ = true;
		try {
			const holder = document.createElement("div");
			holder.innerHTML = `<${tag}>${children}</${tag}>`;
			document.body.append(holder);
			customElements.define(tag, ComponentClass);
			await sleep();
			const serialized = serializeHost(holder.firstElementChild as HTMLElement);
			holder.remove();
			//let the async disconnectedCallback drain before the next define
			await sleep();
			return serialized;
		} finally {
			(globalThis as { __grundlage_ssr__?: boolean }).__grundlage_ssr__ = false;
		}
	};

	//the tags must still be undefined here, so the tree is parsed and connected before anything
	//upgrades it
	const parseUnupgraded = (serializedHTML: string): HTMLElement => {
		const wrapper = document.createElement("div");
		wrapper.setHTMLUnsafe(serializedHTML);
		const element = wrapper.firstElementChild as HTMLElement;
		document.body.append(element);
		return track(element);
	};

	const renamed = (
		markup: string,
		replacements: ReadonlyArray<readonly [string, string]>,
	): string =>
		replacements.reduce(
			(current, [from, to]) => current.replaceAll(from, to),
			markup,
		);

	const scopeIn = (markup: string): string =>
		markup.match(new RegExp(`${SLOT_SCOPE_ATTRIBUTE}="(\\d+)"`))![1];

	const readProp = (host: HTMLElement, propName: string): unknown =>
		(host as unknown as Record<string, unknown>)[propName];

	const silenced = async <Result>(
		run: () => Promise<Result>,
	): Promise<[Result, Array<string>]> => {
		const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const result = await run();
		const messages = consoleWarn.mock.calls.map((call) => String(call[0]));
		consoleWarn.mockRestore();
		return [result, messages];
	};

	const card = () =>
		component(
			function* (props) {
				yield () => html`<article><header>${props.heading}</header></article>`;
			},
			light({ heading: Slot }),
		);

	const cardWithFallback = () =>
		component(
			function* (props) {
				yield () => html`<article><header>${props.heading}</header></article>`;
			},
			light({ heading: [Slot, html`<h2>Untitled</h2>`] }),
		);

	describe("the claim is a read", () => {
		test.skipIf(!ships)(
			"a claimed range resolves into the store and the nodes never move",
			async () => {
				const serverTag = uniqueTag();
				const clientTag = uniqueTag();
				const serialized = await serverRender(
					serverTag,
					card(),
					`<h2 slot="heading">Ada Lovelace</h2>`,
				);
				const element = parseUnupgraded(
					renamed(serialized, [[serverTag, clientTag]]),
				);
				const serverHeading = element.querySelector("h2")!;

				//childList/characterData only: §1.1 stamps `light-dom` in `#mount` unconditionally, so
				//an attribute record is expected and says nothing about the tree
				const records: Array<MutationRecord> = [];
				const observer = new MutationObserver((entries) =>
					records.push(...entries),
				);
				observer.observe(element, {
					childList: true,
					subtree: true,
					characterData: true,
				});
				customElements.define(clientTag, card());
				await sleep();
				observer.disconnect();

				expect(records).toHaveLength(0);
				expect(readProp(element, "heading")).toEqual([serverHeading]);
				expect(element.querySelector("h2")).toBe(serverHeading);
				cleanup();
			},
		);

		test.skipIf(!ships)(
			"the default slot round-trips under its own prop key",
			async () => {
				const makeComponent = () =>
					component(
						function* (props) {
							yield () => html`<article>${props.body}</article>`;
						},
						light({ body: DefaultSlot }),
					);
				const serverTag = uniqueTag();
				const clientTag = uniqueTag();
				const serialized = await serverRender(
					serverTag,
					makeComponent(),
					`<p>unnamed</p>`,
				);
				const element = parseUnupgraded(
					renamed(serialized, [[serverTag, clientTag]]),
				);
				const serverParagraph = element.querySelector("p")!;

				customElements.define(clientTag, makeComponent());
				await sleep();

				expect(readProp(element, "body")).toEqual([serverParagraph]);
				cleanup();
			},
		);

		test.skipIf(!ships)(
			"no slot-scope attribute means no walk, even with markers still in the markup",
			async () => {
				const serverTag = uniqueTag();
				const clientTag = uniqueTag();
				const serialized = await serverRender(
					serverTag,
					cardWithFallback(),
					`<h2 slot="heading">Ada</h2>`,
				);
				const scope = scopeIn(serialized);
				const element = parseUnupgraded(
					renamed(serialized, [
						[serverTag, clientTag],
						[` slot-scope="${scope}"`, ""],
					]),
				);

				const [, messages] = await silenced(async () => {
					customElements.define(clientTag, cardWithFallback());
					await sleep();
				});

				expect(readProp(element, "heading")).toBeUndefined();
				expect(messages).toHaveLength(0);
				cleanup();
			},
		);

		test.skipIf(!ships)(
			"a declared slot with no pair is silent absence, and the fallback renders",
			async () => {
				const serverTag = uniqueTag();
				const clientTag = uniqueTag();
				const serialized = await serverRender(serverTag, cardWithFallback());
				const element = parseUnupgraded(
					renamed(serialized, [[serverTag, clientTag]]),
				);

				const [, messages] = await silenced(async () => {
					customElements.define(clientTag, cardWithFallback());
					await sleep();
				});

				expect(element.querySelector("h2")?.textContent).toBe("Untitled");
				expect(messages).toHaveLength(0);
				cleanup();
			},
		);

		test.skipIf(!ships)(
			"a pair under this scope whose key is not declared warns, naming both",
			async () => {
				const serverTag = uniqueTag();
				const clientTag = uniqueTag();
				const serialized = await serverRender(
					serverTag,
					cardWithFallback(),
					`<h2 slot="heading">Ada</h2>`,
				);
				const scope = scopeIn(serialized);
				const element = parseUnupgraded(
					renamed(serialized, [
						[serverTag, clientTag],
						[`slot-${scope}-heading`, `slot-${scope}-caption`],
					]),
				);

				const [, messages] = await silenced(async () => {
					customElements.define(clientTag, cardWithFallback());
					await sleep();
				});

				expect(messages).toHaveLength(1);
				expect(messages[0]).toContain("caption");
				expect(messages[0]).toContain(clientTag);
				expect(element).toBeTruthy();
				cleanup();
			},
		);

		test.skipIf(!ships)(
			"an author's own slot marker under a scope this host never minted is skipped",
			async () => {
				const serverTag = uniqueTag();
				const clientTag = uniqueTag();
				const serialized = await serverRender(
					serverTag,
					card(),
					`<h2 slot="heading">Ada</h2>`,
				);
				const foreignScope = `${Number(scopeIn(serialized)) + 1000}`;
				const element = parseUnupgraded(
					renamed(serialized, [
						[serverTag, clientTag],
						[
							"</article>",
							`<!--^.^ slot-${foreignScope}-heading--><b>author</b><!--^.^ /slot-${foreignScope}-heading--></article>`,
						],
					]),
				);
				const serverHeading = element.querySelector("h2")!;

				const [, messages] = await silenced(async () => {
					customElements.define(clientTag, card());
					await sleep();
				});

				expect(messages).toHaveLength(0);
				expect(readProp(element, "heading")).toEqual([serverHeading]);
				cleanup();
			},
		);

		test.skipIf(!ships)(
			"an unclosed pair rejects the whole server range and names the component that repaints",
			async () => {
				const serverTag = uniqueTag();
				const clientTag = uniqueTag();
				const serialized = await serverRender(
					serverTag,
					card(),
					`<h2 slot="heading">Ada</h2>`,
				);
				const scope = scopeIn(serialized);
				const element = parseUnupgraded(
					renamed(serialized, [
						[serverTag, clientTag],
						["<article>", `<article data-from-the-server="">`],
						[`<!--^.^ /slot-${scope}-heading-->`, ""],
					]),
				);

				const [, messages] = await silenced(async () => {
					customElements.define(clientTag, card());
					await sleep();
				});

				expect(messages.some((message) => message.includes(clientTag))).toBe(
					true,
				);
				expect(element.querySelector("[data-from-the-server]")).toBeNull();
				cleanup();
			},
		);

		test.skipIf(!ships)(
			"a hyphenated key reads back against a multi-digit scope",
			async () => {
				const makeComponent = () =>
					component(
						function* (props) {
							yield () => html`<article>${props["sub-title"]}</article>`;
						},
						light({ "sub-title": Slot }),
					);
				const serverTag = uniqueTag();
				const clientTag = uniqueTag();
				const serialized = await serverRender(
					serverTag,
					makeComponent(),
					`<p slot="sub-title">deep</p>`,
				);
				const scope = scopeIn(serialized);
				const element = parseUnupgraded(
					renamed(serialized, [
						[serverTag, clientTag],
						[`slot-scope="${scope}"`, `slot-scope="1234"`],
						[`slot-${scope}-sub-title`, `slot-1234-sub-title`],
					]),
				);
				const serverParagraph = element.querySelector("p")!;

				const [, messages] = await silenced(async () => {
					customElements.define(clientTag, makeComponent());
					await sleep();
				});

				expect(messages).toHaveLength(0);
				expect(readProp(element, "sub-title")).toEqual([serverParagraph]);
				cleanup();
			},
		);

		test.skipIf(!ships)(
			"a pre-upgrade assignment beats the claim and commits over the server's nodes",
			async () => {
				const serverTag = uniqueTag();
				const clientTag = uniqueTag();
				const serialized = await serverRender(
					serverTag,
					card(),
					`<h2 slot="heading">Ada</h2>`,
				);
				const element = parseUnupgraded(
					renamed(serialized, [[serverTag, clientTag]]),
				);
				const replacement = document.createElement("h2");
				replacement.textContent = "Grace";
				(element as unknown as Record<string, unknown>).heading = [replacement];

				await silenced(async () => {
					customElements.define(clientTag, card());
					await sleep();
				});

				expect(element.querySelector("header h2")).toBe(replacement);
				cleanup();
			},
		);

		test.skipIf(!ships)(
			"a shadow component claims out of its declarative shadow root",
			async () => {
				const makeComponent = () =>
					component(
						function* (props) {
							yield () => html`<article>${props.heading}</article>`;
						},
						{ props: { heading: Slot } } as ComponentOptions,
					);
				const serverTag = uniqueTag();
				const clientTag = uniqueTag();
				const serialized = await serverRender(
					serverTag,
					makeComponent(),
					`<h2 slot="heading">Ada</h2>`,
				);
				expect(serialized).toContain("<template shadowrootmode=");

				const element = parseUnupgraded(
					renamed(serialized, [[serverTag, clientTag]]),
				);
				const serverHeading = element.shadowRoot!.querySelector("h2")!;
				customElements.define(clientTag, makeComponent());
				await sleep();

				expect(readProp(element, "heading")).toEqual([serverHeading]);
				cleanup();
			},
		);
	});

	describe("across the boundary — a parent's content inside a child's render", () => {
		//literal child tags throughout: a template's strings array is the parse-cache key, and a
		//closing tag cannot hold a hole at all. One definition serves both the server render and the
		//hydration, which is also what a real page has

		test.skipIf(!ships)(
			"the parent's binding inside the claimed nodes is live, and the child's claim found the pair",
			async () => {
				let name = "Ada";
				//the outer's template writes the node and the inner adopts it, so the outer's binding
				//ends up inside the inner's claimed range — the arrangement §3.5's ordering rests on
				customElements.define(
					"light-ordering-inner",
					component(
						function* (props) {
							yield () => html`<section><b>badge</b>${props.heading}</section>`;
						},
						light({ heading: [Slot, html`<h2>Untitled</h2>`] }),
					),
				);
				const serialized = await serverRender(
					"light-ordering-outer",
					component(function* () {
						yield () =>
							html`<article>
								<light-ordering-inner>
									<h2 slot="heading">${name}</h2>
								</light-ordering-inner>
							</article>`;
					}, light()),
				);

				const outer = parseUnupgraded(serialized);
				await sleep();

				const inner = outer.querySelector("light-ordering-inner")!;
				const heading = inner.querySelector("h2")!;
				expect(readProp(inner as HTMLElement, "heading")).toEqual([heading]);
				expect(heading.textContent).toBe("Ada");

				name = "Grace";
				await (outer as HTMLElement & { update(): Promise<void> }).update();
				await sleep();

				expect(inner.querySelector("h2")).toBe(heading);
				expect(heading.textContent).toBe("Grace");
				cleanup();
			},
		);

		test.skipIf(!ships)(
			"R23 — the child re-rendering leaves the parent's nodes alone",
			async () => {
				customElements.define(
					"light-ownership-inner",
					component(
						function* (props) {
							yield () => html`<section><b>badge</b>${props.heading}</section>`;
						},
						light({ heading: [Slot, html`<h2>Untitled</h2>`] }),
					),
				);
				const serialized = await serverRender(
					"light-ownership-outer",
					component(function* () {
						yield () =>
							html`<article>
								<light-ownership-inner>
									<h2 slot="heading">Ada</h2>
								</light-ownership-inner>
							</article>`;
					}, light()),
				);

				const outer = parseUnupgraded(serialized);
				await sleep();

				const inner = outer.querySelector(
					"light-ownership-inner",
				) as HTMLElement;
				const heading = inner.querySelector("h2")!;
				await (inner as HTMLElement & { update(): Promise<void> }).update();
				await sleep();

				expect(inner.querySelector("h2")).toBe(heading);
				expect(inner.querySelector("b")?.textContent).toBe("badge");
				cleanup();
			},
		);

		test.skipIf(!ships)(
			"R20 — a forwarded slot value keeps its owner, so a later parent update re-passes it",
			async () => {
				customElements.define(
					"light-forward-inner",
					component(
						function* (props) {
							yield () => html`<section>${props.heading}</section>`;
						},
						light({ heading: [Slot, html`<h2>Inner fallback</h2>`] }),
					),
				);
				const serialized = await serverRender(
					"light-forward-outer",
					component(
						function* (props) {
							yield () =>
								html`<article>
									<light-forward-inner
										heading=${props.heading}
									></light-forward-inner>
								</article>`;
						},
						light({ heading: Slot }),
					),
					`<h2 slot="heading">Ada</h2>`,
				);

				const outer = parseUnupgraded(serialized);
				await sleep();

				const heading = outer.querySelector("h2")!;
				expect(heading.textContent).toBe("Ada");
				expect(readProp(outer, "heading")).toEqual([heading]);

				//the failure this pins is silent until the second render: an outer that lost the nodes
				//lets the inner's own fallback paint over them
				await (outer as HTMLElement & { update(): Promise<void> }).update();
				await sleep();

				expect(outer.querySelector("h2")).toBe(heading);
				expect(outer.textContent).not.toContain("Inner fallback");
				cleanup();
			},
		);

		test.skipIf(!ships)(
			"R24 — a child that declares no slot for what it was passed costs the parent its server render",
			async () => {
				customElements.define(
					"light-discard-inner",
					component(function* () {
						yield () => html`<section><b>badge</b></section>`;
					}, light()),
				);
				const Outer = component(function* () {
					yield () =>
						html`<article data-from-the-server="">
							<light-discard-inner>
								<p slot="note">1843</p>
							</light-discard-inner>
						</article>`;
				}, light());

				const [serialized, serverMessages] = await silenced(() =>
					serverRender("light-discard-outer", Outer),
				);
				//the child names what it destroyed, on the server, where nobody sees the repaint
				expect(
					serverMessages.some((message) =>
						message.includes("declares no slot matching"),
					),
				).toBe(true);

				const [outer, clientMessages] = await silenced(async () => {
					const element = parseUnupgraded(serialized);
					await sleep();
					return element;
				});

				//the parent points at itself: the cause is in the other console
				expect(
					clientMessages.some(
						(message) =>
							message.includes("light-discard-outer") &&
							message.includes("repainting"),
					),
				).toBe(true);
				expect(outer.querySelector("[data-from-the-server]")).toBeNull();
				cleanup();
			},
		);
	});

	describe("R27 — what a server fatal ships, read from the client side", () => {
		test.skipIf(!lightModeShips)(
			"markup carrying component-error repaints rather than hydrating, and the flag is cleared",
			async () => {
				const makeComponent = () =>
					component(function* () {
						yield () => html`<article>painted</article>`;
					}, light());
				const serverTag = uniqueTag();
				const clientTag = uniqueTag();
				const serialized = await serverRender(serverTag, makeComponent());
				const element = parseUnupgraded(
					renamed(serialized, [
						[serverTag, clientTag],
						["<article>", `<article data-from-the-server="">`],
						[`<${clientTag} `, `<${clientTag} ${ERROR_ATTRIBUTE} `],
					]),
				);

				const [, messages] = await silenced(async () => {
					customElements.define(clientTag, makeComponent());
					await sleep();
				});

				//a fatal server run does not vouch for its own output, so it is not hydrated against
				expect(element.querySelector("[data-from-the-server]")).toBeNull();
				expect(element.querySelector("article")?.textContent).toBe("painted");
				expect(element.hasAttribute(ERROR_ATTRIBUTE)).toBe(false);
				expect(messages).toHaveLength(0);
				cleanup();
			},
		);

		test.skipIf(!lightModeShips)(
			"a light host ships real children and no declarative shadow root",
			async () => {
				const serverTag = uniqueTag();
				const serialized = await serverRender(
					serverTag,
					component(function* () {
						yield () => html`<article>Ada</article>`;
					}, light()),
				);

				expect(serialized).not.toContain("<template shadowrootmode=");
				expect(serialized).toContain("<article>Ada</article>");
				expect(serialized).toContain("light-dom");
			},
		);
	});
});
