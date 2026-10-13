import { describe, expect, test, vi } from "vitest";
import { component, html } from "../index";
import { BaseComponent, ComponentOptions, Schema } from "../types";

//The light-DOM spec, written against the API light-dom/RULES.md describes. Nothing here is
//implemented yet, so every case is gated on a runtime detection rather than a skip flag: the
//suite lights itself up, one stage at a time, and needs no edit to do it.

//`mode: "light"` is not in ComponentOptions until §1 lands
const light = <DeclaredSchema extends Schema>(
	props?: DeclaredSchema,
): ComponentOptions<DeclaredSchema> =>
	({ mode: "light", props }) as unknown as ComponentOptions<DeclaredSchema>;

const isRealBrowser =
	typeof (window as { happyDOM?: unknown }).happyDOM === "undefined";

let tagId = 0;
const uniqueTag = () => `light-el-${tagId++}-${Date.now()}`;

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

const mount = (tag: string): BaseComponent => {
	const host = document.createElement(tag) as BaseComponent;
	document.body.append(host);
	return host;
};

const paintOf = (element: Element): string =>
	getComputedStyle(element).getPropertyValue("background-color");

const RED = "rgb(255, 0, 0)";
const UNPAINTED = "rgba(0, 0, 0, 0)";

const detect = (probe: () => boolean): boolean => {
	try {
		return probe();
	} catch {
		return false;
	}
};

//read off the class rather than an instance: constructing one today throws inside
//`attachShadow({ mode: "light" })`, and a custom-element constructor's throw is reported to the
//page whether or not the caller catches it — which would fail this file before a test ran
const lightModeShips = detect(
	() =>
		Object.getOwnPropertyDescriptor(
			component(function* () {}, light()).prototype,
			"renderRoot",
		) !== undefined,
);

const errorFlagShips = detect(() => {
	const silenced = [
		vi.spyOn(console, "error").mockImplementation(() => {}),
		vi.spyOn(console, "warn").mockImplementation(() => {}),
	];
	const host = mount(
		define(function* () {
			throw new Error("boom");
		}),
	);
	const flagged = host.hasAttribute("component-error");
	for (const spy of silenced) spy.mockRestore();
	host.remove();
	return flagged;
});

const ships = lightModeShips && isRealBrowser;

describe("R1—R3 — the render root", () => {
	test.skipIf(!lightModeShips)(
		"a light component renders into its own child list and attaches no shadow root",
		() => {
			const tag = define(function* () {
				yield () => html`<article>content</article>`;
			}, light());
			const host = mount(tag);

			expect(host.shadowRoot).toBeNull();
			expect(
				(host as BaseComponent & { renderRoot: ParentNode }).renderRoot,
			).toBe(host);
			expect(host.querySelector("article")?.textContent).toBe("content");
		},
	);

	test.skipIf(!lightModeShips)(
		"R2 — the same component renders the same tree in both modes",
		() => {
			const renderTree = function* () {
				yield () => html`<article><b>x</b></article>`;
			};
			const lightHost = mount(define(renderTree, light()));
			const shadowHost = mount(define(renderTree));

			expect(lightHost.innerHTML).toBe(
				(shadowHost.shadowRoot as ShadowRoot).innerHTML,
			);
		},
	);

	test.skipIf(!lightModeShips)(
		"R3 — `light-dom` is valueless, written by the library, and survives a re-render",
		async () => {
			let painted = 0;
			const tag = define(function* () {
				yield () => html`<p>${++painted}</p>`;
			}, light());
			const host = mount(tag);

			expect(host.getAttribute("light-dom")).toBe("");
			await host.update();
			expect(host.getAttribute("light-dom")).toBe("");
			expect(host.querySelector("p")?.textContent).toBe("2");
		},
	);

	test.skipIf(!lightModeShips)(
		"R3 — a shadow component is never stamped",
		() => {
			const host = mount(
				define(function* () {
					yield () => html`<p>x</p>`;
				}),
			);
			expect(host.hasAttribute("light-dom")).toBe(false);
		},
	);

	test.skipIf(!lightModeShips)(
		"an update patches the existing children rather than rebuilding them",
		async () => {
			let painted = 0;
			const host = mount(
				define(function* () {
					yield () => html`<p>${++painted}</p>`;
				}, light()),
			);
			const paragraph = host.querySelector("p");

			const observer = new MutationObserver(() => {});
			observer.observe(host, { childList: true, subtree: true });
			await host.update();
			const records = observer.takeRecords();
			observer.disconnect();

			expect(host.querySelector("p")).toBe(paragraph);
			expect(records.filter((record) => record.addedNodes.length > 0)).toEqual(
				[],
			);
		},
	);
});

describe("R4—R7 — styles", () => {
	test.skipIf(!ships)(
		"R4 — one authored `:host, :scope` rule paints the host in both modes",
		() => {
			const renderTree = function* () {
				yield () =>
					html`<style>
							:host,
							:scope {
								background: red;
							}
						</style>
						<b>x</b>`;
			};
			const lightHost = mount(define(renderTree, light()));
			const shadowHost = mount(define(renderTree));

			expect(paintOf(lightHost)).toBe(RED);
			expect(paintOf(shadowHost)).toBe(RED);
		},
	);

	test.skipIf(!ships)("R4 — the authored text is wrapped, never edited", () => {
		const host = mount(
			define(function* () {
				yield () =>
					html`<style>
						:host,
						:scope {
							background: red;
						}
					</style>`;
			}, light()),
		);
		const sheetText = host.querySelector("style")!.textContent!;

		expect(sheetText).toContain(":host, :scope");
		expect(sheetText).toContain("@scope");
	});

	test.skipIf(!ships)(
		"R4 — descendant rules stay off the rest of the page",
		() => {
			const outside = document.createElement("b");
			document.body.append(outside);
			mount(
				define(function* () {
					yield () =>
						html`<style>
								b {
									background: red;
								}
							</style>
							<b>x</b>`;
				}, light()),
			);
			expect(paintOf(outside)).toBe(UNPAINTED);
		},
	);

	//a literal child tag, because a template's strings array is the parse-cache key: a tag
	//interpolated per test would defeat it and a closing tag cannot hold a hole at all
	test.skipIf(!ships)(
		"R5 — a nested light child's host is styleable, its interior is not",
		async () => {
			customElements.define(
				"light-r5-child",
				component(function* () {
					yield () => html`<b>child</b>`;
				}, light()),
			);
			const parent = mount(
				define(function* () {
					yield () =>
						html`<style>
								light-r5-child {
									background: red;
								}
								b {
									background: red;
								}
							</style>
							<light-r5-child></light-r5-child>
							<b>own</b>`;
				}, light()),
			);
			await sleep();

			const child = parent.querySelector("light-r5-child")!;
			expect(paintOf(child)).toBe(RED);
			expect(paintOf(parent.querySelector(":scope > b")!)).toBe(RED);
			expect(paintOf(child.querySelector("b")!)).toBe(UNPAINTED);
		},
	);

	test.skipIf(!lightModeShips)(
		"R4 — a `:host` rule that cannot match warns once per component, not per instance",
		() => {
			const consoleWarn = vi
				.spyOn(console, "warn")
				.mockImplementation(() => {});
			const tag = define(function* () {
				yield () =>
					html`<style>
						:host {
							background: red;
						}
					</style>`;
			}, light());
			mount(tag);
			mount(tag);

			const hostWarnings = consoleWarn.mock.calls.filter((call) =>
				String(call[0]).includes(":host"),
			);
			consoleWarn.mockRestore();
			expect(hostWarnings.length).toBe(1);
		},
	);

	test.skipIf(!lightModeShips)(
		"R4 — the warning reads selectors, not the sheet text",
		() => {
			const consoleWarn = vi
				.spyOn(console, "warn")
				.mockImplementation(() => {});
			mount(
				define(function* () {
					yield () =>
						html`<style>
							b::before {
								content: ":host";
							}
						</style>`;
				}, light()),
			);
			const falsePositives = consoleWarn.mock.calls.filter((call) =>
				String(call[0]).includes(":host"),
			);
			consoleWarn.mockRestore();
			expect(falsePositives).toEqual([]);
		},
	);

	test.skipIf(!lightModeShips)(
		"R4 — an unrelated `:scope` rule does not mask a dead `:host` rule",
		() => {
			const consoleWarn = vi
				.spyOn(console, "warn")
				.mockImplementation(() => {});
			mount(
				define(function* () {
					yield () =>
						html`<style>
							:scope {
								display: block;
							}
							:host {
								background: red;
							}
						</style>`;
				}, light()),
			);
			const hostWarnings = consoleWarn.mock.calls.filter((call) =>
				String(call[0]).includes(":host"),
			);
			consoleWarn.mockRestore();
			expect(hostWarnings.length).toBe(1);
		},
	);

	test.skipIf(!lightModeShips)(
		"R4 — `::slotted()` warns, since adopted nodes are ordinary descendants",
		() => {
			const consoleWarn = vi
				.spyOn(console, "warn")
				.mockImplementation(() => {});
			mount(
				define(function* () {
					yield () =>
						html`<style>
							::slotted(b) {
								background: red;
							}
						</style>`;
				}, light()),
			);
			const slottedWarnings = consoleWarn.mock.calls.filter((call) =>
				String(call[0]).includes("::slotted"),
			);
			consoleWarn.mockRestore();
			expect(slottedWarnings.length).toBe(1);
		},
	);

	test.skipIf(!lightModeShips)(
		"R7 — a `<style>` below the top level warns in light mode and not in shadow mode",
		() => {
			const renderTree = function* () {
				yield () =>
					html`<article>
						<style>
							b {
								background: red;
							}
						</style>
					</article>`;
			};
			const consoleWarn = vi
				.spyOn(console, "warn")
				.mockImplementation(() => {});
			mount(define(renderTree, light()));
			const lightWarnings = consoleWarn.mock.calls.length;
			mount(define(renderTree));
			const bothWarnings = consoleWarn.mock.calls.length;
			consoleWarn.mockRestore();

			expect(lightWarnings).toBe(1);
			expect(bothWarnings).toBe(1);
		},
	);
});

describe("the three things that fail today", () => {
	test.skipIf(!ships)("page CSS reaches into a light render", () => {
		const pageSheet = document.createElement("style");
		pageSheet.textContent = ".from-the-page { background: red }";
		document.head.append(pageSheet);

		const host = mount(
			define(function* () {
				yield () => html`<b class="from-the-page">x</b>`;
			}, light()),
		);

		expect(paintOf(host.querySelector("b")!)).toBe(RED);
		pageSheet.remove();
	});

	test.skipIf(!ships)("`label[for]` associates across the host", () => {
		const holder = document.createElement("div");
		document.body.append(holder);
		const host = document.createElement(
			define(function* () {
				yield () => html`<input id="across-the-host" />`;
			}, light()),
		);
		holder.append(host);
		const label = document.createElement("label");
		label.htmlFor = "across-the-host";
		holder.append(label);

		expect(label.control).toBe(holder.querySelector("input"));
	});

	test.skipIf(!ships)("a `:target` id inside a light render responds", () => {
		const host = mount(
			define(function* () {
				yield () => html`<section id="target-probe">x</section>`;
			}, light()),
		);
		const pageSheet = document.createElement("style");
		pageSheet.textContent = ":target { background: red }";
		document.head.append(pageSheet);
		location.hash = "#target-probe";

		expect(paintOf(host.querySelector("section")!)).toBe(RED);
		location.hash = "";
		pageSheet.remove();
	});
});

describe("R25 — a render root is not a page surface", () => {
	test.skipIf(!lightModeShips)(
		"a destroyed range repaints on the next update and warns once",
		async () => {
			let painted = 0;
			const host = mount(
				define(function* () {
					yield () => html`<p>${++painted}</p>`;
				}, light()),
			);
			const consoleWarn = vi
				.spyOn(console, "warn")
				.mockImplementation(() => {});
			host.innerHTML = "";
			await host.update();
			await host.update();
			consoleWarn.mockRestore();

			expect(host.querySelector("p")?.textContent).toBe("3");
			expect(consoleWarn.mock.calls.length).toBe(1);
		},
	);

	test.skipIf(!lightModeShips)(
		"a removed `<style>` rebuilds the whole render root and warns once, and is not a fatal",
		async () => {
			let painted = 0;
			const host = mount(
				define(function* () {
					yield () =>
						html`<style>
								b {
									background: ${"red"};
								}
							</style>
							<b>${++painted}</b>`;
				}, light()),
			);
			const consoleWarn = vi
				.spyOn(console, "warn")
				.mockImplementation(() => {});
			host.querySelector("style")!.remove();
			await host.update();
			consoleWarn.mockRestore();

			expect(host.querySelector("style")).not.toBeNull();
			expect(host.querySelector("b")?.textContent).toBe("2");
			expect(host.hasAttribute("component-error")).toBe(false);
			expect(consoleWarn.mock.calls.length).toBe(1);
		},
	);
});

describe("R26 — a fatal reports the fact on the element", () => {
	test.skipIf(!errorFlagShips)(
		"the console holds the error object, the element holds a valueless flag",
		() => {
			const consoleError = vi
				.spyOn(console, "error")
				.mockImplementation(() => {});
			const thrown = new Error("boom");
			const host = mount(
				define(function* () {
					throw thrown;
				}),
			);

			expect(host.getAttribute("component-error")).toBe("");
			expect(consoleError.mock.calls[0]?.[1]).toBe(thrown);
			consoleError.mockRestore();
		},
	);

	test.skipIf(!errorFlagShips || !lightModeShips)(
		"the last good paint stays on screen, in both modes",
		async () => {
			const consoleError = vi
				.spyOn(console, "error")
				.mockImplementation(() => {});
			let shouldThrow = false;
			const host = mount(
				define(function* () {
					yield () => {
						if (shouldThrow) throw new Error("boom");
						return html`<p>good</p>`;
					};
				}, light()),
			);
			shouldThrow = true;
			await host.update();
			consoleError.mockRestore();

			expect(host.querySelector("p")?.textContent).toBe("good");
			expect(host.hasAttribute("component-error")).toBe(true);
		},
	);

	test.skipIf(!errorFlagShips)(
		"a disconnect and re-insert restarts the generator and clears the flag",
		async () => {
			const consoleError = vi
				.spyOn(console, "error")
				.mockImplementation(() => {});
			let shouldThrow = true;
			const host = mount(
				define(function* () {
					if (shouldThrow) throw new Error("boom");
					yield () => html`<p>recovered</p>`;
				}, light()),
			);
			expect(host.hasAttribute("component-error")).toBe(true);

			host.remove();
			await sleep();
			shouldThrow = false;
			document.body.append(host);
			consoleError.mockRestore();

			expect(host.hasAttribute("component-error")).toBe(false);
			expect(host.querySelector("p")?.textContent).toBe("recovered");
		},
	);
});
