import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
	component,
	ComponentErrorEvent,
	html,
	load,
	type BaseComponent,
} from "../../src/index";

const sleep = (milliseconds = 0) =>
	new Promise((resolve) => setTimeout(resolve, milliseconds));

//the same browser plays server and browser: the flag is what isServer() reads
const serverFlagHolder = globalThis as { __grundlage_ssr__?: boolean };
const isServerSide = () => serverFlagHolder.__grundlage_ssr__ === true;
const side = () => (isServerSide() ? "server" : "browser");

interface FetchCounts {
	server: number;
	browser: number;
}

const createFetchCounts = (): FetchCounts => ({ server: 0, browser: 0 });

const countFetch = (counts: FetchCounts): void => {
	if (isServerSide()) counts.server++;
	else counts.browser++;
};

const fetchCounted = <Value>(counts: FetchCounts, value: Value) => {
	countFetch(counts);
	return Promise.resolve(value);
};

let tagCount = 0;
const uniqueTag = (role: string) => `test-load-${role}-${tagCount++}`;

//the payload scripts hold JSON text, which is not what the component painted, and the whitespace
//between parts comes from the formatter
const paintedTextOf = (element: Element): string => {
	let text = "";
	for (const child of element.shadowRoot?.childNodes ?? [])
		if (!(child instanceof HTMLScriptElement)) text += child.textContent;
	return text.replace(/\s+/g, " ").trim();
};

const errorsSeen: Array<string> = [];
const mountedElements: Array<HTMLElement> = [];

const recordError = (event: ComponentErrorEvent) => {
	const { error } = event;
	errorsSeen.push(
		`${side()}: ${error instanceof Error ? error.message : String(error)}`,
	);
	event.preventDefault();
};

beforeEach(() => {
	errorsSeen.length = 0;
	document.addEventListener(ComponentErrorEvent.eventName, recordError);
});

afterEach(() => {
	document.removeEventListener(ComponentErrorEvent.eventName, recordError);
	while (mountedElements.length > 0) mountedElements.pop()!.remove();
});

const mountInBrowser = (makeComponent: () => CustomElementConstructor) => {
	const tag = uniqueTag("browser-only");
	customElements.define(tag, makeComponent());
	const element = document.createElement(tag);
	document.body.append(element);
	mountedElements.push(element);
	return element as BaseComponent;
};

const loadWarningsOf = (warnSpy: { mock: { calls: Array<Array<unknown>> } }) =>
	warnSpy.mock.calls
		.map((call) => String(call[0]))
		.filter((warning) => warning.includes("load()"));

describe("load() where nothing was prerendered", () => {
	test("the fetcher runs in the browser and `yield*` returns its result", async () => {
		const fetches = createFetchCounts();
		const element = mountInBrowser(() =>
			component(function* () {
				const post = yield* load(() =>
					fetchCounted(fetches, { title: "a post" }),
				);
				yield html`<h1>${post.title}</h1>`;
			}),
		);
		await sleep();
		expect(paintedTextOf(element)).toBe("a post");
		expect(fetches).toEqual({ server: 0, browser: 1 });
	});

	test("outside a hydration, a payload-shaped script the component painted is left alone", async () => {
		const fetches = createFetchCounts();
		const element = mountInBrowser(() =>
			component(function* () {
				yield html`<script type="application/json" data-ssr>
					"its own"
				</script>`;
				const value = yield* load(() => fetchCounted(fetches, "fetched"));
				yield html`<script type="application/json" data-ssr>
						"its own"
					</script>
					<p>${value}</p>`;
			}),
		);
		await sleep();
		expect(paintedTextOf(element)).toBe("fetched");
		expect(
			element.shadowRoot!.querySelector("script")?.textContent?.trim(),
		).toBe('"its own"');
		expect(fetches).toEqual({ server: 0, browser: 1 });
	});

	test("a fetcher that throws surfaces at the `yield*`, where a try catches it", async () => {
		const element = mountInBrowser(() =>
			component(function* () {
				let title: string;
				try {
					title = yield* load((): string => {
						throw new Error("offline");
					});
				} catch (error) {
					title = `caught: ${(error as Error).message}`;
				}
				yield html`<h1>${title}</h1>`;
			}),
		);
		await sleep();
		expect(paintedTextOf(element)).toBe("caught: offline");
	});

	test("without the star, the driver sees a generator object, and the error names the star", async () => {
		mountInBrowser(() =>
			component(function* () {
				//the type layer refuses this too; the test pins the runtime message
				yield load(() => Promise.resolve(1)) as never;
				yield html`<p>after</p>`;
			}),
		);
		await sleep();
		expect(errorsSeen).toEqual([
			expect.stringContaining(
				"a component yielded a generator object. To run a helper generator, add the star: `yield* helper(…)`",
			),
		]);
	});

	test("a called update generator throws, naming both fixes", async () => {
		mountInBrowser(() =>
			component(function* () {
				function* view() {
					yield html`<p>view</p>`;
				}
				//the type layer refuses this too; the test pins the runtime message
				yield view() as never;
			}),
		);
		await sleep();
		expect(errorsSeen).toEqual([
			expect.stringContaining(
				"To run a helper generator, add the star: `yield* helper(…)`. To declare an update generator, yield the function without calling it: `yield view`",
			),
		]);
	});

	test("a template result is refused even where nothing is sent to the browser", async () => {
		mountInBrowser(() =>
			component(function* () {
				const view = yield* load(() => html`<p>a view</p>`);
				yield html`<p>${String(view)}</p>`;
			}),
		);
		await sleep();
		expect(errorsSeen).toEqual([
			expect.stringContaining(
				"its result is a template: yield the template itself to paint it",
			),
		]);
	});
});

describe.skipIf("happyDOM" in globalThis)(
	"load() across a prerendered round trip",
	() => {
		const waitForPaint = async (element: Element) => {
			const deadline = Date.now() + 300;
			while (Date.now() < deadline && paintedTextOf(element) === "")
				await sleep(5);
		};

		interface ServerRender {
			tag: string;
			serverHTML: string;
			serverText: string;
		}

		//the server stops at the first paint; getHTML serializes the shadow root the way the plugin does
		const renderOnServer = async (
			makeComponent: () => CustomElementConstructor,
		): Promise<ServerRender> => {
			const tag = uniqueTag("server");
			serverFlagHolder.__grundlage_ssr__ = true;
			try {
				customElements.define(tag, makeComponent());
				const element = document.createElement(tag);
				document.body.append(element);
				await waitForPaint(element);
				const serverText = paintedTextOf(element);
				const serialized = element.getHTML({ serializableShadowRoots: true });
				element.remove();
				await sleep();
				return {
					tag,
					serverHTML: `<${tag}>${serialized}</${tag}>`,
					serverText,
				};
			} finally {
				serverFlagHolder.__grundlage_ssr__ = false;
			}
		};

		//the browser tag is defined only after the server markup is parsed and connected, the order a
		//page loads in, so the element hydrates the declarative shadow root instead of painting fresh
		const hydrate = (
			server: ServerRender,
			makeComponent: () => CustomElementConstructor,
		): BaseComponent => {
			const tag = uniqueTag("browser");
			const wrapper = document.createElement("div");
			wrapper.setHTMLUnsafe(server.serverHTML.replaceAll(server.tag, tag));
			const element = wrapper.firstElementChild as HTMLElement;
			document.body.append(element);
			mountedElements.push(element);
			customElements.define(tag, makeComponent());
			return element as BaseComponent;
		};

		test("the server fetches, and the hydrating browser reuses its result without fetching", async () => {
			const fetches = createFetchCounts();
			let hasResumedInBrowser = false;
			const makeComponent = () =>
				component(function* () {
					const post = yield* load(() =>
						fetchCounted(fetches, { title: `post from ${side()}` }),
					);
					if (!isServerSide()) hasResumedInBrowser = true;
					yield html`<h1>${post.title}</h1>`;
				});
			const server = await renderOnServer(makeComponent);
			expect(server.serverHTML).toContain(
				`<script type="application/json" data-ssr="">{"title":"post from server"}</script>`,
			);

			const element = hydrate(server, makeComponent);
			//a reused result needs no promise, so hydration ends inside define()
			expect(hasResumedInBrowser).toBe(true);
			await sleep();
			expect(paintedTextOf(element)).toBe("post from server");
			expect(element.shadowRoot!.querySelector("script")).toBeNull();
			expect(fetches).toEqual({ server: 1, browser: 0 });
		});

		test("synchronous, dependent and parallel loads all reuse the server's results", async () => {
			const fetches = createFetchCounts();
			const makeComponent = () =>
				component(function* () {
					const featured = yield* load(
						() => `testimonial picked on the ${side()}`,
					);
					const post = yield* load(() =>
						fetchCounted(fetches, {
							title: `post from ${side()}`,
							authorId: 7,
						}),
					);
					const author = yield* load(() =>
						fetchCounted(fetches, {
							name: `author ${post.authorId} from ${side()}`,
						}),
					);
					const [tags, related] = yield* load(() =>
						Promise.all([
							fetchCounted(fetches, [`tag from ${side()}`]),
							fetchCounted(fetches, [`related from ${side()}`]),
						]),
					);
					yield html`<p>
						${featured} | ${post.title} | ${author.name} | ${tags[0]} |
						${related[0]}
					</p>`;
				});
			const element = hydrate(
				await renderOnServer(makeComponent),
				makeComponent,
			);
			await sleep();
			expect(paintedTextOf(element)).toBe(
				"testimonial picked on the server | post from server | author 7 from server | tag from server | related from server",
			);
			expect(fetches).toEqual({ server: 4, browser: 0 });
		});

		test("an update generator reuses the result on its hydrating run, and update() fetches", async () => {
			const fetches = createFetchCounts();
			const makeComponent = () =>
				component(function* () {
					yield function* view() {
						const post = yield* load(() =>
							fetchCounted(fetches, { title: `post from ${side()}` }),
						);
						yield html`<h1>${post.title}</h1>`;
					};
				});
			const element = hydrate(
				await renderOnServer(makeComponent),
				makeComponent,
			);
			await sleep();
			expect(paintedTextOf(element)).toBe("post from server");

			await element.update();
			await sleep();
			expect(paintedTextOf(element)).toBe("post from browser");
			expect(fetches).toEqual({ server: 1, browser: 1 });
		});

		test.each([
			{
				serverTakesBranch: true,
				browserTakesBranch: true,
				first: "first from server",
			},
			{
				serverTakesBranch: true,
				browserTakesBranch: false,
				first: "not loaded",
			},
			{
				serverTakesBranch: false,
				browserTakesBranch: true,
				first: "first from browser",
			},
			{
				serverTakesBranch: false,
				browserTakesBranch: false,
				first: "not loaded",
			},
		])(
			"a keyed load in a branch keeps the next load aligned: server $serverTakesBranch, browser $browserTakesBranch",
			async ({ serverTakesBranch, browserTakesBranch, first }) => {
				const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
				const makeComponent = () =>
					component(function* () {
						const takesBranch = isServerSide()
							? serverTakesBranch
							: browserTakesBranch;
						let firstValue = "not loaded";
						if (takesBranch)
							firstValue = yield* load("first", () =>
								Promise.resolve(`first from ${side()}`),
							);
						const second = yield* load(() =>
							Promise.resolve(`second from ${side()}`),
						);
						yield html`<p>${firstValue} | ${second}</p>`;
					});
				const element = hydrate(
					await renderOnServer(makeComponent),
					makeComponent,
				);
				await sleep();
				const loadWarnings = loadWarningsOf(warnSpy);
				warnSpy.mockRestore();

				expect(paintedTextOf(element)).toBe(`${first} | second from server`);
				expect(loadWarnings).toEqual([]);
			},
		);

		test.each([
			{
				serverTakesBranch: true,
				browserTakesBranch: false,
				warning: "1 load() result(s) from the server went unused",
			},
			{
				serverTakesBranch: false,
				browserTakesBranch: true,
				warning: "the browser reached a load() the server did not reach",
			},
		])(
			"an unkeyed load in a branch only one side takes warns: server $serverTakesBranch, browser $browserTakesBranch",
			async ({ serverTakesBranch, browserTakesBranch, warning }) => {
				const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
				const makeComponent = () =>
					component(function* () {
						const takesBranch = isServerSide()
							? serverTakesBranch
							: browserTakesBranch;
						let first = "not loaded";
						if (takesBranch)
							first = yield* load(() => Promise.resolve("first"));
						const second = yield* load(() => Promise.resolve("second"));
						yield html`<p>${first} | ${second}</p>`;
					});
				hydrate(await renderOnServer(makeComponent), makeComponent);
				await sleep();
				const loadWarnings = loadWarningsOf(warnSpy);
				warnSpy.mockRestore();

				expect(loadWarnings).toEqual([expect.stringContaining(warning)]);
			},
		);

		test("a load the server failed is retried in the browser, and the next load still reuses its result", async () => {
			const fetches = createFetchCounts();
			const makeComponent = () =>
				component(function* () {
					let first: string;
					try {
						first = yield* load(() => {
							countFetch(fetches);
							return isServerSide()
								? Promise.reject(new Error("the CMS is down"))
								: Promise.resolve("first from browser");
						});
					} catch (error) {
						first = `caught: ${(error as Error).message}`;
					}
					const second = yield* load(() =>
						Promise.resolve(`second from ${side()}`),
					);
					yield html`<p>${first} | ${second}</p>`;
				});
			const server = await renderOnServer(makeComponent);
			expect(server.serverText).toBe(
				"caught: the CMS is down | second from server",
			);
			expect(server.serverHTML).toContain(
				`<script type="application/json" data-ssr="" data-failed=""></script>`,
			);

			const element = hydrate(server, makeComponent);
			await sleep();
			expect(paintedTextOf(element)).toBe(
				"first from browser | second from server",
			);
			expect(fetches).toEqual({ server: 1, browser: 1 });
		});

		test("a result JSON cannot carry is refused on the server and in the browser", async () => {
			const makeComponent = () =>
				component(function* () {
					const post = yield* load(() =>
						Promise.resolve({ publishedAt: new Date(0) }),
					);
					yield html`<p>${String(post.publishedAt)}</p>`;
				});
			const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
			hydrate(await renderOnServer(makeComponent), makeComponent);
			await sleep();
			warnSpy.mockRestore();

			const refusal =
				"grundlage: load() takes a fetcher that returns plain data, because a prerendered page sends that data to the browser as JSON, but its result.publishedAt is a Date: return the string and turn it into a Date after the load";
			expect(errorsSeen).toEqual([`server: ${refusal}`, `browser: ${refusal}`]);
		});

		test("a keyed result the hydrating run skipped is released, so a later update fetches fresh", async () => {
			const fetches = createFetchCounts();
			let browserTakesDraftBranch = false;
			const makeComponent = () =>
				component(function* () {
					yield function* view() {
						let draft = "no draft";
						if (isServerSide() || browserTakesDraftBranch)
							draft = yield* load("draft", () =>
								fetchCounted(fetches, `draft from ${side()}`),
							);
						yield html`<p>${draft}</p>`;
					};
				});
			const element = hydrate(
				await renderOnServer(makeComponent),
				makeComponent,
			);
			await sleep();
			expect(paintedTextOf(element)).toBe("no draft");
			expect(element.shadowRoot!.querySelector("script")).toBeNull();

			browserTakesDraftBranch = true;
			await element.update();
			await sleep();
			expect(paintedTextOf(element)).toBe("draft from browser");
			expect(fetches).toEqual({ server: 1, browser: 1 });
		});

		test("a load after the first paint never runs on the server, and the browser fetches it", async () => {
			const fetches = createFetchCounts();
			const makeComponent = () =>
				component(function* () {
					yield html`<p>placeholder</p>`;
					const comments = yield* load(() =>
						fetchCounted(fetches, [`comment from ${side()}`]),
					);
					yield html`<p>${comments[0]}</p>`;
				});
			const server = await renderOnServer(makeComponent);
			expect(server.serverText).toBe("placeholder");
			expect(server.serverHTML).not.toContain("data-ssr");

			const element = hydrate(server, makeComponent);
			await sleep();
			expect(paintedTextOf(element)).toBe("comment from browser");
			expect(fetches).toEqual({ server: 0, browser: 1 });
		});

		test("two loads with one key in one host throw on the server, naming the fix", async () => {
			await renderOnServer(() =>
				component(function* () {
					const first = yield* load("post", () => 1);
					const second = yield* load("post", () => 2);
					yield html`<p>${first} ${second}</p>`;
				}),
			);
			expect(errorsSeen).toEqual([
				expect.stringMatching(
					/^server: grundlage: two load\(\) calls in <test-load-server-\d+> use the key "post"\. Give each its own key/,
				),
			]);
		});

		test("a mixin delegated twice keeps both results when its key includes its argument", async () => {
			function* commentsOf(postId: number) {
				return yield* load(`comments-${postId}`, () =>
					Promise.resolve([`comment on ${postId} from ${side()}`]),
				);
			}
			const makeComponent = () =>
				component(function* () {
					const first = yield* commentsOf(1);
					const second = yield* commentsOf(2);
					yield html`<p>${first[0]} | ${second[0]}</p>`;
				});
			const element = hydrate(
				await renderOnServer(makeComponent),
				makeComponent,
			);
			await sleep();
			expect(paintedTextOf(element)).toBe(
				"comment on 1 from server | comment on 2 from server",
			);
			expect(errorsSeen).toEqual([]);
		});
	},
);
