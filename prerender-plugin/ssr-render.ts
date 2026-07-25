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

let registrationPromise: Promise<void> | null = null;

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
const registerHappyDom = (
	componentModuleLoaders: ReadonlyArray<() => Promise<unknown>>,
): Promise<void> => {
	if (registrationPromise) return registrationPromise;
	registrationPromise = (async () => {
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
		await Promise.all(componentModuleLoaders.map((load) => load()));
	})();
	return registrationPromise;
};

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
	componentModuleLoaders: ReadonlyArray<() => Promise<unknown>>,
	firstYieldTimeoutMs = 5000,
): Promise<string | null> => {
	await registerHappyDom(componentModuleLoaders);

	const serverDocument = (globalThis as { document: Document }).document;
	const host = serverDocument.createElement(tagName);
	for (const [name, value] of parseAttributes(rawAttributes)) {
		host.setAttribute(name, value);
	}

	try {
		serverDocument.body.appendChild(host);
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
			serverDocument.body as unknown as {
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
		host.remove();
	}
};
