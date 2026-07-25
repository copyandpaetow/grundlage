import { createServer, type InlineConfig, type ViteDevServer } from "vite";

export type ResolveOptions = InlineConfig["resolve"];

export interface ModuleLoaderConfig {
	root: string;
	//a path re-runs the project's own config for the loader server; `false` boots a bare one
	configFile: string | false;
	mode: string | undefined;
	resolveOptions: ResolveOptions;
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

//module-level so every plugin instance in the process shares one DOM realm, one loader
//server and one registry — a component module must evaluate exactly once
let happyDomRegistration: Promise<void> | null = null;
let loaderServerBootDepth = 0;
const moduleLoaderServers = new Map<string, Promise<ViteDevServer>>();
const moduleLoadAttempts = new Map<string, Promise<void>>();

//true while a loader server is evaluating a project config — which constructs a second
//instance of this plugin that must stay inert instead of acting on its parent's state
export const isBootingLoaderServer = (): boolean => loaderServerBootDepth > 0;

//happy-dom neither exposes closed roots via internals nor serializes them, so we
//record them at attach time — enough to detect and skip, not to prerender
const hostsWithClosedRoot = new WeakSet<object>();

const captureClosedRoots = (): void => {
	const elementPrototype = (
		globalThis as unknown as {
			HTMLElement: { prototype: Record<string, unknown> };
		}
	).HTMLElement.prototype;
	const attachShadow = elementPrototype.attachShadow as (init: {
		mode?: string;
	}) => ShadowRoot;
	elementPrototype.attachShadow = function (
		this: object,
		init: { mode?: string },
	) {
		if (init?.mode === "closed") hostsWithClosedRoot.add(this);
		return attachShadow.call(this, init);
	};
};

//exposes happy-dom's entire DOM surface, then forces server mode via the library's
//own __grundlage_ssr__ switch — `window` is left unset so `typeof window` stays "undefined"
const registerHappyDom = (): Promise<void> => {
	if (happyDomRegistration) return happyDomRegistration;
	happyDomRegistration = (async () => {
		const { Window } = await import("happy-dom");
		const happyDomWindow = new Window() as unknown as Record<string, unknown>;
		for (const name of Object.getOwnPropertyNames(happyDomWindow)) {
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
				value: happyDomWindow[name],
				writable: true,
				enumerable: false,
				configurable: true,
			});
		}
		(globalThis as { __grundlage_ssr__?: boolean }).__grundlage_ssr__ = true;
		captureClosedRoots();
	})();
	return happyDomRegistration;
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

export const closeModuleLoaderServers = async (): Promise<void> => {
	const starting = [...moduleLoaderServers.values()];
	moduleLoaderServers.clear();
	await Promise.all(starting.map(async (server) => (await server).close()));
};

//happy-dom must be in place before any component module evaluates: the library touches
//document at module load
export const loadComponentModules = async (
	loader: ModuleLoaderConfig,
	filePaths: ReadonlyArray<string>,
): Promise<void> => {
	await registerHappyDom();
	const server = await startModuleLoaderServer(loader);
	await Promise.all(
		filePaths.map((filePath) => {
			const attempted = moduleLoadAttempts.get(filePath);
			if (attempted) return attempted;
			const attempt = server.ssrLoadModule(filePath).then(
				() => undefined,
				(error: unknown) => {
					console.warn(
						`[prerender] could not load ${filePath} — any component it defines renders on the client.`,
						error,
					);
				},
			);
			moduleLoadAttempts.set(filePath, attempt);
			return attempt;
		}),
	);
};

export const isComponentDefined = (tagName: string): boolean =>
	(
		globalThis as { customElements?: CustomElementRegistry }
	).customElements?.get(tagName) !== undefined;

const parseAttributes = (rawAttributes: string): Array<[string, string]> => {
	const pairs: Array<[string, string]> = [];
	const pattern =
		/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
	let match: RegExpExecArray | null;
	while ((match = pattern.exec(rawAttributes)) !== null) {
		const [, name, doubleQuoted, singleQuoted, bare] = match;
		pairs.push([name, doubleQuoted ?? singleQuoted ?? bare ?? ""]);
	}
	return pairs;
};

type FirstYieldOutcome = "rendered" | "closed-root" | "timeout";

const waitForFirstYield = async (
	host: HTMLElement,
	timeoutMs: number,
): Promise<FirstYieldOutcome> => {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (hostsWithClosedRoot.has(host)) return "closed-root";
		if (host.shadowRoot && host.shadowRoot.childNodes.length > 0) {
			return "rendered";
		}
		await new Promise((resolve) => setTimeout(resolve, 16));
	}
	return "timeout";
};

export const renderHost = async (
	tagName: string,
	rawAttributes: string,
	lightDomHtml: string,
	firstYieldTimeoutMs = 5000,
): Promise<string | null> => {
	const serverDocument = (globalThis as { document: Document }).document;
	const host = serverDocument.createElement(tagName);
	for (const [name, value] of parseAttributes(rawAttributes)) {
		host.setAttribute(name, value);
	}
	//children are in place before the host connects, so slot-reading components see them
	if (lightDomHtml !== "") host.innerHTML = lightDomHtml;

	//serializing a private wrapper rather than the body keeps anything a loaded module
	//appended to the document out of the page
	const renderContainer = serverDocument.createElement("div");
	renderContainer.appendChild(host);

	try {
		serverDocument.body.appendChild(renderContainer);
		const outcome = await waitForFirstYield(host, firstYieldTimeoutMs);
		if (outcome === "closed-root") {
			console.warn(
				`[prerender] <${tagName}> uses a closed shadow root, which happy-dom cannot serialize — rendering on client.`,
			);
			return null;
		}
		if (outcome === "timeout") {
			console.warn(
				`[prerender] <${tagName}> produced no shadow content within ${firstYieldTimeoutMs}ms — leaving it for client render.`,
			);
			return null;
		}

		return (
			renderContainer as unknown as {
				getHTML(options: { serializableShadowRoots: boolean }): string;
			}
		).getHTML({ serializableShadowRoots: true });
	} catch (error) {
		console.warn(
			`[prerender] <${tagName}> threw during prerender — leaving it for client render.`,
			error,
		);
		return null;
	} finally {
		renderContainer.remove();
	}
};
