import { isServer } from "./utils/guards";
import { isDevelopmentBuild, warnDuringDevelopment } from "./utils/diagnostics";
import { findShadowRoot } from "./rendering/dom";

export interface LoadOptions {
	key?: string;
	skipSSR?: boolean;
}

interface CollectedEntry {
	key: string | undefined;
	value: unknown;
}

//written by collectOnServer during the render, drained once by flushHostPayload
const pendingSSRLoads = new WeakMap<Element, Array<CollectedEntry>>();

const SSR_ATTRIBUTE = "data-ssr";
const KEY_ATTRIBUTE = "data-key";
const UNKEYED_SELECTOR = `script[${SSR_ATTRIBUTE}]:not([${KEY_ATTRIBUTE}])`;
const ANY_SSR_SELECTOR = `script[${SSR_ATTRIBUTE}]`;
const ANGLE_BRACKET = /</g;

//depth one, walked rather than selected because a ShadowRoot is never a :scope match: every payload
//is a direct child, and a <script data-ssr> the component rendered itself must not be claimed as one
const findReplayScript = (
	shadowRoot: ShadowRoot,
	key: string | undefined,
): Element | null => {
	const selector =
		key === undefined
			? UNKEYED_SELECTOR
			: `script[${SSR_ATTRIBUTE}][${KEY_ATTRIBUTE}="${CSS.escape(key)}"]`;
	const children = shadowRoot.children;
	for (let index = 0; index < children.length; index++)
		if (children[index].matches(selector)) return children[index];
	return null;
};

const collectOnServer = async <Value>(
	host: Element,
	fetcher: () => Promise<Value>,
	key: string | undefined,
): Promise<Value> => {
	const value = await fetcher();
	const existing = pendingSSRLoads.get(host);
	if (existing === undefined) pendingSSRLoads.set(host, [{ key, value }]);
	else existing.push({ key, value });
	return value;
};

export const load = <Value>(
	host: Element,
	fetcher: () => Promise<Value>,
	options?: string | LoadOptions,
): Promise<Value> => {
	let key: string | undefined;
	let skipSSR = false;
	if (typeof options === "string") key = options;
	else if (options !== undefined) {
		key = options.key;
		skipSSR = options.skipSSR === true;
	}

	if (isServer()) {
		if (skipSSR) return fetcher();
		return collectOnServer(host, fetcher, key);
	}

	const shadowRoot = findShadowRoot(host);
	const mayReplayServerData = !skipSSR && shadowRoot !== null;
	if (!mayReplayServerData) return fetcher();
	const script = findReplayScript(shadowRoot, key);
	if (!script) return fetcher();
	const value = JSON.parse(script.textContent || "null") as Value;
	script.remove();
	return Promise.resolve(value);
};

export const warnOnUnclaimedSSRPayloads = (shadowRoot: ShadowRoot): void => {
	if (!isDevelopmentBuild) return;
	const children = shadowRoot.children;
	let leftoverCount = 0;
	for (let index = 0; index < children.length; index++)
		if (children[index].matches(ANY_SSR_SELECTOR)) leftoverCount++;
	if (leftoverCount === 0) return;
	warnDuringDevelopment(
		`${leftoverCount} SSR load() payload(s) went unclaimed during hydration. ` +
			"A conditional or reordered load() call can hand the wrong data to the wrong load() " +
			"— pass a stable key to the affected load() calls to opt out of positional replay.",
	);
};

export const flushHostPayload = (host: Element): void => {
	const collected = pendingSSRLoads.get(host);
	if (collected === undefined) return;
	pendingSSRLoads.delete(host);

	const ownerDocument = host.ownerDocument;
	const shadowRoot = findShadowRoot(host);
	if (shadowRoot === null) return;

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
