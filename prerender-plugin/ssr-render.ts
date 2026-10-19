import type { Window as HappyDomWindow } from "happy-dom";
import {
	createServer,
	createServerModuleRunner,
	type DevEnvironment,
	type EnvironmentOptions,
	type InlineConfig,
	type ViteDevServer,
} from "vite";
import type { ModuleRunner } from "vite/module-runner";
import type { PageScripts } from "./page-scripts";
import {
	parseAttributes,
	PRERENDER_ATTRIBUTE,
	PRERENDER_CHOICE,
	prerenderChoiceOfValue,
} from "./scan";

export type ResolveOptions = InlineConfig["resolve"];

export interface ModuleLoaderConfig {
	root: string;
	//a path re-runs the project's own config for the loader server; `false` boots a bare one
	configFile: string | false;
	mode: string | undefined;
	resolveOptions: ResolveOptions;
}

export const PRERENDER_ENVIRONMENT_NAME = "grundlage_prerender";

//node_modules included: a fresh realm can only re-run what vite's module runner evaluated, and a
//package node's own module cache holds would keep its components defined in the old realm only
export const prerenderEnvironmentOptions: EnvironmentOptions = {
	consumer: "server",
	resolve: { noExternal: true },
	optimizeDeps: { noDiscovery: true, include: [] },
};

export const TAG_SUPPORT = {
	UNDEFINED: 0,
	CONSTRUCTOR_THREW: 1,
	CLOSED_ROOT: 2,
	NO_SERIALIZABLE_ROOT: 3,
	PRERENDERABLE: 4,
} as const;
export type TagSupportKind = (typeof TAG_SUPPORT)[keyof typeof TAG_SUPPORT];

interface EnvironmentLoader {
	runner: ModuleRunner;
	moduleLoadAttempts: Map<string, Promise<void>>;
}

type RealmHTMLSerializerClass = new (options: {
	shadowRoots: Array<ShadowRoot>;
}) => { serializeToString(node: Node): string };

export interface ServerRealm {
	window: HappyDomWindow;
	HTMLSerializer: RealmHTMLSerializerClass;
	loaders: Map<DevEnvironment, EnvironmentLoader>;
	//defined tags only: a tag still undefined may be defined by the next page's modules
	tagSupport: Map<string, TagSupportKind>;
	//once per realm, so in dev a warning comes back after every edit that leaves the cause in place
	reportedTags: Set<string>;
}

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

//module-level so every plugin instance in the process shares one DOM realm and one loader server
//per project: a tag can be defined only once per realm
let currentRealm: ServerRealm | null = null;
let isCurrentRealmStale = false;
//one task at a time: replacing the realm swaps the globals a running prerender reads
let pendingRealmWork: Promise<unknown> = Promise.resolve();
let loaderServerBootDepth = 0;
const moduleLoaderServers = new Map<string, Promise<ViteDevServer>>();

//true while a loader server is evaluating a project config — which constructs a second
//instance of this plugin that must stay inert instead of acting on its parent's state
export const isBootingLoaderServer = (): boolean => loaderServerBootDepth > 0;

//happy-dom neither exposes closed roots via internals nor serializes them, so we
//record them at attach time — enough to detect and skip, not to prerender
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
	const attachShadow = elementPrototype.attachShadow as (
		init: ShadowRootInit,
	) => ShadowRoot;
	elementPrototype.attachShadow = function (
		this: object,
		init: ShadowRootInit,
	) {
		if (init?.mode === "closed") hostsWithClosedRoot.add(this);
		const shadowRoot = attachShadow.call(this, { ...init, clonable: false });
		requestedInitOfShadowRoot.set(shadowRoot, init);
		return shadowRoot;
	};
};

//exposes happy-dom's entire DOM surface, then forces server mode via the library's
//own __grundlage_ssr__ switch — `window` is left unset so `typeof window` stays "undefined"
const installRealmGlobals = (window: HappyDomWindow): void => {
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

const createServerRealm = async (): Promise<ServerRealm> => {
	const { Window, HTMLSerializer } = await import("happy-dom");
	const window = new Window();
	installRealmGlobals(window);
	return {
		window,
		//happy-dom's own classes are the DOM the realm installs, which this module types by lib.dom
		HTMLSerializer: HTMLSerializer as unknown as RealmHTMLSerializerClass,
		loaders: new Map(),
		tagSupport: new Map(),
		reportedTags: new Set(),
	};
};

const closeRealm = async (realm: ServerRealm): Promise<void> => {
	for (const loader of realm.loaders.values()) await loader.runner.close();
	await realm.window.happyDOM.close();
};

const currentOrFreshRealm = async (): Promise<ServerRealm> => {
	if (currentRealm !== null && !isCurrentRealmStale) return currentRealm;
	if (currentRealm !== null) await closeRealm(currentRealm);
	isCurrentRealmStale = false;
	currentRealm = await createServerRealm();
	return currentRealm;
};

//an edit can change any module a component imports, and a defined tag cannot take its new
//version: the next prerender starts from a realm where nothing is defined yet
export const markServerRealmStale = (): void => {
	isCurrentRealmStale = true;
};

export const runInServerRealm = <Result>(
	work: (realm: ServerRealm) => Promise<Result>,
): Promise<Result> => {
	const run = pendingRealmWork.then(async () =>
		work(await currentOrFreshRealm()),
	);
	//the caller sees the failure; the queue only needs to know the task is over
	pendingRealmWork = run.catch(() => undefined);
	return run;
};

export const closeServerRealm = (): Promise<void> => {
	const run = pendingRealmWork.then(async () => {
		if (currentRealm === null) return;
		const closing = currentRealm;
		currentRealm = null;
		await closeRealm(closing);
	});
	pendingRealmWork = run.catch(() => undefined);
	return run;
};

//a vite dev server is the only loader that applies the project's own resolution — TypeScript,
//extensionless and directory imports, aliases — to component source files. the watcher is off
//so it never holds a finished build open
const startModuleLoaderServer = (
	loader: ModuleLoaderConfig,
): Promise<ViteDevServer> => {
	const serverKey = `${loader.configFile}\n${loader.root}`;
	const running = moduleLoaderServers.get(serverKey);
	if (running) return running;

	const sharedConfig: InlineConfig = {
		root: loader.root,
		mode: loader.mode,
		appType: "custom",
		logLevel: "silent",
		server: { middlewareMode: true, watch: null },
		optimizeDeps: { noDiscovery: true },
		environments: { [PRERENDER_ENVIRONMENT_NAME]: prerenderEnvironmentOptions },
	};

	loaderServerBootDepth += 1;
	const starting = (
		loader.configFile
			? //the project config runs a second time here, so its plugins transform component
				//modules the way they do app modules
				createServer({ ...sharedConfig, configFile: loader.configFile })
			: createServer({
					...sharedConfig,
					configFile: false,
					resolve: loader.resolveOptions,
				})
	).finally(() => {
		loaderServerBootDepth -= 1;
	});

	moduleLoaderServers.set(serverKey, starting);
	return starting;
};

export const prerenderEnvironmentOfLoader = async (
	loader: ModuleLoaderConfig,
): Promise<DevEnvironment> =>
	(await startModuleLoaderServer(loader)).environments[
		PRERENDER_ENVIRONMENT_NAME
	];

export const closeModuleLoaderServers = async (): Promise<void> => {
	const starting = [...moduleLoaderServers.values()];
	moduleLoaderServers.clear();
	await Promise.all(starting.map(async (server) => (await server).close()));
};

const loaderOf = (
	realm: ServerRealm,
	environment: DevEnvironment,
): EnvironmentLoader => {
	const existing = realm.loaders.get(environment);
	if (existing !== undefined) return existing;
	const created: EnvironmentLoader = {
		runner: createServerModuleRunner(environment, { hmr: false }),
		moduleLoadAttempts: new Map(),
	};
	realm.loaders.set(environment, created);
	return created;
};

const importOnce = (
	loader: EnvironmentLoader,
	moduleUrl: string,
): Promise<void> => {
	const attempted = loader.moduleLoadAttempts.get(moduleUrl);
	if (attempted) return attempted;
	const attempt = loader.runner.import(moduleUrl).then(
		() => undefined,
		(error: unknown) => {
			console.warn(
				`[prerender] could not load ${moduleUrl} — any component it defines renders on the client.`,
				error,
			);
		},
	);
	loader.moduleLoadAttempts.set(moduleUrl, attempt);
	return attempt;
};

//the transform lists a script's static imports without evaluating it, so the page's own wiring
//code never runs on the server
const importsOfScript = async (
	environment: DevEnvironment,
	scriptUrl: string,
): Promise<Array<string>> => {
	try {
		const transformed = await environment.transformRequest(scriptUrl);
		if (transformed !== null) return transformed.deps ?? [];
		console.warn(
			`[prerender] could not find ${scriptUrl} — the components it imports render on the client.`,
		);
	} catch (error) {
		console.warn(
			`[prerender] could not read what ${scriptUrl} imports — the components it imports render on the client.`,
			error,
		);
	}
	return [];
};

//one module at a time and in page order, so module side effects run in the same order on every
//machine
export const loadPageModules = async (
	realm: ServerRealm,
	environment: DevEnvironment,
	pageScripts: PageScripts,
): Promise<void> => {
	const loader = loaderOf(realm, environment);
	const moduleUrls = [...pageScripts.inlineScriptImports];
	for (const scriptUrl of pageScripts.externalScriptUrls)
		moduleUrls.push(...(await importsOfScript(environment, scriptUrl)));
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

export const tagSupportOf = (
	realm: ServerRealm,
	tagName: string,
): TagSupportKind => {
	const known = realm.tagSupport.get(tagName);
	if (known !== undefined) return known;
	const support = classifyTag(tagName);
	if (support !== TAG_SUPPORT.UNDEFINED) realm.tagSupport.set(tagName, support);
	return support;
};

//dispatched composed by the library's fatal path on the host that threw, so it reaches the render
//container from any depth of shadow trees
const COMPONENT_ERROR_EVENT_NAME = "grundlage-error";

//the library's ComponentErrorEvent, read by shape: its class belongs to the page's copy of grundlage
interface ComponentErrorEventShape extends Event {
	readonly error: unknown;
	readonly tagName: string;
}

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
}

//a settled task lets its component paint, and a child that paint mounts can announce a task of its
//own, so the wait ends once every task announced so far has settled
const waitForPendingTasks = async (
	unsettledTasks: ReadonlySet<PendingTask>,
	timeoutMs: number,
): Promise<void> => {
	const deadline = Date.now() + timeoutMs;
	while (unsettledTasks.size > 0 && Date.now() < deadline)
		await new Promise((resolve) => setTimeout(resolve, 16));
};

const hasUnsettledTask = (
	unsettledTasks: ReadonlySet<PendingTask>,
	host: EventTarget,
): boolean => {
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
		if (choice !== PRERENDER_CHOICE.INHERIT)
			return choice === PRERENDER_CHOICE.OFF;
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
	for (
		let tree = treesToSearch.pop();
		tree !== undefined;
		tree = treesToSearch.pop()
	) {
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
const DECLARATIVE_SHADOW_ROOT_START_TAG =
	/<template shadowrootmode="[^"]*"[^>]*>/;

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
	realm: ServerRealm,
	host: Element,
	shadowRootsToShip: Array<ShadowRoot>,
): string => {
	class DeclarativeShadowRootSerializer extends realm.HTMLSerializer {
		//happy-dom's serializer reaches every descendant through this method, nested roots included
		override serializeToString(node: Node): string {
			const html = super.serializeToString(node);
			const shadowRoot = node instanceof Element ? node.shadowRoot : null;
			if (shadowRoot === null || !shadowRootsToShip.includes(shadowRoot))
				return html;
			return html.replace(DECLARATIVE_SHADOW_ROOT_START_TAG, () =>
				declarativeShadowRootStartTagOf(shadowRoot),
			);
		}
	}
	return new DeclarativeShadowRootSerializer({
		shadowRoots: shadowRootsToShip,
	}).serializeToString(host);
};

export const renderHost = async (
	realm: ServerRealm,
	tagName: string,
	rawAttributes: string,
	lightDomHtml: string,
	firstYieldTimeoutMs = 5000,
): Promise<string | null> => {
	//serializing a private wrapper rather than the body keeps anything a loaded module
	//appended to the document out of the page
	const renderContainer = document.createElement("div");
	const hostsThatThrew = new Set<EventTarget>();
	//cancelled, so the library neither logs the error nor paints its text into the root
	renderContainer.addEventListener(COMPONENT_ERROR_EVENT_NAME, (event) => {
		event.preventDefault();
		hostsThatThrew.add(event.composedPath()[0]);
		//the listener only ever receives the library's own event
		const { error, tagName: thrownTagName } = event as ComponentErrorEventShape;
		if (realm.reportedTags.has(thrownTagName)) return;
		realm.reportedTags.add(thrownTagName);
		console.warn(
			`[prerender] <${thrownTagName}> threw on the server — rendering on client. Browser-only work placed after the component's first paint never runs on the server.`,
			error,
		);
	});
	//cancelled, so a component under ssr="false" stays unstarted and first runs in the browser
	renderContainer.addEventListener(COMPONENT_RENDER_EVENT_NAME, (event) => {
		const host = event.composedPath()[0];
		if (host instanceof Element && isLeftForTheBrowser(host))
			event.preventDefault();
	});
	const unsettledTasks = new Set<PendingTask>();
	//in the capture phase: a loading container is asked to stop the event, which must not hide a
	//task from the render
	renderContainer.addEventListener(
		PENDING_TASK_EVENT_NAME,
		(event) => {
			const task: PendingTask = { host: event.composedPath()[0] };
			unsettledTasks.add(task);
			const settle = () => unsettledTasks.delete(task);
			//the listener only ever receives the protocol's event
			(event as PendingTaskEventShape).complete.then(settle, settle);
		},
		{ capture: true },
	);
	try {
		const host = document.createElement(tagName);
		for (const [name, value] of parseAttributes(rawAttributes))
			host.setAttribute(name, value);
		//children are in place before the host connects, so slot-reading components see them
		if (lightDomHtml !== "") host.innerHTML = lightDomHtml;
		renderContainer.appendChild(host);
		document.body.appendChild(renderContainer);

		await waitForPendingTasks(unsettledTasks, firstYieldTimeoutMs);
		const hasPainted =
			host.shadowRoot !== null && host.shadowRoot.childNodes.length > 0;
		if (!hasPainted && !hostsThatThrew.has(host)) {
			console.warn(
				hasUnsettledTask(unsettledTasks, host)
					? `[prerender] <${tagName}> was still waiting after ${firstYieldTimeoutMs}ms — leaving it for client render.`
					: `[prerender] <${tagName}> painted nothing and had no open pending-task to wait for — leaving it for client render.`,
			);
			return null;
		}
		for (const task of unsettledTasks) {
			const waitingHost = task.host;
			const isNestedHost =
				waitingHost !== host && waitingHost instanceof Element;
			if (!isNestedHost || realm.reportedTags.has(waitingHost.localName))
				continue;
			realm.reportedTags.add(waitingHost.localName);
			console.warn(
				`[prerender] <${waitingHost.localName}> was still waiting after ${firstYieldTimeoutMs}ms — leaving it for client render.`,
			);
		}
		return serializeWithDeclarativeShadowRoots(
			realm,
			host,
			shadowRootsToSerialize(renderContainer, hostsThatThrew),
		);
	} catch (error) {
		console.warn(
			`[prerender] <${tagName}> could not be prerendered — rendering on client.`,
			error,
		);
		return null;
	} finally {
		renderContainer.remove();
	}
};
