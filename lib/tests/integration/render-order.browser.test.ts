import { afterEach, describe, expect, test, vi } from "vitest";
import {
	component,
	html,
	load,
	type BaseComponent,
	type Template,
} from "../../src/index";

//How renders line up across components, however they start: a parent renders before its children
//and each renders once, a frame never shows a value a queued render is about to replace, nothing
//waits on async work it does not own, and the order modules load in changes none of it. Chromium
//only, because a nested component never paints under happy-dom.

describe.skipIf("happyDOM" in globalThis)(
	"render order across components",
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
		//formatting breaks long templates across lines, which puts whitespace into the rendered text
		const visibleText = (node: Node | null) =>
			node?.textContent?.replace(/\s+/g, " ").trim();

		let tagId = 0;
		const uniqueTag = (role: string) =>
			`render-order-${role}-${tagId++}-${Date.now()}`;

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

		describe("a parent renders before its children, and each renders once", () => {
			//no await anywhere: a mount that finished a tick later would let a parent and a child that
			//were dirtied in one task render in the order they were dirtied rather than top down
			test("a three-deep mount finishes inside the append that started it", () => {
				const leafTag = uniqueTag("leaf");
				const middleTag = uniqueTag("middle");
				const rootTag = uniqueTag("root");
				const renders: Array<string> = [];

				customElements.define(
					leafTag,
					component(function* () {
						renders.push("leaf");
						yield () => html`<b>a leaf</b>`;
					}),
				);
				customElements.define(
					middleTag,
					component(function* () {
						renders.push("middle");
						yield () => html`<${leafTag}></${leafTag}>`;
					}),
				);
				customElements.define(
					rootTag,
					component(function* () {
						renders.push("root");
						yield () => html`<${middleTag}></${middleTag}>`;
					}),
				);

				const root = mount<BaseComponent>(rootTag);
				const leaf = root.shadowRoot
					?.querySelector(middleTag)
					?.shadowRoot?.querySelector(leafTag);

				expect(renders).toEqual(["root", "middle", "leaf"]);
				expect(visibleText(leaf?.shadowRoot ?? null)).toBe("a leaf");
			});

			test("a store update that reaches a child first renders the child once, after its parent", async () => {
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
								yield () =>
									html`<ul>
										${store.state.ids.map((id) => html`<li>${id}</li>`)}
									</ul>`;
							};
							return unsubscribe;
						},
						{ props: { selected: String } },
					),
				);
				//subscribes after its first paint, so the store notifies the card before the page
				customElements.define(
					pageTag,
					component(function* ({ host }) {
						yield () =>
							html`<${cardTag} selected=${store.state.ids.at(-1)}></${cardTag}>`;
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

			test("a host binding that writes its host's own prop never renders the host again, on mount or on update", async () => {
				const tag = uniqueTag("user-panel");
				const fetchedUserIds: Array<string | undefined> = [];
				const fetchUser = async (userId: string | undefined) => {
					fetchedUserIds.push(userId);
					await sleep(5);
					return { name: `user ${userId}` };
				};
				const UserPanel = component(
					function* (componentProps) {
						yield async () => {
							const user = await fetchUser(componentProps.userId);
							return html`<template loadCount=${componentProps.loadCount + 1}
								><p>${user.name}</p></template
							>`;
						};
					},
					{ props: { userId: String, loadCount: [Number, 0] } },
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

				userPanel.userId = "8";
				await sleep(50);
				expect(fetchedUserIds).toEqual(["7", "8"]);
				expect(userPanel.loadCount).toBe(2);
				expect(visibleText(userPanel.shadowRoot)).toBe("user 8");
			});
		});

		describe("renders converge before the frame, or fail visibly", () => {
			test("a render that assigns its own prop a new value every time ends in a visible error", async () => {
				const tag = uniqueTag("runaway-label");
				//without a render limit this loop runs through microtasks and freezes the browser the tests run in
				const renderCountAtWhichTheTestEndsTheLoop = 1_000;
				let renderCount = 0;
				customElements.define(
					tag,
					component(
						function* (componentProps) {
							yield () => {
								renderCount++;
								const hasTheTestEndedTheLoop =
									renderCount >= renderCountAtWhichTheTestEndsTheLoop;
								if (!hasTheTestEndedTheLoop)
									componentProps.host.label = `${componentProps.label}!`;
								return html`<p>${componentProps.label}</p>`;
							};
						},
						{ props: { label: [String, ""] } },
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

			test("a render that starts assigning its own prop a new value on update ends in a visible error too", async () => {
				const tag = uniqueTag("runaway-width");
				//without a render limit this loop runs through microtasks and freezes the browser the tests run in
				const renderCountAtWhichTheTestEndsTheLoop = 1_000;
				let renderCount = 0;
				const SizedBox = component(
					function* (componentProps) {
						yield () => {
							renderCount++;
							const width = componentProps.width;
							const hasTheTestEndedTheLoop =
								renderCount >= renderCountAtWhichTheTestEndsTheLoop;
							const shouldAssignAnotherWidth =
								width !== "" && !hasTheTestEndedTheLoop;
							if (shouldAssignAnotherWidth)
								componentProps.host.width = `${width}px`;
							return html`<p>${width}</p>`;
						};
					},
					{ props: { width: [String, ""] } },
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

			test("a write into a component that rendered earlier lands before the frame, without writing any text twice", async () => {
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
						yield () =>
							html`<p>
								${store.state.userName}, ${componentProps.cartCount} items
							</p>`;
						return unsubscribe;
					},
					{ props: { cartCount: [Number, 0] } },
				);
				customElements.define(writtenHeaderTag, WrittenHeader);
				//renders once per publish, so its mutation count is what a single render writes
				customElements.define(
					readingHeaderTag,
					component(function* ({ host }) {
						const unsubscribe = store.subscribe(() => host.update());
						yield () =>
							html`<p>
								${store.state.userName}, ${store.state.cartItems.length} items
							</p>`;
						return unsubscribe;
					}),
				);
				customElements.define(
					checkoutTag,
					component(function* ({ host }) {
						const unsubscribe = store.subscribe(() => host.update());
						yield () => {
							writtenHeader.cartCount = store.state.cartItems.length;
							return html`<ul>
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

			test("children that make their ancestor re-render during its paint settle before the frame", async () => {
				const tabListTag = uniqueTag("tab-list");
				const tabGroupTag = uniqueTag("tab-group");
				const tabItemTag = uniqueTag("tab-item");
				const toastHostTag = uniqueTag("toast-host");
				let toastHostRenders = 0;

				const TabList = component(
					function* (componentProps) {
						componentProps.host.addEventListener("tab-register", () => {
							componentProps.host.tabCount += 1;
						});
						yield () =>
							html`<p>${componentProps.tabCount} tabs</p><${tabGroupTag}></${tabGroupTag}>`;
					},
					{ props: { tabCount: [Number, 0] } },
				);
				customElements.define(tabListTag, TabList);
				customElements.define(
					tabGroupTag,
					component(function* () {
						yield () =>
							html`<${tabItemTag}></${tabItemTag}><${tabItemTag}></${tabItemTag}>`;
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
						yield () => html`<button>tab</button>`;
					}),
				);
				customElements.define(
					toastHostTag,
					component(function* ({ host }) {
						const refresh = () => host.update();
						document.addEventListener("tab-register", refresh);
						yield () => {
							toastHostRenders++;
							return html`<output></output>`;
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
				expect(toastHostRenders).toBe(2);
				expect(await settlesWithin(tabList.update(), 100)).toBe(true);
			});

			//the attribute write lands inside the writer's paint, so the update it triggers carries an
			//exact edge back to the writer. The code after the inner generator's yield runs once that
			//paint has restored the painter, which is where a second update() can erase that edge
			test("a component written into during a paint still waits for that writer when it updates itself too", async () => {
				const renderLog: Array<string> = [];
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
						yield () => {
							renderLog.push("written");
							return html`<b>written</b>`;
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
							yield () => {
								renderLog.push(`writer ${pass}`);
								return html`<${notifierTag} pass=${pass}></${notifierTag}>`;
							};
							if (pass !== 2) return;
							host.update();
							written!.update();
						};
					}),
				);

				const writer = mount<BaseComponent>(writerTag);
				written = mount<BaseComponent>(writtenTag);
				await sleep(50);
				renderLog.length = 0;

				writer.update();
				await nextFrame();

				//the writer is queued and is about to write into it again, so one render is the whole
				//point of the edge
				expect(renderLog).toEqual(["writer 2", "writer 3", "written"]);
			});
		});

		describe("nothing waits on async work it does not own", () => {
			test("await update() covers the synchronous renders below the component at any depth", async () => {
				const leafTag = uniqueTag("leaf");
				const middleTag = uniqueTag("middle");
				const rootTag = uniqueTag("root");
				let label = "one";

				customElements.define(
					leafTag,
					component(
						function* (componentProps) {
							yield () => html`<i>${componentProps.label}</i>`;
						},
						{ props: { label: String } },
					),
				);
				customElements.define(
					middleTag,
					component(
						function* (componentProps) {
							yield () =>
								html`<${leafTag} label=${componentProps.label}></${leafTag}>`;
						},
						{ props: { label: String } },
					),
				);
				const Root = component(function* () {
					yield () => html`<${middleTag} label=${label}></${middleTag}>`;
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

			test("children keep rendering while their parent's async render is pending", async () => {
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
							yield () =>
								html`<li>
									${componentProps.personName} matches ${store.state.query}
								</li>`;
							return unsubscribe;
						},
						{ props: { personName: String } },
					),
				);
				customElements.define(
					resultsTag,
					component(function* ({ host }) {
						const unsubscribe = store.subscribe(() => host.update());
						yield async () => {
							const matches = await searchPeople(store.state.query);
							return html`<ul>
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

			test("a child's async render can await its parent's update", async () => {
				const listTag = uniqueTag("row-list");
				const rowTag = uniqueTag("list-row");
				let listRenders = 0;

				customElements.define(
					listTag,
					component(function* () {
						yield () => {
							listRenders++;
							return html`<${rowTag}></${rowTag}>`;
						};
					}),
				);
				customElements.define(
					rowTag,
					component(function* ({ host }) {
						yield async () => {
							const list = (host.getRootNode() as ShadowRoot)
								.host as BaseComponent;
							await list.update();
							return html`<span>row</span>`;
						};
					}),
				);

				const list = mount(listTag);
				await sleep(50);

				expect(
					visibleText(list.shadowRoot!.querySelector(rowTag)!.shadowRoot),
				).toBe("row");
				expect(listRenders).toBe(2);
			});

			test("a parent's code after its yield can resolve what its child's async render awaits", async () => {
				const pageTag = uniqueTag("chart-page");
				const viewTag = uniqueTag("chart-view");

				customElements.define(
					viewTag,
					component(
						function* (componentProps) {
							yield async () => {
								const points = await componentProps.source;
								return html`<p>${points?.length} points</p>`;
							};
						},
						{
							props: {
								source: (incoming: unknown) =>
									incoming instanceof Promise
										? (incoming as Promise<Array<number>>)
										: undefined,
							},
						},
					),
				);
				customElements.define(
					pageTag,
					component(function* () {
						const sourceReady = Promise.withResolvers<Array<number>>();
						yield () =>
							html`<${viewTag} source=${sourceReady.promise}></${viewTag}>`;
						sourceReady.resolve([1, 2, 3]);
					}),
				);

				const page = mount(pageTag);
				await sleep(50);

				expect(
					visibleText(page.shadowRoot!.querySelector(viewTag)!.shadowRoot),
				).toBe("3 points");
			});

			test("an async child written by two components renders once, and the second writer's await does not wait for it", async () => {
				const pageTag = uniqueTag("editor-page");
				const sliderTag = uniqueTag("zoom-slider");
				const previewTag = uniqueTag("preview-pane");
				const store = createStore({ documentText: "hello", zoomLevel: 1 });
				const previewRenderCalls: Array<string> = [];

				const PreviewPane = component(
					function* (componentProps) {
						yield async () => {
							const { documentText, zoomLevel } = componentProps;
							previewRenderCalls.push(`${documentText} at ${zoomLevel}`);
							await sleep(20);
							return html`<p>${documentText} at ${zoomLevel}</p>`;
						};
					},
					{ props: { documentText: [String, ""], zoomLevel: [Number, 1] } },
				);
				customElements.define(previewTag, PreviewPane);
				const ZoomSlider = component(function* ({ host }) {
					const unsubscribe = store.subscribe(() => host.update());
					yield () => {
						const preview = (host.getRootNode() as ShadowRoot).querySelector(
							previewTag,
						) as InstanceType<typeof PreviewPane>;
						preview.zoomLevel = store.state.zoomLevel;
						return html`<input type="range" value=${store.state.zoomLevel} />`;
					};
					return unsubscribe;
				});
				customElements.define(sliderTag, ZoomSlider);
				customElements.define(
					pageTag,
					component(function* ({ host }) {
						const unsubscribe = store.subscribe(() => host.update());
						yield () =>
							html`<${sliderTag}></${sliderTag}><${previewTag} documentText=${store.state.documentText}></${previewTag}>`;
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
				previewRenderCalls.length = 0;

				store.publish({ documentText: "hello world", zoomLevel: 2 });
				await slider.update();
				expect(previewText()).toBe("hello at 1");

				await sleep(50);
				expect(previewRenderCalls).toEqual(["hello world at 2"]);
				expect(previewText()).toBe("hello world at 2");
			});

			test("a parent's await covers its child's synchronous render but not the child's async load", async () => {
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
							yield () => html`<p>loading…</p>`;
							const user = (yield load(componentProps.host, () =>
								fetchUser(userId),
							)) as { name: string };
							yield () => html`<h2>${user.name}</h2>`;
						};
					},
					{ props: { userId: [Number, 0] } },
				);
				customElements.define(profileTag, UserProfile);
				let selectedUserId = 7;
				const ProfilePage = component(function* () {
					yield () =>
						html`<${profileTag} userId=${selectedUserId}></${profileTag}>`;
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

			const userNameComponent = (renderLog: Array<string>) =>
				component(
					function* (componentProps) {
						yield () => {
							renderLog.push("name");
							return html`<b>${componentProps.displayName}</b>`;
						};
					},
					{ props: { displayName: String } },
				);
			const userAvatarComponent = (renderLog: Array<string>) =>
				component(
					function* (componentProps) {
						yield () => {
							renderLog.push("avatar");
							return html`<img alt=${componentProps.user?.name} />`;
						};
					},
					{
						props: {
							user: (incoming: unknown) =>
								typeof incoming === "object" && incoming !== null
									? (incoming as User)
									: undefined,
						},
					},
				);
			const userBadgeComponent = (renderLog: Array<string>) =>
				component(function* () {
					yield () => {
						renderLog.push("badge");
						return html`<i>badge</i>`;
					};
				});
			const userPageComponent = (
				renderLog: Array<string>,
				renderChildren: (user: User) => Template,
			) =>
				component(function* () {
					const user = { name: "Ada" };
					yield () => {
						renderLog.push("page");
						return renderChildren(user);
					};
				});

			let userPageServerMarkup: Promise<string> | null = null;
			const renderUserPageOnServer = () =>
				(userPageServerMarkup ??= renderOnServer("order-server-page", () => {
					const serverRenderLog: Array<string> = [];
					customElements.define(
						"order-server-name",
						userNameComponent(serverRenderLog),
					);
					customElements.define(
						"order-server-avatar",
						userAvatarComponent(serverRenderLog),
					);
					customElements.define(
						"order-server-badge",
						userBadgeComponent(serverRenderLog),
					);
					customElements.define(
						"order-server-page",
						userPageComponent(
							serverRenderLog,
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
					renderChildren: (user: User) =>
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
					renderChildren: (user: User) =>
						html`<order-page-first-name
								displayName=${user.name}
							></order-page-first-name
							><order-page-first-avatar user=${user}></order-page-first-avatar
							><order-page-first-badge></order-page-first-badge>`,
				},
			])(
				"a hydrated page renders before its children when they update together, loading $loadOrder",
				async ({ tagPrefix, definitionOrder, renderChildren }) => {
					const renderLog: Array<string> = [];
					const definitions: Record<Role, CustomElementConstructor> = {
						name: userNameComponent(renderLog),
						avatar: userAvatarComponent(renderLog),
						badge: userBadgeComponent(renderLog),
						page: userPageComponent(renderLog, renderChildren),
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

					renderLog.length = 0;
					for (const child of serverRenderedChildren as Array<BaseComponent>)
						child.update();
					await page.update();
					await sleep();

					expect(renderLog[0]).toBe("page");
					expect(renderLog.toSorted()).toEqual([
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
							yield () =>
								html`<button onClick=${buy}>Buy ${componentProps.sku}</button>`;
						},
						{ props: { sku: String } },
					);
				const productPageComponent = (renderContent: () => Template) =>
					component(function* () {
						yield () => renderContent();
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
			//before: what it may never show is the render this paint just asked for
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
								yield () => html`<b>${componentProps.text}</b>`;
							},
							{ props: { text: [String, ""] } },
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
			//number of times a run is passed over is its own depth. Only a render may count as one
			test("a chain deeper than the render limit renders top down, once per component", async () => {
				const depth = 140;
				const tag = uniqueTag("deep-chain");
				const store = createStorePublishingDeepestFirst({ label: "before" });
				const renderedLevels: Array<number> = [];

				customElements.define(
					tag,
					component(
						function* (componentProps) {
							const unsubscribe = store.subscribe(() =>
								componentProps.host.update(),
							);
							const level = componentProps.level;
							yield () => {
								renderedLevels.push(level);
								return level < depth
									? html`<${tag} level=${level + 1}></${tag}>`
									: html`<b>${store.state.label}</b>`;
							};
							return unsubscribe;
						},
						{ props: { level: [Number, 0] } },
					),
				);

				let deepest = mount(tag);
				await sleep(100);
				while (deepest.shadowRoot!.querySelector(tag))
					deepest = deepest.shadowRoot!.querySelector(tag)!;
				renderedLevels.length = 0;

				store.publish({ label: "after" });
				await nextFrame();

				expect(visibleText(deepest.shadowRoot)).toBe("after");
				expect(renderedLevels).toEqual(
					Array.from({ length: depth + 1 }, (_, level) => level),
				);
			});

			//a component only ever paints into its own shadow root, so the one way a paint reaches a
			//component beside it is a plain element's setter on the property channel
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
								yield () =>
									html`<${relayTag} partner=${partnerName} carried=${{ count: componentProps.count }}></${relayTag}>`;
							},
							{ props: { count: [Number, 0] } },
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
				//a ring of writers trips the runaway limit, not the sweep: one of the two keeps rendering,
				//so the pass never goes all the way round without a render
				expect(shownText).toContain("rendered too often");
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
				const bystanderRenders: Array<string> = [];
				let thePageShouldFail = false;

				customElements.define(
					childTag,
					component(function* () {
						yield () => html`<b>a child</b>`;
					}),
				);
				customElements.define(
					pageTag,
					component(function* () {
						yield () => {
							if (thePageShouldFail) throw new Error("the page failed");
							return html`<${childTag}></${childTag}>`;
						};
					}),
				);
				customElements.define(
					bystanderTag,
					component(
						function* (componentProps) {
							yield () => {
								bystanderRenders.push(componentProps.label);
								return html`<b>${componentProps.label}</b>`;
							};
						},
						{ props: { label: [String, "first"] } },
					),
				);

				const page = mount<BaseComponent>(pageTag);
				const bystander = mount<BaseComponent & { label: string }>(
					bystanderTag,
				);
				await sleep(50);
				const child = page.shadowRoot!.querySelector(childTag) as BaseComponent;
				bystanderRenders.length = 0;
				thePageShouldFail = true;

				const consoleError = vi
					.spyOn(console, "error")
					.mockImplementation(() => {});
				//the child is queued first and has to wait for the page, which never renders again
				const childSettled = child.update();
				page.update();
				bystander.label = "second";
				await nextFrame();
				consoleError.mockRestore();

				expect(visibleText(page.shadowRoot)).toContain("the page failed");
				expect(await settlesWithin(childSettled, 200)).toBe(true);
				expect(bystanderRenders).toEqual(["second"]);
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

				const rerenderOnRegistration = (host: BaseComponent) =>
					host.addEventListener("registered", () => {
						host.update();
					});

				customElements.define(
					childTag,
					component(function* ({ host }) {
						rerenderOnRegistration(host);
						yield () => html`<${registrarTag}></${registrarTag}>`;
					}),
				);
				customElements.define(
					parentTag,
					component(function* ({ host }) {
						rerenderOnRegistration(host);
						yield () => html`<${childTag}></${childTag}>`;
					}),
				);

				const consoleError = vi
					.spyOn(console, "error")
					.mockImplementation(() => {});
				const parent = mount(parentTag);
				await sleep(100);
				const loggedErrors = consoleError.mock.calls.map((call) => call.join(" "));
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
			test("a grandchild renders once when the component between it and the store does not subscribe", async () => {
				const leafTag = uniqueTag("leaf");
				const layoutTag = uniqueTag("layout");
				const pageTag = uniqueTag("page");
				const store = createStorePublishingDeepestFirst({ heading: "before" });
				const leafRenders: Array<string> = [];

				customElements.define(
					leafTag,
					component(
						function* (componentProps) {
							const unsubscribe = store.subscribe(() =>
								componentProps.host.update(),
							);
							yield () => {
								leafRenders.push(componentProps.heading);
								return html`<b>${componentProps.heading}</b>`;
							};
							return unsubscribe;
						},
						{ props: { heading: [String, ""] } },
					),
				);
				customElements.define(
					layoutTag,
					component(
						function* (componentProps) {
							yield () =>
								html`<${leafTag} heading=${componentProps.heading}></${leafTag}>`;
						},
						{ props: { heading: [String, ""] } },
					),
				);
				customElements.define(
					pageTag,
					component(function* (componentProps) {
						const unsubscribe = store.subscribe(() =>
							componentProps.host.update(),
						);
						yield () =>
							html`<${layoutTag} heading=${store.state.heading}></${layoutTag}>`;
						return unsubscribe;
					}),
				);

				const page = mount(pageTag);
				await sleep(100);
				const leaf = page
					.shadowRoot!.querySelector(layoutTag)!
					.shadowRoot!.querySelector(leafTag)!;
				leafRenders.length = 0;

				store.publish({ heading: "after" });
				await nextFrame();
				expect(leafRenders).toEqual(["after"]);
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
			theChildRendersAsync: boolean,
		) =>
			customElements.define(
				childTag,
				component(
					function* (componentProps) {
						yield theChildRendersAsync
							? async () => {
									await sleep();
									return html`<b>${componentProps.label}</b>`;
								}
							: () => html`<b>${componentProps.label}</b>`;
					},
					{ props: { label: [String, ""] } },
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
							{ props: { label: [String, "first"] } },
						),
					),
			},
			{
				shape: "a render function yielded from the body",
				readsAgainOnUpdate: false,
				defineParent: (parentTag, childTag, readsAfterThePaint) =>
					customElements.define(
						parentTag,
						component(
							function* (componentProps) {
								yield () =>
									html`<${childTag} label=${componentProps.label}></${childTag}>`;
								readsAfterThePaint.push(
									sawTheLabelItJustWrote(childTag, componentProps),
								);
							},
							{ props: { label: [String, "first"] } },
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
							{ props: { label: [String, "first"] } },
						),
					),
			},
			{
				shape: "an async inner generator, reading after its own yield",
				readsAgainOnUpdate: true,
				defineParent: (parentTag, childTag, readsAfterThePaint) =>
					customElements.define(
						parentTag,
						component(
							function* (componentProps) {
								yield async function* () {
									yield html`<${childTag} label=${componentProps.label}></${childTag}>`;
									readsAfterThePaint.push(
										sawTheLabelItJustWrote(childTag, componentProps),
									);
								};
							},
							{ props: { label: [String, "first"] } },
						),
					),
			},
			{
				shape: "an async component body",
				readsAgainOnUpdate: false,
				defineParent: (parentTag, childTag, readsAfterThePaint) =>
					customElements.define(
						parentTag,
						component(
							async function* (componentProps) {
								yield html`<${childTag} label=${componentProps.label}></${childTag}>`;
								readsAfterThePaint.push(
									sawTheLabelItJustWrote(childTag, componentProps),
								);
							},
							{ props: { label: [String, "first"] } },
						),
					),
			},
			{
				shape: "a render function that returns an inner generator",
				readsAgainOnUpdate: true,
				defineParent: (parentTag, childTag, readsAfterThePaint) =>
					customElements.define(
						parentTag,
						component(
							function* (componentProps) {
								yield () =>
									function* () {
										yield html`<${childTag} label=${componentProps.label}></${childTag}>`;
										readsAfterThePaint.push(
											sawTheLabelItJustWrote(childTag, componentProps),
										);
									};
							},
							{ props: { label: [String, "first"] } },
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
							{ props: { label: [String, "first"] } },
						),
					),
			},
			{
				shape: "an inner generator that parked, read after it",
				readsAgainOnUpdate: false,
				defineParent: (parentTag, childTag, readsAfterThePaint) =>
					customElements.define(
						parentTag,
						component(
							function* (componentProps) {
								yield function* () {
									yield html`<${childTag} label=${componentProps.label}></${childTag}>`;
									yield Promise.resolve();
								};
								readsAfterThePaint.push(
									sawTheLabelItJustWrote(childTag, componentProps),
								);
							},
							{ props: { label: [String, "first"] } },
						),
					),
			},
		];

		test.each(parentShapes)(
			"post-paint code does not see the child it just wrote, from $shape",
			async ({ readsAgainOnUpdate, defineParent }) => {
				for (const theChildRendersAsync of [false, true]) {
					const childTag = uniqueTag("child");
					const parentTag = uniqueTag("parent");
					const readsAfterThePaint: Array<boolean> = [];
					defineLabelledChild(childTag, theChildRendersAsync);
					defineParent(parentTag, childTag, readsAfterThePaint);

					const parent = mount<HTMLElement & { label: string }>(parentTag);
					await sleep(50);
					parent.label = "second";
					await sleep(50);

					expect({ theChildRendersAsync, readsAfterThePaint }).toEqual({
						theChildRendersAsync,
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
					{ props: { label: [String, "first"] } },
				),
			);

		const readAtBothMountSites = async (
			whatItMounts: WhatToMountAfterThePaint,
		) => {
			const otherComponentTag = uniqueTag("other");
			customElements.define(
				otherComponentTag,
				component(function* () {
					yield () => html`<i>other</i>`;
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
						yield () =>
							html`<${nestedParentTag} label=${componentProps.label}></${nestedParentTag}>`;
					},
					{ props: { label: [String, "first"] } },
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

		//the case this whole render order came from: a list that keeps one row and adds two. Every
		//row has to read as "has not rendered", the kept one by showing its old text and the new ones
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
						yield () => html`<b>${componentProps.entry}</b>`;
					},
					{ props: { entry: [String, ""] } },
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
					{ props: { entries: [String, "a"] } },
				),
			);

			const list = mount<HTMLElement & { entries: string }>(listTag);
			await sleep(50);
			list.entries = "a,b,c";
			await sleep(50);

			expect(rowTextsAfterThePaint).toEqual([[""], ["a", "", ""]]);
			expect(rowTexts(list)).toEqual(["a", "b", "c"]);
		});
		//queued renders there. A yield lets the queue drain, on every path into a render

		//"above" means "whose shadow tree contains this element", which is neither the document order
		//nor the nesting a reader sees in the markup
		describe("what a run waits for is what is above it in the shadow trees", () => {
			const defineLoggingComponent = (
				tag: string,
				role: string,
				renderLog: Array<string>,
				renderContent: () => Template,
			) =>
				customElements.define(
					tag,
					component(function* () {
						yield () => {
							renderLog.push(role);
							return renderContent();
						};
					}),
				);

			test("a slotted component does not wait for the component that slots it, and unrelated components render in the order they were dirtied", async () => {
				const renderLog: Array<string> = [];
				const earlierTag = uniqueTag("earlier");
				const laterTag = uniqueTag("later");
				const frameTag = uniqueTag("frame");
				const shadowChildTag = uniqueTag("shadow-child");
				const slottedTag = uniqueTag("slotted");

				defineLoggingComponent(
					earlierTag,
					"earlier",
					renderLog,
					() => html`<b>earlier</b>`,
				);
				defineLoggingComponent(
					laterTag,
					"later",
					renderLog,
					() => html`<b>later</b>`,
				);
				defineLoggingComponent(
					shadowChildTag,
					"shadow child",
					renderLog,
					() => html`<b>in the shadow tree</b>`,
				);
				defineLoggingComponent(
					slottedTag,
					"slotted",
					renderLog,
					() => html`<b>slotted</b>`,
				);
				defineLoggingComponent(
					frameTag,
					"frame",
					renderLog,
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
				renderLog.length = 0;

				later.update();
				earlier.update();
				shadowChild.update();
				slotted.update();
				frame.update();
				await nextFrame();

				//the slotted component sits inside the frame in the markup and still renders before it:
				//the frame's shadow tree does not contain it, so nothing about the frame can reach it
				expect(renderLog).toEqual([
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
				const renderLog: Array<string> = [];
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
					renderLog,
					() => html`<b>leaf</b>`,
				);
				defineLoggingComponent(
					outerTag,
					"outer",
					renderLog,
					() => html`<${foreignTag}></${foreignTag}>`,
				);

				const outer = mount<BaseComponent>(outerTag);
				await sleep(50);
				const foreign = outer.shadowRoot!.querySelector(foreignTag)!;
				const leaf = foreign.shadowRoot!.querySelector(
					leafTag,
				) as BaseComponent;
				renderLog.length = 0;

				//dirtied leaf first and from outside any paint, so the causal edge is empty and the
				//shadow trees are the only thing that can order these two
				leaf.update();
				outer.update();
				await nextFrame();

				expect(renderLog).toEqual(["outer", "leaf"]);
			});

			test("a queued component moved into another shadow tree renders once, with the value it was given", async () => {
				const travellerTag = uniqueTag("traveller");
				const departureTag = uniqueTag("departure");
				const arrivalTag = uniqueTag("arrival");
				const travellerRenders: Array<string> = [];

				customElements.define(
					travellerTag,
					component(
						function* (componentProps) {
							yield () => {
								travellerRenders.push(componentProps.value);
								return html`<b>${componentProps.value}</b>`;
							};
						},
						{ props: { value: [String, ""] } },
					),
				);
				customElements.define(
					departureTag,
					component(function* () {
						yield () =>
							html`<div><${travellerTag} value="first"></${travellerTag}></div>`;
					}),
				);
				customElements.define(
					arrivalTag,
					component(function* () {
						yield () => html`<div></div>`;
					}),
				);

				const departure = mount(departureTag);
				const arrival = mount(arrivalTag);
				await sleep(50);
				const traveller = departure.shadowRoot!.querySelector(
					travellerTag,
				) as BaseComponent & { value: string };
				travellerRenders.length = 0;

				traveller.value = "second";
				arrival.shadowRoot!.querySelector("div")!.append(traveller);
				await nextFrame();

				expect(travellerRenders).toEqual(["second"]);
				expect(visibleText(traveller.shadowRoot)).toBe("second");
				expect(traveller.getRootNode()).toBe(arrival.shadowRoot);
			});

			//the phase is read at the drain and not at the enqueue, so a host that left the document in
			//between is dropped rather than rendered into a detached root
			test("a host removed before the pass reaches it does not render, and its update still settles", async () => {
				const tag = uniqueTag("leaving");
				const renders: Array<string> = [];

				customElements.define(
					tag,
					component(
						function* (componentProps) {
							yield () => {
								renders.push(componentProps.label);
								return html`<b>${componentProps.label}</b>`;
							};
						},
						{ props: { label: [String, "first"] } },
					),
				);

				const element = mount<BaseComponent & { label: string }>(tag);
				await sleep(50);
				renders.length = 0;

				element.label = "second";
				const settled = element.update();
				element.remove();

				expect(await settlesWithin(settled, 200)).toBe(true);
				expect(renders).toEqual([]);
			});

			//the other phase a run can be dropped in at the drain: it was queued while it was ready to
			//start, and the mark its parent owes it arrived before the pass got to it
			test("a child marked after it connected is dropped from the pass, and renders when the mark comes off", async () => {
				const parentTag = uniqueTag("owing");
				const childTag = uniqueTag("owed");
				const renders: Array<string> = [];

				defineLoggingComponent(
					childTag,
					"child",
					renders,
					() => html`<b>child</b>`,
				);
				customElements.define(
					parentTag,
					component(function* ({ host }) {
						yield () => html`<${childTag}></${childTag}>`;
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

				expect(renders).toEqual([]);

				child.removeAttribute("defer-hydration");
				await sleep(50);

				expect(renders).toEqual(["child"]);
			});

			//a template yielded straight from the component body leaves nothing in the rerender slot, so
			//update() has nothing to re-fire and no reason to take a place in the queue
			test("a component with nothing to rerun does not delay a component inside it", async () => {
				const renderLog: Array<string> = [];
				const holderTag = uniqueTag("holder");
				const insideTag = uniqueTag("inside");
				const besideTag = uniqueTag("beside");

				defineLoggingComponent(
					insideTag,
					"inside",
					renderLog,
					() => html`<b>inside</b>`,
				);
				defineLoggingComponent(
					besideTag,
					"beside",
					renderLog,
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
				renderLog.length = 0;

				inside.update();
				beside.update();
				holder.update();
				await nextFrame();

				//dirtied first and never blocked: a queued holder would have passed it over for a trip
				expect(renderLog).toEqual(["inside", "beside"]);
			});
		});
		describe("post-paint code reads the same DOM however the render started", () => {
			const mountParentWritingAChild = (parksAfterThePaint: boolean) => {
				const childTag = uniqueTag("child");
				const parentTag = uniqueTag("parent");
				const sawTheLabelItJustWrote: Array<boolean> = [];

				customElements.define(
					childTag,
					component(
						function* (componentProps) {
							yield () => html`<b>${componentProps.label}</b>`;
						},
						{ props: { label: [String, ""] } },
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
						{ props: { label: [String, "first"] } },
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

			test("straight after the paint the child has not rendered yet, on a mount as on an update", async () => {
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
