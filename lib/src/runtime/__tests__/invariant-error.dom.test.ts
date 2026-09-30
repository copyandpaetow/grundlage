import { afterEach, describe, expect, test, vi } from "vitest";
import { component, html } from "../../index";
import {
	assertDuringDevelopment,
	InvariantError,
} from "../../utils/diagnostics";

//a library bug has to reach whoever develops the library: no user catch may hide it, and no cleanup
//may run on the state it broke. happy-dom throws a connectedCallback error out of appendChild, where
//a browser would report it

let counter = 0;
const uniqueTag = () => `test-invariant-${counter++}-${Date.now()}`;

afterEach(() => {
	vi.restoreAllMocks();
	document.body.replaceChildren();
});

describe("assertDuringDevelopment", () => {
	test("a held condition passes", () => {
		expect(() => assertDuringDevelopment(true, "held")).not.toThrow();
	});

	test("a broken condition throws an InvariantError naming the invariant", () => {
		expect(() => assertDuringDevelopment(false, "rows are placed")).toThrow(
			new InvariantError("grundlage: invariant broken: rows are placed"),
		);
	});
});

describe("an invariant error thrown inside a render", () => {
	const mountBrokenComponent = () => {
		let caughtByTheGenerator = false;
		const fatalErrorEvents = vi.fn();
		const tag = uniqueTag();
		customElements.define(
			tag,
			component(function* () {
				try {
					yield function* () {
						yield () => {
							throw new InvariantError("library bug");
						};
					};
				} catch {
					caughtByTheGenerator = true;
				}
				yield html`<p>recovered</p>`;
			}),
		);
		const element = document.createElement(tag);
		element.addEventListener("grundlage-error", fatalErrorEvents);
		const mountAttempt = () => document.body.appendChild(element);
		return {
			element,
			mountAttempt,
			fatalErrorEvents,
			wasCaughtByTheGenerator: () => caughtByTheGenerator,
		};
	};

	test("is not routed into the generator's try/catch", () => {
		const broken = mountBrokenComponent();
		expect(broken.mountAttempt).toThrow(InvariantError);
		expect(broken.wasCaughtByTheGenerator()).toBe(false);
	});

	test("does not take the fatal path", () => {
		const broken = mountBrokenComponent();
		expect(broken.mountAttempt).toThrow(InvariantError);
		expect(broken.fatalErrorEvents).not.toHaveBeenCalled();
		expect(broken.element.shadowRoot?.textContent).toBe("");
	});
});

describe("an invariant error thrown inside a prop claim", () => {
	test("escapes the assignment instead of ending the component", () => {
		const fatalErrorEvents = vi.fn();
		const tag = uniqueTag();
		customElements.define(
			tag,
			component(
				function* () {
					yield html`<p>x</p>`;
				},
				{
					props: {
						level: (incoming: unknown) => {
							if (incoming === "broken")
								throw new InvariantError("library bug");
							return incoming;
						},
					},
				},
			),
		);
		const element = document.createElement(tag) as HTMLElement & {
			level: unknown;
		};
		element.addEventListener("grundlage-error", fatalErrorEvents);
		document.body.appendChild(element);

		expect(() => {
			element.level = "broken";
		}).toThrow(InvariantError);
		expect(fatalErrorEvents).not.toHaveBeenCalled();
	});
});

describe("an invariant error thrown while recovering pre-upgrade assignments", () => {
	test("escapes the connect instead of ending the component", () => {
		const fatalErrorEvents = vi.fn();
		const tag = uniqueTag();
		const element = document.createElement(tag) as HTMLElement & {
			level: unknown;
		};
		element.level = "broken";
		element.addEventListener("grundlage-error", fatalErrorEvents);
		customElements.define(
			tag,
			component(
				function* () {
					yield html`<p>x</p>`;
				},
				{
					props: {
						level: (incoming: unknown) => {
							if (incoming === "broken")
								throw new InvariantError("library bug");
							return incoming;
						},
					},
				},
			),
		);

		expect(() => document.body.appendChild(element)).toThrow(InvariantError);
		expect(fatalErrorEvents).not.toHaveBeenCalled();
	});
});
