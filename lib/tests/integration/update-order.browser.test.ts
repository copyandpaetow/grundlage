import { afterEach, describe, expect, test, vi } from "vitest";
import {
	awaited,
	component,
	html,
	load,
	type BaseComponent,
	type Template,
	prop,
} from "../../src/index";

//How updates line up across components, however they start: a parent updates before its children
//and each updates once, a frame never shows a value a queued update is about to replace, nothing
//waits on async work it does not own, and the order modules load in changes none of it. Chromium
//only, because a nested component never paints under happy-dom.

describe.skipIf("happyDOM" in globalThis)(
	"update order across components",
	() => {
		const sleep = (duration = 0) =>
			new Promise((resolve) => setTimeout(resolve, duration));
		const nextFrame = () =>
			new Promise((resolve) => requestAnimationFrame(resolve));
		const settlesWithin = (promise: Promise<unknown>, duration: number) =>
			Promise.race([
				promise.then(() => true),
				sleep(duration).then(() => false),
			]);
		//formatting breaks long templates across lines, which puts whitespace into the painted text
		const visibleText = (node: Node | null) =>
			node?.textContent?.replace(/\s+/g, " ").trim();

		let tagId = 0;
		const uniqueTag = (role: string) =>
			`update-order-${role}-${tagId++}-${Date.now()}`;

		const trackedElements: Array<HTMLElement> = [];
		const track = <TrackedElement extends HTMLElement>(
			element: TrackedElement,
		): TrackedElement => {
			trackedElements.push(element);
			return element;
		};
		const mount = <MountedElement extends HTMLElement>(
			tag: string,
		): MountedElement => {
			const element = document.createElement(tag) as MountedElement;
			document.body.append(element);
			return track(element);
		};
		afterEach(() => {
			while (trackedElements.length) trackedElements.pop()!.remove();
		});

		const createStore = <State extends object>(state: State) => {
			const listeners = new Set<() => void>();
			return {
				state,
				subscribe: (listener: () => void) => {
					listeners.add(listener);
					return () => {
						listeners.delete(listener);
					};
				},
				publish: (changes: Partial<State>) => {
					Object.assign(state, changes);
					for (const listener of [...listeners]) listener();
				},
			};
		};

		const countMutationsFrom = (root: Node) => {
			let mutationCount = 0;
			const observer = new MutationObserver((records) => {
				mutationCount += records.length;
			});
			observer.observe(root, {
				subtree: true,
				childList: true,
				attributes: true,
				characterData: true,
			});
			return () => {
				mutationCount += observer.takeRecords().length;
				observer.disconnect();
				return mutationCount;
			};
		};

		describe("a parent updates before its children, and each updates once", () => {
			//no await anywhere: a mount that finished a tick later would let a parent and a child that
			//were dirtied in one task update in the order they were dirtied rather than top down
			test("a three-deep mount finishes inside the append that started it", () => {
				const leafTag = uniqueTag("leaf");
				const middleTag = uniqueTag("middle");
				const rootTag = uniqueTag("root");
				const runs: Array<string> = [];

				customElements.define(
					leafTag,
					component(function* () {
						runs.push("leaf");
						yield function* () {
							yield html`<b>a leaf</b>`;
						};
					}),
				);
				customElements.define(
					middleTag,
					component(function* () {
						runs.push("middle");
						yield function* () {
							yield html`<${leafTag}></${leafTag}>`;
						};
					}),
				);
				customElements.define(
					rootTag,
					component(function* () {
						runs.push("root");
						yield function* () {
							yield html`<${middleTag}></${middleTag}>`;
						};
					}),
				);

				const root = mount<BaseComponent>(rootTag);
				const leaf = root.shadowRoot
					?.querySelector(middleTag)
					?.shadowRoot?.querySelector(leafTag);

				expect(runs).toEqual(["root", "middle", "leaf"]);
				expect(visibleText(leaf?.shadowRoot ?? null)).toBe("a leaf");
			});

			test("a store update that reaches a child first updates the child once, after its parent", async () => {
				const cardTag = uniqueTag("card");
				const pageTag = uniqueTag("page");
				const store = createStore({ ids: ["a", "b"] });
				const cardSetups: Array<string> = [];

				customElements.define(
					cardTag,
					component(
						function* (componentProps) {
							const unsubscribe = store.subscribe(() =>
								componentProps.host.update(),
							);
							yield function* () {
								cardSetups.push(
									`selected=${componentProps.selected} ids=${store.state.ids.join("")}`,
								);
								yield html`<ul>
									${store.state.ids.map((id) => html`<li>${id}</li>`)}
								</ul>`;
							};
							return unsubscribe;
						},
						{ props: { selected: prop.optional(prop.attribute(String)) } },
					),
				);
				//subscribes after its first paint, so the store notifies the card before the page
				customElements.define(
					pageTag,
					component(function* ({ host }) {
						yield function* () {
							yield html`<${cardTag} selected=${store.state.ids.at(-1)}></${cardTag}>`;
						};
						return store.subscribe(() => host.update());
					}),
				);

				mount(pageTag);
				await sleep();
				expect(cardSetups).toEqual(["selected=b ids=ab"]);

				store.publish({ ids: ["a", "b", "c"] });
				await sleep();
				expect(cardSetups).toEqual(["selected=b ids=ab", "selected=c ids=abc"]);
			});

			test("a host binding that writes its host's own prop updates the host once more and settles, on mount and on update", async () => {
				const tag = uniqueTag("user-panel");
				const fetchedUserIds: Array<string | undefined> = [];
				const fetchUser = async (userId: string | undefined) => {
					fetchedUserIds.push(userId);
					await sleep(5);
					return { name: `user ${userId}` };
				};
				let runCount = 0;
				const UserPanel = component(
					function* (componentProps) {
						let loadCount = 0;
						let loadedUserId: string | undefined | null = null;
						let loadedUserName = "";
						yield function* () {
							runCount++;
							const userId = componentProps.userId;
							if (userId !== loadedUserId) {
								const user = yield* awaited(fetchUser(userId));
								loadedUserName = user.name;
								loadedUserId = userId;
								loadCount++;
							}
							yield html`<template loadCount=${loadCount}
								><p>${loadedUserName}</p></template
							>`;
						};
					},
					{
						props: {
							userId: prop.optional(prop.attribute(String)),
							loadCount: prop.attribute(Number, 0),
						},
					},
				);
				customElements.define(tag, UserPanel);

				const userPanel = track(
					document.createElement(tag) as InstanceType<typeof UserPanel>,
				);
				userPanel.userId = "7";
				document.body.append(userPanel);
				await sleep(50);
				expect(fetchedUserIds).toEqual(["7"]);
				expect(userPanel.loadCount).toBe(1);
				expect(runCount).toBe(2);

				userPanel.userId = "8";
				await sleep(50);
				expect(fetchedUserIds).toEqual(["7", "8"]);
				expect(userPanel.loadCount).toBe(2);
				expect(runCount).toBe(4);
				expect(visibleText(userPanel.shadowRoot)).toBe("user 8");
			});
		});

		describe("updates converge before the frame, or fail visibly", () => {
			test("an update generator that assigns its own prop a new value every time ends in a visible error", async () => {
				const tag = uniqueTag("runaway-label");
				//without an update limit this loop runs through microtasks and freezes the browser the tests run in
				const runCountAtWhichTheTestEndsTheLoop = 1_000;
				let runCount = 0;
				customElements.define(
					tag,
					component(
						function* (componentProps) {
							yield function* () {
								runCount++;
								const hasTheTestEndedTheLoop =
									runCount >= runCountAtWhichTheTestEndsTheLoop;
								if (!hasTheTestEndedTheLoop)
									componentProps.host.label = `${componentProps.label}!`;
								yield html`<p>${componentProps.label}</p>`;
							};
						},
						{ props: { label: prop.attribute(String, "") } },
					),
				);

				const consoleError = vi
					.spyOn(console, "error")
					.mockImplementation(() => {});
				const element = mount(tag);
				await sleep(50);
				consoleError.mockRestore();

				expect(element.shadowRoot!.querySelector("p")).toBeNull();
				expect(element.shadowRoot!.textContent).toContain("grundlage");
			});

			test("an update generator that starts assigning its own prop a new value on update ends in a visible error too", async () => {
				const tag = uniqueTag("runaway-width");
				//without an update limit this loop runs through microtasks and freezes the browser the tests run in
				const runCountAtWhichTheTestEndsTheLoop = 1_000;
				let runCount = 0;
				const SizedBox = component(
					function* (componentProps) {
						yield function* () {
							runCount++;
							const width = componentProps.width;
							const hasTheTestEndedTheLoop =
								runCount >= runCountAtWhichTheTestEndsTheLoop;
							const shouldAssignAnotherWidth =
								width !== "" && !hasTheTestEndedTheLoop;
							if (shouldAssignAnotherWidth)
								componentProps.host.width = `${width}px`;
							yield html`<p>${width}</p>`;
						};
					},
					{ props: { width: prop.attribute(String, "") } },
				);
				customElements.define(tag, SizedBox);

				const sizedBox = mount<InstanceType<typeof SizedBox>>(tag);
				await sleep(50);
				expect(sizedBox.shadowRoot!.querySelector("p")).not.toBeNull();

				const consoleError = vi
					.spyOn(console, "error")
					.mockImplementation(() => {});
				sizedBox.width = "10";
				await sleep(50);
				consoleError.mockRestore();

				expect(sizedBox.shadowRoot!.querySelector("p")).toBeNull();
				expect(sizedBox.shadowRoot!.textContent).toContain("grundlage");
			});

			test("a host binding that writes its own prop a new value every time ends in a visible error", async () => {
				const tag = uniqueTag("runaway-host-value");
				//without an update limit this loop runs through microtasks and freezes the browser the tests run in
				const runCountAtWhichTheTestEndsTheLoop = 1_000;
				let runCount = 0;
				customElements.define(
					tag,
					component(
						function* (componentProps) {
							yield function* () {
								runCount++;
								const hasTheTestEndedTheLoop =
									runCount >= runCountAtWhichTheTestEndsTheLoop;
								const nextValue = hasTheTestEndedTheLoop
									? componentProps.value
									: componentProps.value + 1;
								yield html`<template value=${nextValue}
									><p>${componentProps.value}</p></template
								>`;
							};
						},
						{ props: { value: prop.attribute(Number, 0) } },
					),
				);

				const consoleError = vi
					.spyOn(console, "error")
					.mockImplementation(() => {});
				const element = mount(tag);
				await sleep(50);
				consoleError.mockRestore();

				expect(element.shadowRoot!.querySelector("p")).toBeNull();
				expect(element.shadowRoot!.textContent).toContain("grundlage");
			});

			test("a write into a component that painted earlier lands before the frame, without writing any text twice", async () => {
				const writtenHeaderTag = uniqueTag("written-header");
				const readingHeaderTag = uniqueTag("reading-header");
				const checkoutTag = uniqueTag("checkout");
				const store = createStore({
					userName: "Ada",
					cartItems: [] as Array<string>,
				});

				const WrittenHeader = component(
					function* (componentProps) {
						const unsubscribe = store.subscribe(() =>
							componentProps.host.update(),
						);
						yield function* () {
							yield html`<p>
								${store.state.userName}, ${componentProps.cartCount} items
							</p>`;
						};
						return unsubscribe;
					},
					{ props: { cartCount: prop.attribute(Number, 0) } },
				);
				customElements.define(writtenHeaderTag, WrittenHeader);
				//updates once per publish, so its mutation count is what a single paint writes
				customElements.define(
					readingHeaderTag,
					component(function* ({ host }) {
						const unsubscribe = store.subscribe(() => host.update());
						yield function* () {
							yield html`<p>
								${store.state.userName}, ${store.state.cartItems.length} items
							</p>`;
						};
						return unsubscribe;
					}),
				);
				customElements.define(
					checkoutTag,
					component(function* ({ host }) {
						const unsubscribe = store.subscribe(() => host.update());
						yield function* () {
							writtenHeader.cartCount = store.state.cartItems.length;
							yield html`<ul>
								${store.state.cartItems.map((item) => html`<li>${item}</li>`)}
							</ul>`;
						};
						return unsubscribe;
					}),
				);

				const writtenHeader =
					mount<InstanceType<typeof WrittenHeader>>(writtenHeaderTag);
				const readingHeader = mount(readingHeaderTag);
				mount(checkoutTag);
				await sleep();

				const mutationsInWrittenHeader = countMutationsFrom(
					writtenHeader.shadowRoot!,
				);
				const mutationsInReadingHeader = countMutationsFrom(
					readingHeader.shadowRoot!,
				);
				store.publish({ userName: "Grace", cartItems: ["book"] });
				await nextFrame();

				expect(visibleText(writtenHeader.shadowRoot)).toBe("Grace, 1 items");
				expect(mutationsInWrittenHeader()).toBe(mutationsInReadingHeader());
			});

			test("children that make their ancestor update during its paint settle before the frame", async () => {
				const tabListTag = uniqueTag("tab-list");
				const tabGroupTag = uniqueTag("tab-group");
				const tabItemTag = uniqueTag("tab-item");
				const toastHostTag = uniqueTag("toast-host");
				let toastHostRuns = 0;

				const TabList = component(
					function* (componentProps) {
						componentProps.host.addEventListener("tab-register", () => {
							componentProps.host.tabCount += 1;
						});
						yield function* () {
							yield html`<p>${componentProps.tabCount} tabs</p><${tabGroupTag}></${tabGroupTag}>`;
						};
					},
					{ props: { tabCount: prop.attribute(Number, 0) } },
				);
				customElements.define(tabListTag, TabList);
				customElements.define(
					tabGroupTag,
					component(function* () {
						yield function* () {
							yield html`<${tabItemTag}></${tabItemTag}><${tabItemTag}></${tabItemTag}>`;
						};
					}),
				);
				customElements.define(
					tabItemTag,
					component(function* ({ host }) {
						host.dispatchEvent(
							new CustomEvent("tab-register", {
								bubbles: true,
								composed: true,
							}),
						);
						yield function* () {
							yield html`<button>tab</button>`;
						};
					}),
				);
				customElements.define(
					toastHostTag,
					component(function* ({ host }) {
						const refresh = () => host.update();
						document.addEventListener("tab-register", refresh);
						yield function* () {
							toastHostRuns++;
							yield html`<output></output>`;
						};
						return () => document.removeEventListener("tab-register", refresh);
					}),
				);

				mount(toastHostTag);
				const tabList = mount<InstanceType<typeof TabList>>(tabListTag);
				await nextFrame();

				expect(visibleText(tabList.shadowRoot!.querySelector("p"))).toBe(
					"2 tabs",
				);
				expect(toastHostRuns).toBe(2);
				expect(await settlesWithin(tabList.update(), 100)).toBe(true);
			});

			//the attribute write lands inside the writer's paint, so the update it triggers carries an
			//exact edge back to the writer. The code after the inner generator's yield runs once that
			//paint has restored the painter, which is where a second update() can erase that edge
			test("a component written into during a paint still waits for that writer when it updates itself too", async () => {
				const runLog: Array<string> = [];
				const writerTag = uniqueTag("writer");
				const writtenTag = uniqueTag("written");
				const notifierTag = uniqueTag("notifier");

				let written: BaseComponent | null = null;
				customElements.define(
					notifierTag,
					class extends HTMLElement {
						static observedAttributes = ["pass"];
						attributeChangedCallback() {
							written?.update();
						}
					},
				);
				customElements.define(
					writtenTag,
					component(function* () {
						yield function* () {
							runLog.push("written");
							yield html`<b>written</b>`;
						};
					}),
				);

				let pass = 0;
				customElements.define(
					writerTag,
					component(function* ({ host }) {
						//an inner generator, so the code after its yield runs again on every update()
						yield function* () {
							pass++;
							{
								runLog.push(`writer ${pass}`);
								yield html`<${notifierTag} pass=${pass}></${notifierTag}>`;
							}
							if (pass !== 2) return;
							host.update();
							written!.update();
						};
					}),
				);

				const writer = mount<BaseComponent>(writerTag);
				written = mount<BaseComponent>(writtenTag);
				await sleep(50);
				runLog.length = 0;

				writer.update();
				await nextFrame();

				//the writer is queued and is about to write into it again, so one update is the whole
				//point of the edge
				expect(runLog).toEqual(["writer 2", "writer 3", "written"]);
			});
		});

		describe("nothing waits on async work it does not own", () => {
			test("await update() covers the synchronous updates below the component at any depth", async () => {
				const leafTag = uniqueTag("leaf");
				const middleTag = uniqueTag("middle");
				const rootTag = uniqueTag("root");
				let label = "one";

				customElements.define(
					leafTag,
					component(
						function* (componentProps) {
							yield function* () {
								yield html`<i>${componentProps.label}</i>`;
							};
						},
						{ props: { label: prop.optional(prop.attribute(String)) } },
					),
				);
				customElements.define(
					middleTag,
					component(
						function* (componentProps) {
							yield function* () {
								yield html`<${leafTag} label=${componentProps.label}></${leafTag}>`;
							};
						},
						{ props: { label: prop.optional(prop.attribute(String)) } },
					),
				);
				const Root = component(function* () {
					yield function* () {
						yield html`<${middleTag} label=${label}></${middleTag}>`;
					};
				});
				customElements.define(rootTag, Root);

				const root = mount<InstanceType<typeof Root>>(rootTag);
				await sleep();
				const leafText = () =>
					visibleText(
						root
							.shadowRoot!.querySelector(middleTag)!
							.shadowRoot!.querySelector(leafTag)!.shadowRoot,
					);
				expect(leafText()).toBe("one");

				label = "two";
				await root.update();
				expect(leafText()).toBe("two");
			});

			test("children keep updating while their parent's update waits on a promise", async () => {
				const rowTag = uniqueTag("result-row");
				const resultsTag = uniqueTag("search-results");
				const store = createStore({ query: "ad" });
				const people = ["Ada", "Adele", "Adrian"];
				const pendingSearches: Array<() => void> = [];
				const searchPeople = (query: string) =>
					new Promise<Array<string>>((resolve) => {
						pendingSearches.push(() =>
							resolve(
								people.filter((person) =>
									person.toLowerCase().startsWith(query),
								),
							),
						);
					});

				customElements.define(
					rowTag,
					component(
						function* (componentProps) {
							const unsubscribe = store.subscribe(() =>
								componentProps.host.update(),
							);
							yield function* () {
								yield html`<li>
									${componentProps.personName} matches ${store.state.query}
								</li>`;
							};
							return unsubscribe;
						},
						{ props: { personName: prop.optional(prop.attribute(String)) } },
					),
				);
				customElements.define(
					resultsTag,
					component(function* ({ host }) {
						const unsubscribe = store.subscribe(() => host.update());
						yield function* () {
							const matches = yield* awaited(searchPeople(store.state.query));
							yield html`<ul>
								${matches.map((personName) => html`<${rowTag} personName=${personName}></${rowTag}>`)}
							</ul>`;
						};
						return unsubscribe;
					}),
				);
				const rowTexts = (element: HTMLElement) =>
					[...element.shadowRoot!.querySelectorAll(rowTag)].map((row) =>
						visibleText(row.shadowRoot),
					);

				const results = mount(resultsTag);
				await sleep();
				pendingSearches.shift()!();
				await sleep();
				expect(rowTexts(results)).toEqual([
					"Ada matches ad",
					"Adele matches ad",
					"Adrian matches ad",
				]);

				store.publish({ query: "ada" });
				await nextFrame();
				expect(rowTexts(results)).toEqual([
					"Ada matches ada",
					"Adele matches ada",
					"Adrian matches ada",
				]);

				pendingSearches.shift()!();
				await sleep();
				expect(rowTexts(results)).toEqual(["Ada matches ada"]);
			});

			test("a child's update generator can wait for its parent's update", async () => {
				const listTag = uniqueTag("row-list");
				const rowTag = uniqueTag("list-row");
				let listRuns = 0;

				customElements.define(
					listTag,
					component(function* () {
						yield function* () {
							listRuns++;
							yield html`<${rowTag}></${rowTag}>`;
						};
					}),
				);
				customElements.define(
					rowTag,
					component(function* ({ host }) {
						yield function* () {
							const list = (host.getRootNode() as ShadowRoot)
								.host as BaseComponent;
							yield list.update();
							yield html`<span>row</span>`;
						};
					}),
				);

				const list = mount(listTag);
				await sleep(50);

				expect(
					visibleText(list.shadowRoot!.querySelector(rowTag)!.shadowRoot),
				).toBe("row");
				expect(listRuns).toBe(2);
			});

			test("a parent's code after its yield can resolve what its child's update generator waits for", async () => {
				const pageTag = uniqueTag("chart-page");
				const viewTag = uniqueTag("chart-view");

				customElements.define(
					viewTag,
					component(
						function* (componentProps) {
							yield function* () {
								if (componentProps.source === undefined) return;
								const points = yield* awaited(componentProps.source);
								yield html`<p>${points?.length} points</p>`;
							};
						},
						{
							props: {
								source: prop.optional(
									prop.attribute((incoming: unknown) =>
										incoming instanceof Promise
											? (incoming as Promise<Array<number>>)
											: undefined,
									),
								),
							},
						},
					),
				);
				customElements.define(
					pageTag,
					component(function* () {
						const sourceReady = Promise.withResolvers<Array<number>>();
						yield function* () {
							yield html`<${viewTag} source=${sourceReady.promise}></${viewTag}>`;
						};
						sourceReady.resolve([1, 2, 3]);
					}),
				);

				const page = mount(pageTag);
				await sleep(50);

				expect(
					visibleText(page.shadowRoot!.querySelector(viewTag)!.shadowRoot),
				).toBe("3 points");
			});

			test("an async child written by two components updates once, and the second writer's await does not wait for it", async () => {
				const pageTag = uniqueTag("editor-page");
				const sliderTag = uniqueTag("zoom-slider");
				const previewTag = uniqueTag("preview-pane");
				const store = createStore({ documentText: "hello", zoomLevel: 1 });
				const previewRuns: Array<string> = [];

				const PreviewPane = component(
					function* (componentProps) {
						yield function* () {
							const { documentText, zoomLevel } = componentProps;
							previewRuns.push(`${documentText} at ${zoomLevel}`);
							yield sleep(20);
							yield html`<p>${documentText} at ${zoomLevel}</p>`;
						};
					},
					{
						props: {
							documentText: prop.attribute(String, ""),
							zoomLevel: prop.attribute(Number, 1),
						},
					},
				);
				customElements.define(previewTag, PreviewPane);
				const ZoomSlider = component(function* ({ host }) {
					const unsubscribe = store.subscribe(() => host.update());
					yield function* () {
						const preview = (host.getRootNode() as ShadowRoot).querySelector(
							previewTag,
						) as InstanceType<typeof PreviewPane>;
						preview.zoomLevel = store.state.zoomLevel;
						yield html`<input type="range" value=${store.state.zoomLevel} />`;
					};
					return unsubscribe;
				});
				customElements.define(sliderTag, ZoomSlider);
				customElements.define(
					pageTag,
					component(function* ({ host }) {
						const unsubscribe = store.subscribe(() => host.update());
						yield function* () {
							yield html`<${sliderTag}></${sliderTag}><${previewTag} documentText=${store.state.documentText}></${previewTag}>`;
						};
						return unsubscribe;
					}),
				);

				const page = mount(pageTag);
				await sleep(50);
				const slider = page.shadowRoot!.querySelector(
					sliderTag,
				) as InstanceType<typeof ZoomSlider>;
				const previewText = () =>
					visibleText(page.shadowRoot!.querySelector(previewTag)!.shadowRoot);
				expect(previewText()).toBe("hello at 1");
				previewRuns.length = 0;

				store.publish({ documentText: "hello world", zoomLevel: 2 });
				await slider.update();
				expect(previewText()).toBe("hello at 1");

				await sleep(50);
				expect(previewRuns).toEqual(["hello world at 2"]);
				expect(previewText()).toBe("hello world at 2");
			});

			test("a parent's await covers its child's synchronous update but not the child's async load", async () => {
				const profileTag = uniqueTag("user-profile");
				const pageTag = uniqueTag("profile-page");
				const fetchUser = async (userId: number) => {
					await sleep(20);
					return { name: `user ${userId}` };
				};

				const UserProfile = component(
					function* (componentProps) {
						yield function* () {
							const userId = componentProps.userId;
							yield html`<p>loading…</p>`;
							const user = yield* load(() => fetchUser(userId));
							yield html`<h2>${user.name}</h2>`;
						};
					},
					{ props: { userId: prop.attribute(Number, 0) } },
				);
				customElements.define(profileTag, UserProfile);
				let selectedUserId = 7;
				const ProfilePage = component(function* () {
					yield function* () {
						yield html`<${profileTag} userId=${selectedUserId}></${profileTag}>`;
					};
				});
				customElements.define(pageTag, ProfilePage);

				const page = mount<InstanceType<typeof ProfilePage>>(pageTag);
				await sleep(60);
				const profile = page.shadowRoot!.querySelector(
					profileTag,
				) as InstanceType<typeof UserProfile>;
				const profileText = () => visibleText(profile.shadowRoot);
				expect(profileText()).toBe("user 7");

				selectedUserId = 8;
				await page.update();
				expect(profileText()).toBe("loading…");

				await sleep(60);
				profile.userId = 9;
				await profile.update();
				expect(profileText()).toBe("user 9");
			});
		});

		describe("the order modules load in changes nothing", () => {
			interface User {
				name: string;
			}
			type Role = "name" | "avatar" | "badge" | "page";

			const setServerFlag = (isServer: boolean) => {
				(globalThis as { __grundlage_ssr__?: boolean }).__grundlage_ssr__ =
					isServer;
			};

			const renderOnServer = async (
				hostTag: string,
				defineComponents: () => void,
			): Promise<string> => {
				setServerFlag(true);
				try {
					defineComponents();
					const element = document.createElement(hostTag);
					document.body.append(element);
					await sleep();
					const serialized = element.getHTML({ serializableShadowRoots: true });
					element.remove();
					//lets the async disconnectedCallback drain before the next define
					await sleep();
					return `<${hostTag}>${serialized}</${hostTag}>`;
				} finally {
					setServerFlag(false);
				}
			};

			//the tags must still be undefined here, so every element is parsed and connected before
			//anything upgrades it
			const parseBeforeAnyDefinition = (markup: string): HTMLElement => {
				const wrapper = document.createElement("div");
				wrapper.setHTMLUnsafe(markup);
				const element = wrapper.firstElementChild as HTMLElement;
				document.body.append(element);
				return track(element);
			};

			const userNameComponent = (runLog: Array<string>) =>
				component(
					function* (componentProps) {
						yield function* () {
							runLog.push("name");
							yield html`<b>${componentProps.displayName}</b>`;
						};
					},
					{ props: { displayName: prop.optional(prop.attribute(String)) } },
				);
			const userAvatarComponent = (runLog: Array<string>) =>
				component(
					function* (componentProps) {
						yield function* () {
							runLog.push("avatar");
							yield html`<img alt=${componentProps.user?.name} />`;
						};
					},
					{
						props: {
							user: prop.optional(
								prop.attribute((incoming: unknown) =>
									typeof incoming === "object" && incoming !== null
										? (incoming as User)
										: undefined,
								),
							),
						},
					},
				);
			const userBadgeComponent = (runLog: Array<string>) =>
				component(function* () {
					yield function* () {
						runLog.push("badge");
						yield html`<i>badge</i>`;
					};
				});
			const userPageComponent = (
				runLog: Array<string>,
				childrenTemplate: (user: User) => Template,
			) =>
				component(function* () {
					const user = { name: "Ada" };
					yield function* () {
						runLog.push("page");
						yield html`${childrenTemplate(user)}`;
					};
				});

			let userPageServerMarkup: Promise<string> | null = null;
			const renderUserPageOnServer = () =>
				(userPageServerMarkup ??= renderOnServer("order-server-page", () => {
					const serverRunLog: Array<string> = [];
					customElements.define(
						"order-server-name",
						userNameComponent(serverRunLog),
					);
					customElements.define(
						"order-server-avatar",
						userAvatarComponent(serverRunLog),
					);
					customElements.define(
						"order-server-badge",
						userBadgeComponent(serverRunLog),
					);
					customElements.define(
						"order-server-page",
						userPageComponent(
							serverRunLog,
							(user) =>
								html`<order-server-name
										displayName=${user.name}
									></order-server-name
									><order-server-avatar user=${user}></order-server-avatar
									><order-server-badge></order-server-badge>`,
						),
					);
				}));

			test.each([
				{
					loadOrder: "the children before their page",
					tagPrefix: "order-children-first",
					definitionOrder: ["name", "avatar", "badge", "page"] as Array<Role>,
					childrenTemplate: (user: User) =>
						html`<order-children-first-name
								displayName=${user.name}
							></order-children-first-name
							><order-children-first-avatar
								user=${user}
							></order-children-first-avatar
							><order-children-first-badge></order-children-first-badge>`,
				},
				{
					loadOrder: "the page before its children",
					tagPrefix: "order-page-first",
					definitionOrder: ["page", "name", "avatar", "badge"] as Array<Role>,
					childrenTemplate: (user: User) =>
						html`<order-page-first-name
								displayName=${user.name}
							></order-page-first-name
							><order-page-first-avatar user=${user}></order-page-first-avatar
							><order-page-first-badge></order-page-first-badge>`,
				},
			])(
				"a hydrated page updates before its children when they update together, loading $loadOrder",
				async ({ tagPrefix, definitionOrder, childrenTemplate }) => {
					const runLog: Array<string> = [];
					const definitions: Record<Role, CustomElementConstructor> = {
						name: userNameComponent(runLog),
						avatar: userAvatarComponent(runLog),
						badge: userBadgeComponent(runLog),
						page: userPageComponent(runLog, childrenTemplate),
					};
					const serverMarkup = await renderUserPageOnServer();
					const page = parseBeforeAnyDefinition(
						serverMarkup.replaceAll("order-server-", `${tagPrefix}-`),
					) as BaseComponent;
					const serverRenderedChildren = [...page.shadowRoot!.children];

					for (const role of definitionOrder) {
						customElements.define(`${tagPrefix}-${role}`, definitions[role]);
						await sleep();
					}
					//the server's children are reused, so each one started when its own module loaded
					serverRenderedChildren.forEach((child, index) =>
						expect(page.shadowRoot!.children[index]).toBe(child),
					);

					runLog.length = 0;
					for (const child of serverRenderedChildren as Array<BaseComponent>)
						child.update();
					await page.update();
					await sleep();

					expect(runLog[0]).toBe("page");
					expect(runLog.toSorted()).toEqual([
						"avatar",
						"badge",
						"name",
						"page",
					]);
				},
			);

			test("a server-rendered child handles events before its page's module loads", async () => {
				const buyButtonComponent = () =>
					component(
						function* (componentProps) {
							const buy = () =>
								componentProps.host.dispatchEvent(
									new CustomEvent("buy", { bubbles: true, composed: true }),
								);
							yield function* () {
								yield html`<button onClick=${buy}>
									Buy ${componentProps.sku}
								</button>`;
							};
						},
						{ props: { sku: prop.optional(prop.attribute(String)) } },
					);
				const productPageComponent = (contentTemplate: () => Template) =>
					component(function* () {
						yield function* () {
							yield html`${contentTemplate()}`;
						};
					});
				const sku = "42";

				const serverMarkup = await renderOnServer("island-server-page", () => {
					customElements.define("island-server-button", buyButtonComponent());
					customElements.define(
						"island-server-page",
						productPageComponent(
							() =>
								html`<island-server-button sku=${sku}></island-server-button>`,
						),
					);
				});
				const page = parseBeforeAnyDefinition(
					serverMarkup.replaceAll("island-server-", "island-client-"),
				);
				let buyEvents = 0;
				page.addEventListener("buy", () => buyEvents++);
				const clickBuy = () =>
					page
						.shadowRoot!.querySelector("island-client-button")!
						.shadowRoot!.querySelector("button")!
						.click();

				customElements.define("island-client-button", buyButtonComponent());
				await sleep();
				clickBuy();
				expect(buyEvents).toBe(1);

				customElements.define(
					"island-client-page",
					productPageComponent(
						() =>
							html`<island-client-button sku=${sku}></island-client-button>`,
					),
				);
				await sleep();
				clickBuy();
				expect(buyEvents).toBe(2);
			});

			//hydration is the one path where the DOM a post-paint read answers with was written by the
			//server. It is still the same rule as an update, where the read answers with the text from
			//before: what it may never show is the update this paint just asked for
			test("post-paint code during hydration reads the server's DOM, and never runs on the server at all", async () => {
				const defineHydrationPair = (
					prefix: string,
					label: string,
					readsAfterThePaint: Array<string>,
				) => {
					customElements.define(
						`${prefix}-label`,
						component(
							function* (componentProps) {
								yield function* () {
									yield html`<b>${componentProps.text}</b>`;
								};
							},
							{ props: { text: prop.attribute(String, "") } },
						),
					);
					customElements.define(
						`${prefix}-page`,
						component(function* (componentProps) {
							yield function* () {
								yield html`<${prefix}-label text=${label}></${prefix}-label>`;
								readsAfterThePaint.push(
									visibleText(
										componentProps.host.shadowRoot!.querySelector(
											`${prefix}-label`,
										)?.shadowRoot ?? null,
									) ?? "",
								);
							};
						}),
					);
				};

				const readsOnTheServer: Array<string> = [];
				const serverMarkup = await renderOnServer(
					"hydration-read-server-page",
					() =>
						defineHydrationPair(
							"hydration-read-server",
							"from the server",
							readsOnTheServer,
						),
				);
				const page = parseBeforeAnyDefinition(
					serverMarkup.replaceAll(
						"hydration-read-server",
						"hydration-read-client",
					),
				);
				const readsOnTheClient: Array<string> = [];
				defineHydrationPair(
					"hydration-read-client",
					"from the client",
					readsOnTheClient,
				);
				await sleep(50);

				expect(readsOnTheServer).toEqual([]);
				expect(readsOnTheClient).toEqual(["from the server"]);
				expect(
					visibleText(
						page.shadowRoot!.querySelector("hydration-read-client-label")!
							.shadowRoot,
					),
				).toBe("from the client");
			});
		});

		describe("depth and loops stay predictable", () => {
			//the shared store publishes in subscription order, which is already parents first. Reversing
			//it is what makes every level have to wait for the one above it
			const createStorePublishingDeepestFirst = <State extends object>(
				state: State,
			) => {
				const store = createStore(state);
				const listeners: Array<() => void> = [];
				return {
					...store,
					subscribe: (listener: () => void) => {
						listeners.push(listener);
						return () => listeners.splice(listeners.indexOf(listener), 1);
					},
					publish: (changes: Partial<State>) => {
						Object.assign(state, changes);
						for (const listener of [...listeners].reverse()) listener();
					},
				};
			};

			//every level is dirtied in one pass and every level has to wait for the one above it, so the
			//number of times a run is passed over is its own depth. Only an update may count as one
			test("a chain deeper than the update limit updates top down, once per component", async () => {
				const depth = 140;
				const tag = uniqueTag("deep-chain");
				const store = createStorePublishingDeepestFirst({ label: "before" });
				const updatedLevels: Array<number> = [];

				customElements.define(
					tag,
					component(
						function* (componentProps) {
							const unsubscribe = store.subscribe(() =>
								componentProps.host.update(),
							);
							const level = componentProps.level;
							yield function* () {
								updatedLevels.push(level);
								yield level < depth
									? html`<${tag} level=${level + 1}></${tag}>`
									: html`<b>${store.state.label}</b>`;
							};
							return unsubscribe;
						},
						{ props: { level: prop.attribute(Number, 0) } },
					),
				);

				let deepest = mount(tag);
				await sleep(100);
				while (deepest.shadowRoot!.querySelector(tag))
					deepest = deepest.shadowRoot!.querySelector(tag)!;
				updatedLevels.length = 0;

				store.publish({ label: "after" });
				await nextFrame();

				expect(visibleText(deepest.shadowRoot)).toBe("after");
				expect(updatedLevels).toEqual(
					Array.from({ length: depth + 1 }, (_, level) => level),
				);
			});

			//a component only ever paints into its own shadow root, so the one way a paint reaches a
			//component beside it is a plain element's setter on the property mode
			test("two components that write each other through a paint end in a visible error", async () => {
				const relayTag = uniqueTag("relay");
				const leftTag = uniqueTag("left");
				const rightTag = uniqueTag("right");
				const partners = new Map<string, HTMLElement & { count: number }>();

				customElements.define(
					relayTag,
					class extends HTMLElement {
						#carried: unknown = null;
						get carried() {
							return this.#carried;
						}
						set carried(incoming: unknown) {
							this.#carried = incoming;
							const partner = partners.get(this.getAttribute("partner") ?? "");
							if (partner) partner.count += 1;
						}
					},
				);
				const defineWriter = (tag: string, partnerName: string) =>
					customElements.define(
						tag,
						component(
							function* (componentProps) {
								yield function* () {
									yield html`<${relayTag} partner=${partnerName} carried=${{ count: componentProps.count }}></${relayTag}>`;
								};
							},
							{ props: { count: prop.attribute(Number, 0) } },
						),
					);
				defineWriter(leftTag, "right");
				defineWriter(rightTag, "left");

				const consoleError = vi
					.spyOn(console, "error")
					.mockImplementation(() => {});
				const left = track(
					document.createElement(leftTag) as HTMLElement & { count: number },
				);
				const right = track(
					document.createElement(rightTag) as HTMLElement & { count: number },
				);
				partners.set("left", left);
				partners.set("right", right);
				document.body.append(left, right);
				await sleep(100);
				consoleError.mockRestore();

				const shownText = [left, right]
					.map((element) => visibleText(element.shadowRoot) ?? "")
					.join(" ");
				expect(shownText).toContain("grundlage");
				expect(left.isConnected && right.isConnected).toBe(true);
				//a ring of writers trips the runaway limit, not the sweep: one of the two keeps updating,
				//so the pass never goes all the way round without an update
				expect(shownText).toContain("updated too often");
				expect(shownText).not.toContain("waiting for each other");
			});

			//an ended component stays ended while it is in the document, so paint after paint asking it
			//to start again cannot loop it through its failing mount
			test("a failed component ignores restarts from paint after paint", async () => {
				const brokenTag = uniqueTag("broken");
				const restarterTag = uniqueTag("restarter");
				const relayTag = uniqueTag("relay");
				let restartsLeft = 140;
				let mountAttempts = 0;

				customElements.define(
					brokenTag,
					component(function* () {
						mountAttempts++;
						throw new Error("this one cannot mount");
					}),
				);
				customElements.define(
					relayTag,
					class extends HTMLElement {
						//connected inside the restarter's paint, which is what makes the start a queue entry
						//rather than a mount on the spot
						connectedCallback() {
							if (restartsLeft-- <= 0) return;
							const broken = document.querySelector(brokenTag)!;
							broken.setAttribute("defer-hydration", "");
							broken.removeAttribute("defer-hydration");
							document.body.append(track(document.createElement(restarterTag)));
						}
					},
				);
				customElements.define(
					restarterTag,
					component(function* () {
						yield html`<${relayTag}></${relayTag}>`;
					}),
				);

				const consoleError = vi
					.spyOn(console, "error")
					.mockImplementation(() => {});
				const broken = mount<BaseComponent>(brokenTag);
				mount(restarterTag);
				await sleep(100);
				consoleError.mockRestore();

				expect(mountAttempts).toBe(1);
				expect(restartsLeft).toBeLessThan(0);
				expect(visibleText(broken.shadowRoot)).toContain("cannot mount");
			});

			//a run that fails is out of the queue for good, so the runs that were waiting on it have
			//nothing left to wait for and the rest of the pass has to finish normally
			test("a component that fails mid-pass releases the runs waiting on it", async () => {
				const childTag = uniqueTag("child");
				const pageTag = uniqueTag("page");
				const bystanderTag = uniqueTag("bystander");
				const bystanderRuns: Array<string> = [];
				let thePageShouldFail = false;

				customElements.define(
					childTag,
					component(function* () {
						yield function* () {
							yield html`<b>a child</b>`;
						};
					}),
				);
				customElements.define(
					pageTag,
					component(function* () {
						yield function* () {
							if (thePageShouldFail) throw new Error("the page failed");
							yield html`<${childTag}></${childTag}>`;
						};
					}),
				);
				customElements.define(
					bystanderTag,
					component(
						function* (componentProps) {
							yield function* () {
								bystanderRuns.push(componentProps.label);
								yield html`<b>${componentProps.label}</b>`;
							};
						},
						{ props: { label: prop.attribute(String, "first") } },
					),
				);

				const page = mount<BaseComponent>(pageTag);
				const bystander = mount<BaseComponent & { label: string }>(
					bystanderTag,
				);
				await sleep(50);
				const child = page.shadowRoot!.querySelector(childTag) as BaseComponent;
				bystanderRuns.length = 0;
				thePageShouldFail = true;

				const consoleError = vi
					.spyOn(console, "error")
					.mockImplementation(() => {});
				//the child is queued first and has to wait for the page, which never updates again
				const childSettled = child.update();
				page.update();
				bystander.label = "second";
				await nextFrame();
				consoleError.mockRestore();

				expect(visibleText(page.shadowRoot)).toContain("the page failed");
				expect(await settlesWithin(childSettled, 200)).toBe(true);
				expect(bystanderRuns).toEqual(["second"]);
			});

			//a ring, not a loop: the child's paint dirties the parent, so the parent waits on the child,
			//and the child dirties itself, so it waits on the only run above it. Neither can go first
			//and no further trip round the queue can break that
			test("two components that wait for each other end in a visible error", async () => {
				const parentTag = uniqueTag("ring-parent");
				const childTag = uniqueTag("ring-child");
				const registrarTag = uniqueTag("ring-registrar");

				//plain, so it announces itself inside the child's paint rather than from a run of its own
				customElements.define(
					registrarTag,
					class extends HTMLElement {
						connectedCallback() {
							this.dispatchEvent(
								new Event("registered", { bubbles: true, composed: true }),
							);
						}
					},
				);

				const updateOnRegistration = (host: BaseComponent) =>
					host.addEventListener("registered", () => {
						host.update();
					});

				customElements.define(
					childTag,
					component(function* ({ host }) {
						updateOnRegistration(host);
						yield function* () {
							yield html`<${registrarTag}></${registrarTag}>`;
						};
					}),
				);
				customElements.define(
					parentTag,
					component(function* ({ host }) {
						updateOnRegistration(host);
						yield function* () {
							yield html`<${childTag}></${childTag}>`;
						};
					}),
				);

				const consoleError = vi
					.spyOn(console, "error")
					.mockImplementation(() => {});
				const parent = mount(parentTag);
				await sleep(100);
				const loggedErrors = consoleError.mock.calls.map((call) =>
					call.join(" "),
				);
				consoleError.mockRestore();

				//whichever of the two the queue was holding when the ring closed is the one that shows it
				const shownText = [
					parent,
					...parent.shadowRoot!.querySelectorAll(childTag),
				]
					.map((element) => visibleText(element.shadowRoot) ?? "")
					.join(" ");

				expect(
					loggedErrors.some((text) => text.includes("waiting for each other")),
				).toBe(true);
				expect(shownText).toContain("waiting for each other");
				expect(parent.isConnected).toBe(true);
			});

			//the leaf's nearest component is the layout, which nothing dirties, so the run it has to wait
			//for is two levels up
			test("a grandchild updates once when the component between it and the store does not subscribe", async () => {
				const leafTag = uniqueTag("leaf");
				const layoutTag = uniqueTag("layout");
				const pageTag = uniqueTag("page");
				const store = createStorePublishingDeepestFirst({ heading: "before" });
				const leafRuns: Array<string> = [];

				customElements.define(
					leafTag,
					component(
						function* (componentProps) {
							const unsubscribe = store.subscribe(() =>
								componentProps.host.update(),
							);
							yield function* () {
								leafRuns.push(componentProps.heading);
								yield html`<b>${componentProps.heading}</b>`;
							};
							return unsubscribe;
						},
						{ props: { heading: prop.attribute(String, "") } },
					),
				);
				customElements.define(
					layoutTag,
					component(
						function* (componentProps) {
							yield function* () {
								yield html`<${leafTag} heading=${componentProps.heading}></${leafTag}>`;
							};
						},
						{ props: { heading: prop.attribute(String, "") } },
					),
				);
				customElements.define(
					pageTag,
					component(function* (componentProps) {
						const unsubscribe = store.subscribe(() =>
							componentProps.host.update(),
						);
						yield function* () {
							yield html`<${layoutTag} heading=${store.state.heading}></${layoutTag}>`;
						};
						return unsubscribe;
					}),
				);

				const page = mount(pageTag);
				await sleep(100);
				const leaf = page
					.shadowRoot!.querySelector(layoutTag)!
					.shadowRoot!.querySelector(leafTag)!;
				leafRuns.length = 0;

				store.publish({ heading: "after" });
				await nextFrame();
				expect(leafRuns).toEqual(["after"]);
				expect(visibleText(leaf.shadowRoot)).toBe("after");
			});
		});

		//the code straight after a paint runs while the generator is still on the stack, and nothing

		//every shape a component can take, asked the same question: does the code after the yield see
		//the label this paint just wrote to the child? The shape must not be able to change the answer
		const sawTheLabelItJustWrote = (
			childTag: string,
			componentProps: { host: BaseComponent; label: string },
		): boolean =>
			visibleText(
				componentProps.host.shadowRoot!.querySelector(childTag)?.shadowRoot ??
					null,
			) === componentProps.label;

		const defineLabelledChild = (
			childTag: string,
			childWaitsBeforePainting: boolean,
		) =>
			customElements.define(
				childTag,
				component(
					function* (componentProps) {
						yield function* () {
							if (childWaitsBeforePainting) yield sleep();
							yield html`<b>${componentProps.label}</b>`;
						};
					},
					{ props: { label: prop.attribute(String, "") } },
				),
			);

		interface ParentShape {
			shape: string;
			readsAgainOnUpdate: boolean;
			defineParent: (
				parentTag: string,
				childTag: string,
				readsAfterThePaint: Array<boolean>,
			) => void;
		}

		//the two shapes that read from the body after an inner generator fail today: the inner
		//generator drives a second driver loop, which drains the queue at its own end or park while
		//the body that installed it is still parked mid-step
		const parentShapes: Array<ParentShape> = [
			{
				shape: "a template yielded from the body",
				readsAgainOnUpdate: false,
				defineParent: (parentTag, childTag, readsAfterThePaint) =>
					customElements.define(
						parentTag,
						component(
							function* (componentProps) {
								yield html`<${childTag} label=${componentProps.label}></${childTag}>`;
								readsAfterThePaint.push(
									sawTheLabelItJustWrote(childTag, componentProps),
								);
							},
							{ props: { label: prop.attribute(String, "first") } },
						),
					),
			},
			{
				shape: "an inner generator, reading after its own yield",
				readsAgainOnUpdate: true,
				defineParent: (parentTag, childTag, readsAfterThePaint) =>
					customElements.define(
						parentTag,
						component(
							function* (componentProps) {
								yield function* () {
									yield html`<${childTag} label=${componentProps.label}></${childTag}>`;
									readsAfterThePaint.push(
										sawTheLabelItJustWrote(childTag, componentProps),
									);
								};
							},
							{ props: { label: prop.attribute(String, "first") } },
						),
					),
			},
			{
				shape: "an inner generator that ended, read after it",
				readsAgainOnUpdate: false,
				defineParent: (parentTag, childTag, readsAfterThePaint) =>
					customElements.define(
						parentTag,
						component(
							function* (componentProps) {
								yield function* () {
									yield html`<${childTag} label=${componentProps.label}></${childTag}>`;
								};
								readsAfterThePaint.push(
									sawTheLabelItJustWrote(childTag, componentProps),
								);
							},
							{ props: { label: prop.attribute(String, "first") } },
						),
					),
			},
		];

		test.each(parentShapes)(
			"post-paint code does not see the child it just wrote, from $shape",
			async ({ readsAgainOnUpdate, defineParent }) => {
				for (const childWaitsBeforePainting of [false, true]) {
					const childTag = uniqueTag("child");
					const parentTag = uniqueTag("parent");
					const readsAfterThePaint: Array<boolean> = [];
					defineLabelledChild(childTag, childWaitsBeforePainting);
					defineParent(parentTag, childTag, readsAfterThePaint);

					const parent = mount<HTMLElement & { label: string }>(parentTag);
					await sleep(50);
					parent.label = "second";
					await sleep(50);

					expect({ childWaitsBeforePainting, readsAfterThePaint }).toEqual({
						childWaitsBeforePainting,
						readsAfterThePaint: readsAgainOnUpdate ? [false, false] : [false],
					});
				}
			},
		);

		//a component mounts on the spot when no paint is running, and post-paint code is exactly that
		//window. Neither what the post-paint code mounts nor where this component was mounted may
		//change what it reads
		type WhatToMountAfterThePaint =
			"nothing" | "another component" | "a plain element";

		const mountablesAfterThePaint: Array<{
			whatItMounts: WhatToMountAfterThePaint;
		}> = [
			//mounting a component fails today: nothing is painting, so it mounts on the spot and its own
			//driver loop drains the queue on the way out
			{ whatItMounts: "nothing" },
			{ whatItMounts: "another component" },
			{ whatItMounts: "a plain element" },
		];

		const defineParentMountingSomethingAfterThePaint = (
			parentTag: string,
			childTag: string,
			otherComponentTag: string,
			whatItMounts: WhatToMountAfterThePaint,
			readsAfterThePaint: Array<boolean>,
		) =>
			customElements.define(
				parentTag,
				component(
					function* (componentProps) {
						yield function* () {
							yield html`<${childTag} label=${componentProps.label}></${childTag}>`;
							if (whatItMounts === "another component")
								mount(otherComponentTag);
							if (whatItMounts === "a plain element") mount("div");
							readsAfterThePaint.push(
								sawTheLabelItJustWrote(childTag, componentProps),
							);
						};
					},
					{ props: { label: prop.attribute(String, "first") } },
				),
			);

		const readAtBothMountSites = async (
			whatItMounts: WhatToMountAfterThePaint,
		) => {
			const otherComponentTag = uniqueTag("other");
			customElements.define(
				otherComponentTag,
				component(function* () {
					yield function* () {
						yield html`<i>other</i>`;
					};
				}),
			);

			const readAtATopLevelMount: Array<boolean> = [];
			const topLevelChildTag = uniqueTag("child");
			const topLevelParentTag = uniqueTag("parent");
			defineLabelledChild(topLevelChildTag, false);
			defineParentMountingSomethingAfterThePaint(
				topLevelParentTag,
				topLevelChildTag,
				otherComponentTag,
				whatItMounts,
				readAtATopLevelMount,
			);
			const topLevelParent = mount<HTMLElement & { label: string }>(
				topLevelParentTag,
			);
			await sleep(50);
			topLevelParent.label = "second";
			await sleep(50);

			const readInsideAPaint: Array<boolean> = [];
			const nestedChildTag = uniqueTag("child");
			const nestedParentTag = uniqueTag("parent");
			const wrapperTag = uniqueTag("wrapper");
			defineLabelledChild(nestedChildTag, false);
			defineParentMountingSomethingAfterThePaint(
				nestedParentTag,
				nestedChildTag,
				otherComponentTag,
				whatItMounts,
				readInsideAPaint,
			);
			customElements.define(
				wrapperTag,
				component(
					function* (componentProps) {
						yield function* () {
							yield html`<${nestedParentTag} label=${componentProps.label}></${nestedParentTag}>`;
						};
					},
					{ props: { label: prop.attribute(String, "first") } },
				),
			);
			const wrapper = mount<HTMLElement & { label: string }>(wrapperTag);
			await sleep(50);
			wrapper.label = "second";
			await sleep(50);

			return { readAtATopLevelMount, readInsideAPaint };
		};

		test.each(mountablesAfterThePaint)(
			"post-paint code that mounts $whatItMounts reads the same DOM at a top-level mount as inside a paint",
			async ({ whatItMounts }) => {
				expect(await readAtBothMountSites(whatItMounts)).toEqual({
					readAtATopLevelMount: [false, false],
					readInsideAPaint: [false, false],
				});
			},
		);

		//the case this whole update order came from: a list that keeps one row and adds two. Every
		//row has to read as "has not painted", the kept one by showing its old text and the new ones
		//by showing nothing
		test("a list that takes more rows sees no row it just wrote, the row it kept as well as the rows it added", async () => {
			const rowTag = uniqueTag("row");
			const listTag = uniqueTag("list");
			const rowTextsAfterThePaint: Array<Array<string>> = [];
			const rowTexts = (list: HTMLElement) =>
				[...list.shadowRoot!.querySelectorAll(rowTag)].map(
					(row) => visibleText(row.shadowRoot) ?? "",
				);

			customElements.define(
				rowTag,
				component(
					function* (componentProps) {
						yield function* () {
							yield html`<b>${componentProps.entry}</b>`;
						};
					},
					{ props: { entry: prop.attribute(String, "") } },
				),
			);
			customElements.define(
				listTag,
				component(
					function* (componentProps) {
						yield function* () {
							yield html`${componentProps.entries
								.split(",")
								.map((entry) => html`<${rowTag} entry=${entry}></${rowTag}>`)}`;
							rowTextsAfterThePaint.push(rowTexts(componentProps.host));
						};
					},
					{ props: { entries: prop.attribute(String, "a") } },
				),
			);

			const list = mount<HTMLElement & { entries: string }>(listTag);
			await sleep(50);
			list.entries = "a,b,c";
			await sleep(50);

			expect(rowTextsAfterThePaint).toEqual([[""], ["a", "", ""]]);
			expect(rowTexts(list)).toEqual(["a", "b", "c"]);
		});

		//"above" means "whose shadow tree contains this element", which is neither the document order
		//nor the nesting a reader sees in the markup
		describe("what a run waits for is what is above it in the shadow trees", () => {
			const defineLoggingComponent = (
				tag: string,
				role: string,
				runLog: Array<string>,
				contentTemplate: () => Template,
			) =>
				customElements.define(
					tag,
					component(function* () {
						yield function* () {
							runLog.push(role);
							yield html`${contentTemplate()}`;
						};
					}),
				);

			test("a slotted component does not wait for the component that slots it, and unrelated components update in the order they were dirtied", async () => {
				const runLog: Array<string> = [];
				const earlierTag = uniqueTag("earlier");
				const laterTag = uniqueTag("later");
				const frameTag = uniqueTag("frame");
				const shadowChildTag = uniqueTag("shadow-child");
				const slottedTag = uniqueTag("slotted");

				defineLoggingComponent(
					earlierTag,
					"earlier",
					runLog,
					() => html`<b>earlier</b>`,
				);
				defineLoggingComponent(
					laterTag,
					"later",
					runLog,
					() => html`<b>later</b>`,
				);
				defineLoggingComponent(
					shadowChildTag,
					"shadow child",
					runLog,
					() => html`<b>in the shadow tree</b>`,
				);
				defineLoggingComponent(
					slottedTag,
					"slotted",
					runLog,
					() => html`<b>slotted</b>`,
				);
				defineLoggingComponent(
					frameTag,
					"frame",
					runLog,
					() => html`<slot></slot><${shadowChildTag}></${shadowChildTag}>`,
				);

				const earlier = mount<BaseComponent>(earlierTag);
				const later = mount<BaseComponent>(laterTag);
				const frame = mount<BaseComponent>(frameTag);
				const slotted = track(
					document.createElement(slottedTag),
				) as BaseComponent;
				frame.append(slotted);
				await sleep(50);
				const shadowChild = frame.shadowRoot!.querySelector(
					shadowChildTag,
				) as BaseComponent;
				runLog.length = 0;

				later.update();
				earlier.update();
				shadowChild.update();
				slotted.update();
				frame.update();
				await nextFrame();

				//the slotted component sits inside the frame in the markup and still updates before it:
				//the frame's shadow tree does not contain it, so nothing about the frame can reach it
				expect(runLog).toEqual([
					"later",
					"earlier",
					"slotted",
					"frame",
					"shadow child",
				]);
			});

			//the shadow root directly above the leaf belongs to an element the library never registered,
			//so the run it waits for is only found by climbing out of that root as well
			test("a component inside a foreign shadow root waits for the component above that root", async () => {
				const runLog: Array<string> = [];
				const outerTag = uniqueTag("outer");
				const foreignTag = uniqueTag("foreign");
				const leafTag = uniqueTag("leaf");

				customElements.define(
					foreignTag,
					class extends HTMLElement {
						connectedCallback() {
							if (this.shadowRoot !== null) return;
							this.attachShadow({ mode: "open" }).append(
								document.createElement(leafTag),
							);
						}
					},
				);
				defineLoggingComponent(
					leafTag,
					"leaf",
					runLog,
					() => html`<b>leaf</b>`,
				);
				defineLoggingComponent(
					outerTag,
					"outer",
					runLog,
					() => html`<${foreignTag}></${foreignTag}>`,
				);

				const outer = mount<BaseComponent>(outerTag);
				await sleep(50);
				const foreign = outer.shadowRoot!.querySelector(foreignTag)!;
				const leaf = foreign.shadowRoot!.querySelector(
					leafTag,
				) as BaseComponent;
				runLog.length = 0;

				//dirtied leaf first and from outside any paint, so the causal edge is empty and the
				//shadow trees are the only thing that can order these two
				leaf.update();
				outer.update();
				await nextFrame();

				expect(runLog).toEqual(["outer", "leaf"]);
			});

			test("a queued component moved into another shadow tree updates once, with the value it was given", async () => {
				const travellerTag = uniqueTag("traveller");
				const departureTag = uniqueTag("departure");
				const arrivalTag = uniqueTag("arrival");
				const travellerRuns: Array<string> = [];

				customElements.define(
					travellerTag,
					component(
						function* (componentProps) {
							yield function* () {
								travellerRuns.push(componentProps.value);
								yield html`<b>${componentProps.value}</b>`;
							};
						},
						{ props: { value: prop.attribute(String, "") } },
					),
				);
				customElements.define(
					departureTag,
					component(function* () {
						yield function* () {
							yield html`<div><${travellerTag} value="first"></${travellerTag}></div>`;
						};
					}),
				);
				customElements.define(
					arrivalTag,
					component(function* () {
						yield function* () {
							yield html`<div></div>`;
						};
					}),
				);

				const departure = mount(departureTag);
				const arrival = mount(arrivalTag);
				await sleep(50);
				const traveller = departure.shadowRoot!.querySelector(
					travellerTag,
				) as BaseComponent & { value: string };
				travellerRuns.length = 0;

				traveller.value = "second";
				arrival.shadowRoot!.querySelector("div")!.append(traveller);
				await nextFrame();

				expect(travellerRuns).toEqual(["second"]);
				expect(visibleText(traveller.shadowRoot)).toBe("second");
				expect(traveller.getRootNode()).toBe(arrival.shadowRoot);
			});

			//the phase is read at the drain and not at the enqueue, so a host that left the document in
			//between is dropped rather than painted into a detached root
			test("a host removed before the pass reaches it does not paint, and its update still settles", async () => {
				const tag = uniqueTag("leaving");
				const runs: Array<string> = [];

				customElements.define(
					tag,
					component(
						function* (componentProps) {
							yield function* () {
								runs.push(componentProps.label);
								yield html`<b>${componentProps.label}</b>`;
							};
						},
						{ props: { label: prop.attribute(String, "first") } },
					),
				);

				const element = mount<BaseComponent & { label: string }>(tag);
				await sleep(50);
				runs.length = 0;

				element.label = "second";
				const settled = element.update();
				element.remove();

				expect(await settlesWithin(settled, 200)).toBe(true);
				expect(runs).toEqual([]);
			});

			//the other phase a run can be dropped in at the drain: it was queued while it was ready to
			//start, and the mark its parent owes it arrived before the pass got to it
			test("a child marked after it connected is dropped from the pass, and runs when the mark comes off", async () => {
				const parentTag = uniqueTag("owing");
				const childTag = uniqueTag("owed");
				const runs: Array<string> = [];

				defineLoggingComponent(
					childTag,
					"child",
					runs,
					() => html`<b>child</b>`,
				);
				customElements.define(
					parentTag,
					component(function* ({ host }) {
						yield function* () {
							yield html`<${childTag}></${childTag}>`;
						};
						//the child connected during that paint and is queued, and this code runs before the
						//generator leaves the stack, so the mark beats the pass
						host
							.shadowRoot!.querySelector(childTag)!
							.setAttribute("defer-hydration", "");
					}),
				);

				const parent = mount<BaseComponent>(parentTag);
				await sleep(50);
				const child = parent.shadowRoot!.querySelector(childTag)!;

				expect(runs).toEqual([]);

				child.removeAttribute("defer-hydration");
				await sleep(50);

				expect(runs).toEqual(["child"]);
			});

			//the move mounts the child on the spot, and the START its parent's paint queued must not run
			//it a second time
			test("a child moved straight after the paint that queued it runs its update generator once", async () => {
				const parentTag = uniqueTag("mover");
				const childTag = uniqueTag("moved");
				const runs: Array<string> = [];

				defineLoggingComponent(
					childTag,
					"child",
					runs,
					() => html`<b>child</b>`,
				);
				customElements.define(
					parentTag,
					component(function* ({ host }) {
						yield html`<div><${childTag}></${childTag}></div><section></section>`;
						const child = host.shadowRoot!.querySelector(childTag)!;
						host.shadowRoot!.querySelector("section")!.append(child);
					}),
				);

				mount<BaseComponent>(parentTag);
				await sleep(50);

				expect(runs).toEqual(["child"]);
			});

			//a template yielded straight from the component body leaves no current update generator, so
			//update() has nothing to re-fire and no reason to take a place in the queue
			test("a component with nothing to rerun does not delay a component inside it", async () => {
				const runLog: Array<string> = [];
				const holderTag = uniqueTag("holder");
				const insideTag = uniqueTag("inside");
				const besideTag = uniqueTag("beside");

				defineLoggingComponent(
					insideTag,
					"inside",
					runLog,
					() => html`<b>inside</b>`,
				);
				defineLoggingComponent(
					besideTag,
					"beside",
					runLog,
					() => html`<b>beside</b>`,
				);
				customElements.define(
					holderTag,
					component(function* () {
						yield html`<${insideTag}></${insideTag}>`;
					}),
				);

				const holder = mount<BaseComponent>(holderTag);
				const beside = mount<BaseComponent>(besideTag);
				await sleep(50);
				const inside = holder.shadowRoot!.querySelector(
					insideTag,
				) as BaseComponent;
				runLog.length = 0;

				inside.update();
				beside.update();
				holder.update();
				await nextFrame();

				//dirtied first and never blocked: a queued holder would have passed it over for a trip
				expect(runLog).toEqual(["inside", "beside"]);
			});
		});
		describe("post-paint code reads the same DOM however the run started", () => {
			const mountParentWritingAChild = (parksAfterThePaint: boolean) => {
				const childTag = uniqueTag("child");
				const parentTag = uniqueTag("parent");
				const sawTheLabelItJustWrote: Array<boolean> = [];

				customElements.define(
					childTag,
					component(
						function* (componentProps) {
							yield function* () {
								yield html`<b>${componentProps.label}</b>`;
							};
						},
						{ props: { label: prop.attribute(String, "") } },
					),
				);
				customElements.define(
					parentTag,
					component(
						function* (componentProps) {
							yield function* () {
								yield html`<${childTag} label=${componentProps.label}></${childTag}>`;
								if (parksAfterThePaint) yield Promise.resolve();
								const child =
									componentProps.host.shadowRoot!.querySelector(childTag)!;
								sawTheLabelItJustWrote.push(
									visibleText(child.shadowRoot) === componentProps.label,
								);
							};
						},
						{ props: { label: prop.attribute(String, "first") } },
					),
				);
				return {
					parent: mount<HTMLElement & { label: string }>(parentTag),
					sawTheLabelItJustWrote,
				};
			};

			const readBothPaths = async (parksAfterThePaint: boolean) => {
				const { parent, sawTheLabelItJustWrote } =
					mountParentWritingAChild(parksAfterThePaint);
				await sleep(50);
				const [onMount] = sawTheLabelItJustWrote;
				parent.label = "second";
				await sleep(50);
				const [, onUpdate] = sawTheLabelItJustWrote;
				return { onMount, onUpdate };
			};

			test("straight after the paint the child has not painted yet, on a mount as on an update", async () => {
				expect(await readBothPaths(false)).toEqual({
					onMount: false,
					onUpdate: false,
				});
			});

			test("one yield later the child is current, on a mount as on an update", async () => {
				expect(await readBothPaths(true)).toEqual({
					onMount: true,
					onUpdate: true,
				});
			});
		});
	},
);
