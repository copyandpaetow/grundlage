import { inspect } from "node:util";
import { parentPort } from "node:worker_threads";
import { HTMLSerializer, Window } from "happy-dom";
import type { HotPayload } from "vite";
import { createNodeImportMeta, ESModulesEvaluator, ModuleRunner } from "vite/module-runner";
//with extensions: the tests start this worker from its TypeScript source, which node resolves
//without a bundler
import {
	choosePrerenderRoots,
	type CustomElementRecord,
	parseAttributes,
	PRERENDER_ATTRIBUTE,
	PRERENDER_CHOICE,
	prerenderChoiceOfValue,
} from "./scan.ts";
import { openRealmChannel } from "./ssr-render.channel.ts";

//the page as the main thread scanned it, with the modules its scripts import
export interface PageRenderRequest {
	environmentId: number;
	moduleUrls: Array<string>;
	html: string;
	elements: Array<CustomElementRecord>;
	pendingTaskTimeoutMs: number | undefined;
}

export interface InvokeRequest {
	environmentId: number;
	payload: HotPayload;
}

type InvokeReply = { result: unknown } | { error: unknown };

export interface ConsoleNotice {
	level: "warn" | "error";
	args: Array<unknown>;
}

const TAG_SUPPORT = {
	UNDEFINED: 0,
	CONSTRUCTOR_THREW: 1,
	CLOSED_ROOT: 2,
	NO_SERIALIZABLE_ROOT: 3,
	PRERENDERABLE: 4,
} as const;
type TagSupportKind = (typeof TAG_SUPPORT)[keyof typeof TAG_SUPPORT];
type UnprerenderableTagSupportKind = Exclude<TagSupportKind, typeof TAG_SUPPORT.PRERENDERABLE>;

interface EnvironmentLoader {
	runner: ModuleRunner;
	moduleLoadAttempts: Map<string, Promise<void>>;
}

interface ServerRealm {
	window: Window;
	loaders: Map<number, EnvironmentLoader>;
	//defined tags only: a tag still undefined may be defined by the next page's modules
	tagSupport: Map<string, TagSupportKind>;
	//once per realm, so in dev a warning comes back after every edit that leaves the cause in place
	reportedTags: Set<string>;
}

type RealmHTMLSerializerClass = new (options: { shadowRoots: Array<ShadowRoot> }) => {
	serializeToString(node: Node): string;
};

//happy-dom's own classes are the DOM the realm installs, which this module types by lib.dom
const RealmHTMLSerializer = HTMLSerializer as unknown as RealmHTMLSerializerClass;

//happy-dom's Window is a separate realm: its Array/Object/Error/Promise are
//distinct constructors, so replacing the global ones would break cross-realm
//`instanceof`. The language fixes this set; every web API sits outside it and is
//exposed automatically, so new APIs never need adding here.
const ecmascriptIntrinsics = new Set([
	"Object",
	"Function",
	"Array",
	"Number",
	"Boolean",
	"String",
	"Symbol",
	"BigInt",
	"Math",
	"JSON",
	"Date",
	"RegExp",
	"Promise",
	"Proxy",
	"Reflect",
	"Intl",
	"Error",
	"EvalError",
	"RangeError",
	"ReferenceError",
	"SyntaxError",
	"TypeError",
	"URIError",
	"AggregateError",
	"Map",
	"Set",
	"WeakMap",
	"WeakSet",
	"WeakRef",
	"FinalizationRegistry",
	"ArrayBuffer",
	"SharedArrayBuffer",
	"DataView",
	"Atomics",
	"Int8Array",
	"Uint8Array",
	"Uint8ClampedArray",
	"Int16Array",
	"Uint16Array",
	"Int32Array",
	"Uint32Array",
	"Float32Array",
	"Float64Array",
	"BigInt64Array",
	"BigUint64Array",
	"eval",
	"isFinite",
	"isNaN",
	"parseFloat",
	"parseInt",
	"decodeURI",
	"decodeURIComponent",
	"encodeURI",
	"encodeURIComponent",
	"escape",
	"unescape",
]);

const nodeRuntimeGlobals = new Set([
	"setTimeout",
	"clearTimeout",
	"setInterval",
	"clearInterval",
	"queueMicrotask",
	"console",
]);

const realmSelfReferences = new Set([
	"window",
	"self",
	"globalThis",
	"top",
	"parent",
	"frames",
	"global",
]);

//one realm per worker: a tag can be defined only once per realm
let currentRealm: ServerRealm | null = null;

//happy-dom neither exposes closed roots via internals nor serializes them, so we
//record them at attach time: enough to detect and skip, not to prerender
const hostsWithClosedRoot = new WeakSet<object>();

//happy-dom reads `delegateFocus` for `delegatesFocus`, and this realm turns `clonable` off: a root
//misreports both, so the declarative template takes them from the init its component passed
const requestedInitOfShadowRoot = new WeakMap<ShadowRoot, ShadowRootInit>();

//happy-dom upgrades the elements inside <template> content, and its clone of one with a clonable
//root replaces the root the clone's constructor attached: a nested component would paint unseen
const wrapAttachShadow = (): void => {
	const elementPrototype = (
		globalThis as unknown as {
			HTMLElement: { prototype: Record<string, unknown> };
		}
	).HTMLElement.prototype;
	const attachShadow = elementPrototype.attachShadow as (init: ShadowRootInit) => ShadowRoot;
	elementPrototype.attachShadow = function (this: object, init: ShadowRootInit) {
		if (init?.mode === "closed") hostsWithClosedRoot.add(this);
		const shadowRoot = attachShadow.call(this, { ...init, clonable: false });
		requestedInitOfShadowRoot.set(shadowRoot, init);
		return shadowRoot;
	};
};

//exposes happy-dom's entire DOM surface on the worker's globals, then forces server mode via the
//library's own __grundlage_ssr__ switch; `window` is left unset so `typeof window` stays "undefined"
const installRealmGlobals = (window: Window): void => {
	//a cast to read the window's properties by name, which its class type does not index
	const windowProperties = window as unknown as Record<string, unknown>;
	for (const name of Object.getOwnPropertyNames(windowProperties)) {
		if (
			realmSelfReferences.has(name) ||
			ecmascriptIntrinsics.has(name) ||
			nodeRuntimeGlobals.has(name)
		) {
			continue;
		}
		const existing = Object.getOwnPropertyDescriptor(globalThis, name);
		if (existing && !existing.writable && !existing.configurable) continue;
		Object.defineProperty(globalThis, name, {
			value: windowProperties[name],
			writable: true,
			enumerable: false,
			configurable: true,
		});
	}
	(globalThis as { __grundlage_ssr__?: boolean }).__grundlage_ssr__ = true;
	wrapAttachShadow();
};

const createServerRealm = (): ServerRealm => {
	const window = new Window();
	installRealmGlobals(window);
	return {
		window,
		loaders: new Map(),
		tagSupport: new Map(),
		reportedTags: new Set(),
	};
};

const closeRealm = async (realm: ServerRealm): Promise<void> => {
	for (const loader of realm.loaders.values()) await loader.runner.close();
	await realm.window.happyDOM.close();
};

//an edit can change any module a component imports, and a defined tag cannot take its new version:
//the next page starts from a realm where nothing is defined yet
const closeCurrentRealm = async (): Promise<void> => {
	const staleRealm = currentRealm;
	currentRealm = null;
	if (staleRealm !== null) await closeRealm(staleRealm);
};

//vite transforms each module on the main thread, in the environment the page came from
const loaderOf = (realm: ServerRealm, environmentId: number): EnvironmentLoader => {
	const existing = realm.loaders.get(environmentId);
	if (existing !== undefined) return existing;
	const created: EnvironmentLoader = {
		runner: new ModuleRunner(
			{
				transport: {
					invoke: (payload) =>
						//oxlint-disable-next-line no-use-before-define -- mutual recursion: a page's modules come through the channel that delivered the page
						channel.request("invoke", {
							environmentId,
							payload,
						} satisfies InvokeRequest) as Promise<InvokeReply>,
				},
				hmr: false,
				createImportMeta: createNodeImportMeta,
			},
			new ESModulesEvaluator(),
		),
		moduleLoadAttempts: new Map(),
	};
	realm.loaders.set(environmentId, created);
	return created;
};

const importOnce = (loader: EnvironmentLoader, moduleUrl: string): Promise<void> => {
	const attempted = loader.moduleLoadAttempts.get(moduleUrl);
	if (attempted) return attempted;
	const attempt = loader.runner.import(moduleUrl).then(
		() => undefined,
		(error: unknown) => {
			console.warn(
				`[prerender] could not load ${moduleUrl}: any component it defines is left for the browser.`,
				error,
			);
		},
	);
	loader.moduleLoadAttempts.set(moduleUrl, attempt);
	return attempt;
};

//one module at a time and in page order, so module side effects run in the same order on every
//machine
const loadPageModules = async (
	realm: ServerRealm,
	environmentId: number,
	moduleUrls: Array<string>,
): Promise<void> => {
	const loader = loaderOf(realm, environmentId);
	for (const moduleUrl of moduleUrls) await importOnce(loader, moduleUrl);
};

//decided on a constructed element that never connects, so a component that cannot be prerendered
//runs no more of its code than its constructor
const classifyTag = (tagName: string): TagSupportKind => {
	if (customElements.get(tagName) === undefined) return TAG_SUPPORT.UNDEFINED;
	let host: HTMLElement;
	try {
		host = document.createElement(tagName);
	} catch {
		return TAG_SUPPORT.CONSTRUCTOR_THREW;
	}
	if (hostsWithClosedRoot.has(host)) return TAG_SUPPORT.CLOSED_ROOT;
	return host.shadowRoot?.serializable === true
		? TAG_SUPPORT.PRERENDERABLE
		: TAG_SUPPORT.NO_SERIALIZABLE_ROOT;
};

const tagSupportOf = (realm: ServerRealm, tagName: string): TagSupportKind => {
	const known = realm.tagSupport.get(tagName);
	if (known !== undefined) return known;
	const support = classifyTag(tagName);
	if (support !== TAG_SUPPORT.UNDEFINED) realm.tagSupport.set(tagName, support);
	return support;
};

const warningFor = (tagName: string, support: UnprerenderableTagSupportKind): string => {
	switch (support) {
		case TAG_SUPPORT.UNDEFINED:
			return `[prerender] no module the page imports defines <${tagName}>, so it is left for the browser. If the page script defines it, move the definition into a module the page imports: a page script's own body never runs on the server.`;
		case TAG_SUPPORT.CONSTRUCTOR_THREW:
			return `[prerender] <${tagName}> threw while being constructed, so it is left for the browser.`;
		case TAG_SUPPORT.CLOSED_ROOT:
			return `[prerender] <${tagName}> uses a closed shadow root, which happy-dom cannot serialize, so it is left for the browser.`;
		case TAG_SUPPORT.NO_SERIALIZABLE_ROOT:
			return `[prerender] <${tagName}> has no serializable shadow root when constructed, so it is left for the browser.`;
		default:
			return support satisfies never;
	}
};

//an element that only inherits `ssr` stays quiet on a root that is not serializable: that is the
//root every foreign web component has, and a page full of them is no mistake
const reportUnprerenderableElements = (
	realm: ServerRealm,
	elements: ReadonlyArray<CustomElementRecord>,
): void => {
	for (const element of elements) {
		const isPrerendered = element.prerenderChoice === PRERENDER_CHOICE.ON;
		if (!isPrerendered || realm.reportedTags.has(element.tagName)) continue;
		const support = tagSupportOf(realm, element.tagName);
		if (support === TAG_SUPPORT.PRERENDERABLE) continue;
		const isQuietFallback =
			support === TAG_SUPPORT.NO_SERIALIZABLE_ROOT && !element.hasOwnPrerenderAttribute;
		if (isQuietFallback) continue;
		realm.reportedTags.add(element.tagName);
		console.warn(warningFor(element.tagName, support));
	}
};

//dispatched composed by the library's fatal path on the host that threw, so it reaches the render
//container from any depth of shadow trees
const COMPONENT_ERROR_EVENT_NAME = "grundlage-error";

//dispatched composed and cancelable by the library on a host about to run on the server
const COMPONENT_RENDER_EVENT_NAME = "grundlage-render";

//the webcomponents-cg pending-task protocol, read by shape: a component of any library can announce
//that it is waiting
const PENDING_TASK_EVENT_NAME = "pending-task";

interface PendingTaskEventShape extends Event {
	readonly complete: Promise<unknown>;
}

interface PendingTask {
	host: EventTarget;
	complete: Promise<unknown>;
}

const nextMacrotask = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

//a settled task lets its component paint, and a child that paint mounts can announce a task of its
//own, so the wait ends once every task announced so far has settled. Another library may announce
//that child's task after a few microtasks, which the macrotask between the checks lets through
const waitForPendingTasks = async (
	unsettledTasks: ReadonlySet<PendingTask>,
	timeoutMs: number,
): Promise<void> => {
	let hasTimedOut = false;
	const timeout = Promise.withResolvers<void>();
	const timer = setTimeout(() => {
		hasTimedOut = true;
		timeout.resolve();
	}, timeoutMs);
	while (unsettledTasks.size > 0 && !hasTimedOut) {
		const completions = [...unsettledTasks].map((task) => task.complete);
		await Promise.race([Promise.allSettled(completions), timeout.promise]);
		await nextMacrotask();
	}
	clearTimeout(timer);
};

const hasUnsettledTask = (unsettledTasks: ReadonlySet<PendingTask>, host: EventTarget): boolean => {
	for (const task of unsettledTasks) if (task.host === host) return true;
	return false;
};

const parentAcrossShadowRootsOf = (element: Element): Element | null => {
	const parent = element.parentNode;
	if (parent instanceof ShadowRoot) return parent.host;
	return parent instanceof Element ? parent : null;
};

//the nearest `ssr` decides, across shadow roots too; with none, the element belongs to a root the
//page chose to prerender
const isLeftForTheBrowser = (element: Element): boolean => {
	for (
		let current: Element | null = element;
		current !== null;
		current = parentAcrossShadowRootsOf(current)
	) {
		const choice = prerenderChoiceOfValue(
			current.localName,
			current.getAttribute(PRERENDER_ATTRIBUTE),
		);
		if (choice !== PRERENDER_CHOICE.INHERIT) return choice === PRERENDER_CHOICE.OFF;
	}
	return false;
};

//a root under ssr="false" (of any library), an empty one (still waiting) and a thrower's mount fresh
//on the client, where a declarative root would be hydrated as if the server had painted it
const shadowRootsToSerialize = (
	renderContainer: Element,
	hostsThatThrew: ReadonlySet<EventTarget>,
): Array<ShadowRoot> => {
	const shadowRoots: Array<ShadowRoot> = [];
	//each shadow root is pushed once, by its own host, so the search ends with the render's elements
	const treesToSearch: Array<Element | ShadowRoot> = [renderContainer];
	for (let tree = treesToSearch.pop(); tree !== undefined; tree = treesToSearch.pop()) {
		const elements = tree.querySelectorAll("*");
		for (let index = 0; index < elements.length; index++) {
			const shadowRoot = elements[index].shadowRoot;
			const shipsShadowRoot =
				shadowRoot !== null &&
				shadowRoot.serializable &&
				shadowRoot.childNodes.length > 0 &&
				!hostsThatThrew.has(elements[index]) &&
				!isLeftForTheBrowser(elements[index]);
			if (!shipsShadowRoot) continue;
			shadowRoots.push(shadowRoot);
			treesToSearch.push(shadowRoot);
		}
	}
	return shadowRoots;
};

//an attribute value cannot hold this, its quotes are escaped: the first match in a host's markup is
//the template of the host's own root
const DECLARATIVE_SHADOW_ROOT_START_TAG = /<template shadowrootmode="[^"]*"[^>]*>/;

const declarativeShadowRootStartTagOf = (shadowRoot: ShadowRoot): string => {
	const requestedInit = requestedInitOfShadowRoot.get(shadowRoot);
	let startTag = `<template shadowrootmode="${shadowRoot.mode}"`;
	if (requestedInit?.delegatesFocus) startTag += ` shadowrootdelegatesfocus=""`;
	if (shadowRoot.serializable) startTag += ` shadowrootserializable=""`;
	if (requestedInit?.clonable) startTag += ` shadowrootclonable=""`;
	return `${startTag}>`;
};

//happy-dom writes only a root's mode and serializable flag, and the browser builds a declarative root
//from the template's attributes alone
const serializeWithDeclarativeShadowRoots = (
	host: Element,
	shadowRootsToShip: Array<ShadowRoot>,
): string => {
	class DeclarativeShadowRootSerializer extends RealmHTMLSerializer {
		//happy-dom's serializer reaches every descendant through this method, nested roots included
		override serializeToString(node: Node): string {
			const html = super.serializeToString(node);
			const shadowRoot = node instanceof Element ? node.shadowRoot : null;
			if (shadowRoot === null || !shadowRootsToShip.includes(shadowRoot)) return html;
			return html.replace(DECLARATIVE_SHADOW_ROOT_START_TAG, () =>
				declarativeShadowRootStartTagOf(shadowRoot),
			);
		}
	}
	return new DeclarativeShadowRootSerializer({
		shadowRoots: shadowRootsToShip,
	}).serializeToString(host);
};

const reportNestedHostsStillWaiting = (
	realm: ServerRealm,
	unsettledTasks: ReadonlySet<PendingTask>,
	host: Element,
	pendingTaskTimeoutMs: number,
): void => {
	for (const task of unsettledTasks) {
		const waitingHost = task.host;
		const isNestedHost = waitingHost !== host && waitingHost instanceof Element;
		if (!isNestedHost || realm.reportedTags.has(waitingHost.localName)) continue;
		realm.reportedTags.add(waitingHost.localName);
		console.warn(
			`[prerender] <${waitingHost.localName}> was still waiting after ${pendingTaskTimeoutMs}ms, so it is left for the browser.`,
		);
	}
};

const renderHost = async (
	realm: ServerRealm,
	tagName: string,
	rawAttributes: string,
	lightDomHtml: string,
	pendingTaskTimeoutMs = 5000,
): Promise<string | null> => {
	//serializing a private wrapper rather than the body keeps anything a loaded module
	//appended to the document out of the page
	const renderContainer = document.createElement("div");
	const hostsThatThrew = new Set<EventTarget>();
	//canceled, so the library neither logs the error nor paints its text into the root
	renderContainer.addEventListener(COMPONENT_ERROR_EVENT_NAME, (event) => {
		event.preventDefault();
		hostsThatThrew.add(event.composedPath()[0]);
		//the listener only ever receives the library's own event
		const { error, tagName: thrownTagName } = event;
		if (realm.reportedTags.has(thrownTagName)) return;
		realm.reportedTags.add(thrownTagName);
		console.warn(
			`[prerender] <${thrownTagName}> threw on the server, so it is left for the browser. Browser-only work placed after the component's first paint never runs on the server.`,
			error,
		);
	});
	//canceled, so a component under ssr="false" stays unstarted and first runs in the browser
	renderContainer.addEventListener(COMPONENT_RENDER_EVENT_NAME, (event) => {
		const host = event.composedPath()[0];
		if (host instanceof Element && isLeftForTheBrowser(host)) event.preventDefault();
	});
	const unsettledTasks = new Set<PendingTask>();
	//in the capture phase: a loading container is asked to stop the event, which must not hide a
	//task from the render
	renderContainer.addEventListener(
		PENDING_TASK_EVENT_NAME,
		(event) => {
			const task: PendingTask = {
				host: event.composedPath()[0],
				//the listener only ever receives the protocol's event
				complete: (event as PendingTaskEventShape).complete,
			};
			unsettledTasks.add(task);
			const settle = () => unsettledTasks.delete(task);
			task.complete.then(settle, settle);
		},
		{ capture: true },
	);
	try {
		const host = document.createElement(tagName);
		for (const [name, value] of parseAttributes(rawAttributes)) host.setAttribute(name, value);
		//children are in place before the host connects, so slot-reading components see them
		if (lightDomHtml !== "") host.innerHTML = lightDomHtml;
		renderContainer.appendChild(host);
		document.body.appendChild(renderContainer);

		await waitForPendingTasks(unsettledTasks, pendingTaskTimeoutMs);
		const hasPainted = host.shadowRoot !== null && host.shadowRoot.childNodes.length > 0;
		if (!hasPainted && !hostsThatThrew.has(host)) {
			console.warn(
				hasUnsettledTask(unsettledTasks, host)
					? `[prerender] <${tagName}> was still waiting after ${pendingTaskTimeoutMs}ms, so it is left for the browser.`
					: `[prerender] <${tagName}> painted nothing and had no open pending-task to wait for, so it is left for the browser.`,
			);
			return null;
		}
		reportNestedHostsStillWaiting(realm, unsettledTasks, host, pendingTaskTimeoutMs);
		return serializeWithDeclarativeShadowRoots(
			host,
			shadowRootsToSerialize(renderContainer, hostsThatThrew),
		);
	} catch (error) {
		console.warn(
			`[prerender] <${tagName}> could not be prerendered, so it is left for the browser.`,
			error,
		);
		return null;
	} finally {
		renderContainer.remove();
	}
};

//pages render side by side in one realm, and the main thread closes it only once they are done
const renderPage = async (page: PageRenderRequest): Promise<string> => {
	currentRealm ??= createServerRealm();
	const realm = currentRealm;
	await loadPageModules(realm, page.environmentId, page.moduleUrls);
	reportUnprerenderableElements(realm, page.elements);
	const roots = choosePrerenderRoots(
		page.elements,
		(tagName) => tagSupportOf(realm, tagName) === TAG_SUPPORT.PRERENDERABLE,
	);

	//side by side, so a page waits for its slowest root instead of the sum of them. Each host still
	//connects in document order: a render runs synchronously up to its first wait
	const renderedRoots = await Promise.all(
		roots.map((root) =>
			renderHost(
				realm,
				root.tagName,
				root.rawAttributes,
				page.html.slice(root.contentStartIndex, root.contentEndIndex),
				page.pendingTaskTimeoutMs,
			),
		),
	);
	let transformedHtml = "";
	let copiedUpToIndex = 0;
	for (const [index, root] of roots.entries()) {
		const prerendered = renderedRoots[index];
		if (prerendered === null) continue;
		transformedHtml += page.html.slice(copiedUpToIndex, root.startIndex) + prerendered;
		copiedUpToIndex = root.endIndex;
	}
	return transformedHtml + page.html.slice(copiedUpToIndex);
};

//an error or a primitive crosses to the main thread as it is; anything else as the text node's
//console prints for it, since it may hold what a thread cannot send (a function, a DOM node)
const sendableArgument = (value: unknown): unknown => {
	const isSendable =
		value instanceof Error ||
		value === null ||
		(typeof value !== "object" && typeof value !== "function" && typeof value !== "symbol");
	return isSendable ? value : inspect(value);
};

if (parentPort === null) {
	throw new Error("ssr-render.worker runs only as the worker ssr-render starts");
}
const channel = openRealmChannel(parentPort, { renderPage, closeCurrentRealm });

//vite and the plugin's tests read the main thread's console, so the realm's warnings and errors go
//there
for (const level of ["warn", "error"] as const) {
	console[level] = (...args: Array<unknown>) => {
		channel.notify("console", { level, args: args.map(sendableArgument) } satisfies ConsoleNotice);
	};
}
