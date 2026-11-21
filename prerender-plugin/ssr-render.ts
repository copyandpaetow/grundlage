import { extname } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import {
	createServer,
	type DevEnvironment,
	type EnvironmentOptions,
	type InlineConfig,
	type ViteDevServer,
} from "vite";
import type { PageScripts } from "./page-scripts";
import type { CustomElementRecord } from "./scan";
import { openRealmChannel, type RealmChannel } from "./ssr-render.channel";
import type { ConsoleNotice, InvokeRequest, PageRenderRequest } from "./ssr-render.worker";

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

//the DOM realm lives in a worker, so the browser globals it installs never reach vite or the plugins
//next to this one
interface RealmWorker {
	worker: Worker;
	channel: RealmChannel;
}

//module-level so every plugin instance in the process shares one worker and one loader server per
//project: a tag can be defined only once per realm
let realmWorker: RealmWorker | null = null;
let isCurrentRealmStale = false;
//pages render side by side, but closing the realm swaps the globals a running page reads: a close
//waits for the pages that started before it, and the pages after it wait for the close
const runningPages = new Set<Promise<unknown>>();
let realmClosing: Promise<void> = Promise.resolve();
//an environment cannot cross to the worker, so the worker names one by its index here
const environments: Array<DevEnvironment> = [];
let loaderServerBootDepth = 0;
const moduleLoaderServers = new Map<string, Promise<ViteDevServer>>();

//true while a loader server is evaluating a project config, which constructs a second
//instance of this plugin that must stay inert instead of acting on its parent's state
export const isBootingLoaderServer = (): boolean => loaderServerBootDepth > 0;

//next to this module: the TypeScript source in the tests, the built `.mjs` in the package
const realmWorkerUrl = new URL(
	`./ssr-render.worker${extname(fileURLToPath(import.meta.url))}`,
	import.meta.url,
);

const startRealmWorker = (): RealmWorker => {
	const worker = new Worker(realmWorkerUrl);
	const channel = openRealmChannel(worker, {
		invoke: ({ environmentId, payload }: InvokeRequest) =>
			environments[environmentId].hot.handleInvoke(payload),
		console: ({ level, args }: ConsoleNotice) => {
			console[level](...args);
		},
	});
	worker.on("error", (error) => {
		console.warn(
			"[prerender] the server realm stopped on an uncaught error. The next page starts a new one.",
			error,
		);
	});
	worker.on("exit", () => {
		channel.failPendingRequests(new Error("the server realm stopped before the page was rendered"));
		if (realmWorker?.worker === worker) realmWorker = null;
	});
	return { worker, channel };
};

//an edit can change any module a component imports, and a defined tag cannot take its new
//version: the next prerender starts from a realm where nothing is defined yet
export const markServerRealmStale = (): void => {
	isCurrentRealmStale = true;
};

export const closeServerRealm = async (): Promise<void> => {
	await realmClosing;
	await Promise.allSettled(runningPages);
	if (realmWorker === null) return;
	const closing = realmWorker.worker;
	realmWorker = null;
	await closing.terminate();
};

//a vite dev server is the only loader that applies the project's own resolution (TypeScript,
//extensionless and directory imports, aliases) to component source files. The watcher is off
//so it never holds a finished build open
const startModuleLoaderServer = (loader: ModuleLoaderConfig): Promise<ViteDevServer> => {
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
	(await startModuleLoaderServer(loader)).environments[PRERENDER_ENVIRONMENT_NAME];

export const closeModuleLoaderServers = async (): Promise<void> => {
	const starting = [...moduleLoaderServers.values()];
	moduleLoaderServers.clear();
	await Promise.all(starting.map(async (server) => (await server).close()));
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
			`[prerender] could not find ${scriptUrl}, so the components it imports are left for the browser.`,
		);
	} catch (error) {
		console.warn(
			`[prerender] could not read what ${scriptUrl} imports, so the components it imports are left for the browser.`,
			error,
		);
	}
	return [];
};

export interface PageToRender {
	html: string;
	elements: Array<CustomElementRecord>;
	pageScripts: PageScripts;
	pendingTaskTimeoutMs: number | undefined;
}

export const renderPage = async (
	environment: DevEnvironment,
	page: PageToRender,
): Promise<string> => {
	const moduleUrls = [...page.pageScripts.inlineScriptImports];
	for (const scriptUrl of page.pageScripts.externalScriptUrls) {
		moduleUrls.push(...(await importsOfScript(environment, scriptUrl)));
	}
	if (!environments.includes(environment)) environments.push(environment);

	if (isCurrentRealmStale) {
		isCurrentRealmStale = false;
		const pagesInStaleRealm = [...runningPages];
		realmClosing = realmClosing
			.then(async () => {
				await Promise.allSettled(pagesInStaleRealm);
				//without a worker there is no realm to close: a new worker starts with a fresh one
				await realmWorker?.channel.request("closeCurrentRealm", null);
			})
			//a failed close leaves no stale realm behind: the worker drops it before closing it, and a
			//stopped worker's successor starts with a fresh one
			.catch(() => undefined);
	}
	const request: PageRenderRequest = {
		environmentId: environments.indexOf(environment),
		moduleUrls,
		html: page.html,
		elements: page.elements,
		pendingTaskTimeoutMs: page.pendingTaskTimeoutMs,
	};
	const run = realmClosing.then(() => {
		realmWorker ??= startRealmWorker();
		return realmWorker.channel.request("renderPage", request) as Promise<string>;
	});
	runningPages.add(run);
	try {
		return await run;
	} catch (error) {
		console.warn(
			"[prerender] the page could not be prerendered, so it is left for the browser.",
			error,
		);
		return page.html;
	} finally {
		runningPages.delete(run);
	}
};
