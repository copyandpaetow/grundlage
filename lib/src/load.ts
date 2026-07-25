import { isServer } from "./utils/guards";
import { BaseComponent } from "./types";

//a closed shadow root is absent from host.shadowRoot; internals is its only handle
const resolveShadowRoot = (host: Element): ShadowRoot | null =>
	host.shadowRoot ?? (host as BaseComponent).internals?.shadowRoot ?? null;

export interface LoadOptions {
	key?: string;
	skipSsr?: boolean;
}

interface CollectedEntry {
	key: string | undefined;
	value: unknown;
}

//written by collectOnServer during the render, drained once by flushHostPayload
const pendingSsrLoads = new WeakMap<Element, Array<CollectedEntry>>();

const SSR_ATTRIBUTE = "data-ssr";
const KEY_ATTRIBUTE = "data-key";
const UNKEYED_SELECTOR = `script[${SSR_ATTRIBUTE}]:not([${KEY_ATTRIBUTE}])`;
const ANY_SSR_SELECTOR = `script[${SSR_ATTRIBUTE}]`;
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
	host: Element,
	fetcher: () => Promise<Value>,
	key: string | undefined,
): Promise<Value> => {
	const value = await fetcher();
	const existing = pendingSsrLoads.get(host);
	if (existing === undefined) pendingSsrLoads.set(host, [{ key, value }]);
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

	if (isServer()) {
		if (skipSsr) return fetcher();
		return collectOnServer(host, fetcher, key);
	}

	const shadowRoot = resolveShadowRoot(host);
	if (!skipSsr && shadowRoot) {
		const script = findReplayScript(shadowRoot, key);
		if (script) {
			const value = JSON.parse(script.textContent || "null") as Value;
			script.remove();
			return Promise.resolve(value);
		}
	}

	return fetcher();
};

export const warnOnUnclaimedSsrPayloads = (shadowRoot: ShadowRoot): void => {
	const leftover = shadowRoot.querySelectorAll(ANY_SSR_SELECTOR);
	if (leftover.length === 0) return;
	console.warn(
		`grundlage: ${leftover.length} SSR load() payload(s) went unclaimed during hydration. ` +
			"A conditional or reordered load() call can hand the wrong data to the wrong load() " +
			"— pass a stable key to the affected load() calls to opt out of positional replay.",
	);
};

export const flushHostPayload = (host: Element): void => {
	const collected = pendingSsrLoads.get(host);
	if (collected === undefined) return;
	pendingSsrLoads.delete(host);
	if (collected.length === 0) return;

	const ownerDocument = host.ownerDocument;
	const shadowRoot = resolveShadowRoot(host);
	if (ownerDocument === null || shadowRoot === null) return;

	for (let index = 0; index < collected.length; index++) {
		const entry = collected[index];
		const script = ownerDocument.createElement("script");
		script.setAttribute("type", "application/json");
		script.setAttribute(SSR_ATTRIBUTE, "");
		if (entry.key !== undefined) script.setAttribute(KEY_ATTRIBUTE, entry.key);
		//JSON.stringify(undefined) returns undefined, not a string; replay parses "null" back
		const serialized = JSON.stringify(entry.value);
		script.textContent =
			serialized === undefined
				? "null"
				: serialized.replace(ANGLE_BRACKET, "\\u003c");
		shadowRoot.appendChild(script);
	}
};
