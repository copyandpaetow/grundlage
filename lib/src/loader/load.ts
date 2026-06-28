import { isServer } from "../utils/is-server";

export interface LoadOptions {
	key?: string;
	skipSsr?: boolean;
}

interface CollectedEntry {
	key: string | undefined;
	value: unknown;
}

const PENDING_SSR_LOADS = Symbol("grundlage.pendingSsrLoads");

interface ServerHost extends Element {
	[PENDING_SSR_LOADS]?: CollectedEntry[];
}

const SSR_ATTRIBUTE = "data-ssr";
const KEY_ATTRIBUTE = "data-key";
const UNKEYED_SELECTOR = `script[${SSR_ATTRIBUTE}]:not([${KEY_ATTRIBUTE}])`;
const ANGLE_BRACKET = /</g;

const findReplayScript = (
	shadowRoot: ShadowRoot,
	key: string | undefined,
): Element | null => {
	if (key === undefined) return shadowRoot.querySelector(UNKEYED_SELECTOR);
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

export const load = <Value>(
	host: Element,
	fetcher: () => Promise<Value>,
	options?: string | LoadOptions,
): Promise<Value> => {
	let key: string | undefined;
	let skipSsr = false;
	if (typeof options === "string") key = options;
	else if (options !== undefined) {
		key = options.key;
		skipSsr = options.skipSsr === true;
	}

	if (isServer()) return collectOnServer(host as ServerHost, fetcher, key);

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

export const flushHostPayload = (host: Element): void => {
	const serverHost = host as ServerHost;
	const collected = serverHost[PENDING_SSR_LOADS];
	if (collected === undefined) return;
	serverHost[PENDING_SSR_LOADS] = undefined;
	if (collected.length === 0) return;

	const ownerDocument = host.ownerDocument;
	const shadowRoot = host.shadowRoot;
	if (ownerDocument == null || shadowRoot == null) return;

	for (let index = 0; index < collected.length; index++) {
		const entry = collected[index];
		const script = ownerDocument.createElement("script");
		script.setAttribute("type", "application/json");
		script.setAttribute(SSR_ATTRIBUTE, "");
		if (entry.key !== undefined) script.setAttribute(KEY_ATTRIBUTE, entry.key);
		script.textContent = JSON.stringify(entry.value).replace(
			ANGLE_BRACKET,
			"\\u003c",
		);
		shadowRoot.appendChild(script);
	}
};
