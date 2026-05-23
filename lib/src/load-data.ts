/*
shared primitive for "data the component needs before its first renderable yield"
the server runs the fetcher, collects the resolved value into a per-host buffer hung off the host
itself via a Symbol-keyed property, and the framework flushes that buffer into
<script type="application/json" data-ssr> elements appended to the host's shadow root on the first
renderable yield
the client reads those scripts in DOM order (or by data-key when one is given), removes them as it
goes, and falls through to the fetcher once nothing is left to replay — so the DOM is the queue
and no JS-side cache survives the hydration pass
*/
import { isServer } from "./utils/is-server";

export interface LoadDataOptions {
	/** Optional name for this load — survives refactors, lets keyed reads ignore unkeyed scripts. */
	key?: string;
	/** Skip the SSR replay and always call the fetcher (escape hatch for forced revalidation). */
	skipSsr?: boolean;
}

interface CollectedEntry {
	key: string | undefined;
	value: unknown;
}

//server-only buffer: hung off the host element itself under a Symbol so we pay one shape transition + one pointer read instead of a WeakMap hash lookup per collect/flush
//we clear it explicitly in flushHostPayload, so reachability via the host doesn't keep anything alive past the snapshot
const PENDING_SSR_LOADS = Symbol("grundlage.pendingSsrLoads");

interface ServerHost extends Element {
	[PENDING_SSR_LOADS]?: CollectedEntry[];
}

const SSR_ATTRIBUTE = "data-ssr";
const KEY_ATTRIBUTE = "data-key";
//`data-ssr` is our private discriminator and the server only ever writes these as direct children of the shadow root, so a subtree-wide selector is safe and matches what the engine has fast paths for
const UNKEYED_SELECTOR = `script[${SSR_ATTRIBUTE}]:not([${KEY_ATTRIBUTE}])`;
const ANGLE_BRACKET = /</g;

const findReplayScript = (
	shadowRoot: ShadowRoot,
	key: string | undefined,
): Element | null => {
	if (key === undefined) return shadowRoot.querySelector(UNKEYED_SELECTOR);
	//key comes from user code, so escape before splicing into the selector
	return shadowRoot.querySelector(
		`script[${SSR_ATTRIBUTE}][${KEY_ATTRIBUTE}="${CSS.escape(key)}"]`,
	);
};

const collectOnServer = async <Value>(
	host: ServerHost,
	fetcher: () => Promise<Value>,
	key: string | undefined,
): Promise<Value> => {
	const value = await fetcher();
	const existing = host[PENDING_SSR_LOADS];
	if (existing === undefined) host[PENDING_SSR_LOADS] = [{ key, value }];
	else existing.push({ key, value });
	return value;
};

export const loadData = <Value>(
	host: Element,
	fetcher: () => Promise<Value>,
	options?: string | LoadDataOptions,
): Promise<Value> => {
	let key: string | undefined;
	let skipSsr = false;
	if (typeof options === "string") key = options;
	else if (options !== undefined) {
		key = options.key;
		skipSsr = options.skipSsr === true;
	}

	if (isServer()) return collectOnServer(host as ServerHost, fetcher, key);

	//client replay path stays synchronous up to Promise.resolve — no async wrapper allocation when the script is present
	if (!skipSsr && host.shadowRoot !== null) {
		const script = findReplayScript(host.shadowRoot, key);
		if (script !== null) {
			const value = JSON.parse(script.textContent || "null") as Value;
			script.remove();
			return Promise.resolve(value);
		}
	}

	return fetcher();
};

/*
framework hook — called on the first renderable yield during SSR
drains the per-host buffer into <script type="application/json" data-ssr> elements appended to the
host's shadow root and clears the buffer;
*/
export const flushHostPayload = (host: Element): void => {
	const serverHost = host as ServerHost;
	const collected = serverHost[PENDING_SSR_LOADS];
	if (collected === undefined) return;
	serverHost[PENDING_SSR_LOADS] = undefined;
	if (collected.length === 0) return;

	//real components always have both; the hook is the framework's single call site, so the check exists only for tests that pass bare elements
	const ownerDocument = host.ownerDocument;
	const shadowRoot = host.shadowRoot;
	if (ownerDocument == null || shadowRoot == null) return;

	for (let index = 0; index < collected.length; index++) {
		const entry = collected[index];
		const script = ownerDocument.createElement("script");
		script.setAttribute("type", "application/json");
		script.setAttribute(SSR_ATTRIBUTE, "");
		if (entry.key !== undefined) script.setAttribute(KEY_ATTRIBUTE, entry.key);
		//escape `<` so a value containing `</script>` cannot terminate the inline script context
		script.textContent = JSON.stringify(entry.value).replace(
			ANGLE_BRACKET,
			"\\u003c",
		);
		shadowRoot.appendChild(script);
	}
};
