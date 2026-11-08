import type { ComponentRunner } from "./runtime/driver";
import { isTemplate } from "./template";
import { isDevelopmentBuild, libraryMessage, warnDuringDevelopment } from "./utils/diagnostics";

const SSR_ATTRIBUTE = "data-ssr";
const KEY_ATTRIBUTE = "data-key";
const FAILED_ATTRIBUTE = "data-failed";
const POSITIONAL_SELECTOR = `script[${SSR_ATTRIBUTE}]:not([${KEY_ATTRIBUTE}])`;
const ANY_PAYLOAD_SELECTOR = `script[${SSR_ATTRIBUTE}]`;
const ANGLE_BRACKET = /</g;
//bounds the walk's recursion: deeper than any data an API returns, far short of a stack overflow
const PLAIN_DATA_DEPTH_LIMIT = 512;

//registered, so the driver of another bundled copy of the library recognizes it too
export const LOAD_REQUEST: unique symbol = Symbol.for("grundlage.load-request");

export type LoadRequest = typeof LOAD_REQUEST;

const NO_SERVER_VALUE: unique symbol = Symbol("no server value");

//a load the server could not finish still takes its position, so the positions after it line up
const LOAD_FAILED_ON_SERVER: unique symbol = Symbol("load failed on server");

const LOAD_ARGUMENTS_MESSAGE = libraryMessage(
	'load() takes a fetcher, or a string key and then a fetcher: load(() => fetchData()) or load("name", () => fetchData())',
);

const BROWSER_REACHED_MORE_LOADS_MESSAGE =
	'the browser reached a load() the server did not reach before its first paint, so the two took different branches. Give the load() calls in that branch a key: load("name", () => …)';

export interface RecordedLoad {
	readonly key: string | undefined;
	readonly serialized: string | typeof LOAD_FAILED_ON_SERVER;
}

const isKeyRecorded = (recordedLoads: ReadonlyArray<RecordedLoad>, key: string): boolean => {
	for (let index = 0; index < recordedLoads.length; index++) {
		if (recordedLoads[index].key === key) return true;
	}
	return false;
};

export const flushHostPayload = (
	recordedLoads: Array<RecordedLoad>,
	shadowRoot: ShadowRoot,
): void => {
	const ownerDocument = shadowRoot.ownerDocument;
	for (let index = 0; index < recordedLoads.length; index++) {
		const recordedLoad = recordedLoads[index];
		const script = ownerDocument.createElement("script");
		script.setAttribute("type", "application/json");
		script.setAttribute(SSR_ATTRIBUTE, "");
		if (recordedLoad.key !== undefined) script.setAttribute(KEY_ATTRIBUTE, recordedLoad.key);
		if (recordedLoad.serialized === LOAD_FAILED_ON_SERVER) {
			script.setAttribute(FAILED_ATTRIBUTE, "");
		} else script.textContent = recordedLoad.serialized.replace(ANGLE_BRACKET, "\\u003c");
		shadowRoot.appendChild(script);
	}
	recordedLoads.length = 0;
};

//depth one, walked rather than selected because a ShadowRoot is never a :scope match: every payload
//is a direct child, and a <script data-ssr> the component painted itself must not be claimed
const findPayloadScript = (shadowRoot: ShadowRoot, key: string | undefined): Element | null => {
	const selector =
		key === undefined
			? POSITIONAL_SELECTOR
			: `script[${SSR_ATTRIBUTE}][${KEY_ATTRIBUTE}="${CSS.escape(key)}"]`;
	const children = shadowRoot.children;
	for (let index = 0; index < children.length; index++) {
		if (children[index].matches(selector)) return children[index];
	}
	return null;
};

const claimServerValue = (shadowRoot: ShadowRoot, key: string | undefined): unknown => {
	const script = findPayloadScript(shadowRoot, key);
	if (script === null) {
		//a missing key is a branch the server did not take; a missing position is a shift
		if (key === undefined) warnDuringDevelopment(BROWSER_REACHED_MORE_LOADS_MESSAGE);
		return NO_SERVER_VALUE;
	}
	script.remove();
	if (script.hasAttribute(FAILED_ATTRIBUTE)) return NO_SERVER_VALUE;
	return JSON.parse(script.textContent || "null");
};

//runs at the hydrating paint, after which nothing claims: a leftover could only ever be stale
export const releaseUnclaimedPayloads = (shadowRoot: ShadowRoot): void => {
	const children = shadowRoot.children;
	let positionalLeftoverCount = 0;
	for (let index = children.length - 1; index >= 0; index--) {
		const child = children[index];
		if (!child.matches(ANY_PAYLOAD_SELECTOR)) continue;
		if (!child.hasAttribute(KEY_ATTRIBUTE)) positionalLeftoverCount++;
		child.remove();
	}
	if (positionalLeftoverCount === 0) return;
	warnDuringDevelopment(
		`${positionalLeftoverCount} load() result(s) from the server went unused while hydrating: the server reached a load() the browser did not, so the two took different branches. Give the load() calls in that branch a key: load("name", () => …)`,
	);
};

const DESCRIPTION_BY_TYPE: Partial<Record<string, string>> = {
	bigint: "a bigint: return a string and convert it after the load",
	symbol: "a symbol: return a string instead",
	function: "a function: return data, not code",
};

const DESCRIPTION_BY_CLASS_NAME: Partial<Record<string, string>> = {
	Response: "a Response: return response.json() instead",
	Promise: "a promise: await it inside the fetcher",
	Date: "a Date: return the string and turn it into a Date after the load",
};

//null for a value JSON carries as it is, and for plain data the walk looks into
const describeNonPlainValue = (value: unknown): string | null => {
	if (typeof value === "number") {
		return Number.isFinite(value) ? null : `${value}: return null or a string instead`;
	}
	const typeDescription = DESCRIPTION_BY_TYPE[typeof value];
	if (typeDescription !== undefined) return typeDescription;
	if (typeof value !== "object" || value === null) return null;
	if (isTemplate(value)) {
		return "a template: yield the template itself to paint it, or yield function* view() { … } to paint on every update";
	}
	if (Object.prototype.toString.call(value) === "[object Module]") {
		return "a module: yield the import() promise itself, so the browser loads the module too";
	}
	const prototype = Object.getPrototypeOf(value);
	if (Array.isArray(value) || prototype === Object.prototype || prototype === null) return null;
	const className = value.constructor?.name ?? "a class";
	return (
		DESCRIPTION_BY_CLASS_NAME[className] ??
		`an instance of ${className}: return a plain object or array`
	);
};

const describeUnreplayableValue = (
	value: unknown,
	path: string,
	ancestors: Array<object>,
): string | null => {
	const description = describeNonPlainValue(value);
	if (description !== null) return `${path} is ${description}`;
	if (typeof value !== "object" || value === null) return null;
	if (ancestors.includes(value)) {
		return `${path} points back at an object that holds it, a cycle JSON cannot carry: leave that reference out`;
	}
	if (ancestors.length === PLAIN_DATA_DEPTH_LIMIT) {
		return `${path} is nested deeper than ${PLAIN_DATA_DEPTH_LIMIT} levels: return flatter data`;
	}
	//a problem ends the whole walk, so only a finished walk needs the pop
	ancestors.push(value);
	const entries = Object.entries(value);
	for (let index = 0; index < entries.length; index++) {
		const [name, entry] = entries[index];
		const entryPath = Array.isArray(value) ? `${path}[${name}]` : `${path}.${name}`;
		const problem = describeUnreplayableValue(entry, entryPath, ancestors);
		if (problem !== null) return problem;
	}
	ancestors.pop();
	return null;
};

//JSON is how a prerendered page hands the result to the browser
const ensurePlainData = (value: unknown): void => {
	const problem = describeUnreplayableValue(value, "its result", []);
	if (problem === null) return;
	throw new Error(
		libraryMessage(
			`load() takes a fetcher that returns plain data, because a prerendered page sends that data to the browser as JSON, but ${problem}`,
		),
	);
};

//a generator, so `yield* load(…)` takes the fetcher's type and a throw surfaces there; a run torn
//down while it waits is never resumed, so its late result cannot take a position
function* loadSteps(
	key: string | undefined,
	fetcher: () => unknown,
): Generator<LoadRequest | Promise<unknown>, unknown, unknown> {
	//the driver resumes the request with the runner of the component that yielded it
	const runner = (yield LOAD_REQUEST) as ComponentRunner;
	const root = runner.root;
	if (!runner.wasMountedOnServer) {
		const serverValue = root.isHydrationPending
			? claimServerValue(root.shadowRoot, key)
			: NO_SERVER_VALUE;
		if (serverValue !== NO_SERVER_VALUE) return serverValue;
		const loaded = fetcher();
		const value = loaded instanceof Promise ? yield loaded : loaded;
		//the template check is one property read, so every build makes it; the full walk is for development
		if (isDevelopmentBuild || isTemplate(value)) ensurePlainData(value);
		return value;
	}
	const recordedLoads = runner.loadsRecordedOnServer;
	if (key !== undefined && isKeyRecorded(recordedLoads, key)) {
		throw new Error(
			libraryMessage(
				`two load() calls in <${root.host.localName}> use the key "${key}". Give each its own key, for example load(\`${key}-\${id}\`, …)`,
			),
		);
	}
	let value: unknown;
	try {
		const loaded = fetcher();
		value = loaded instanceof Promise ? yield loaded : loaded;
		ensurePlainData(value);
	} catch (error) {
		recordedLoads.push({ key, serialized: LOAD_FAILED_ON_SERVER });
		throw error;
	}
	//JSON.stringify(undefined) returns undefined, not a string; the browser parses "null" back
	recordedLoads.push({ key, serialized: JSON.stringify(value) ?? "null" });
	return value;
}

export function load<Value>(
	fetcher: () => Value,
): Generator<LoadRequest | Promise<unknown>, Awaited<Value>, unknown>;
export function load<Value>(
	key: string,
	fetcher: () => Value,
): Generator<LoadRequest | Promise<unknown>, Awaited<Value>, unknown>;
export function load(
	keyOrFetcher: string | (() => unknown),
	keyedFetcher?: () => unknown,
): Generator<LoadRequest | Promise<unknown>, unknown, unknown> {
	const isPositionalCall = typeof keyOrFetcher === "function" && keyedFetcher === undefined;
	if (isPositionalCall) return loadSteps(undefined, keyOrFetcher);
	const isKeyedCall = typeof keyOrFetcher === "string" && typeof keyedFetcher === "function";
	if (isKeyedCall) return loadSteps(keyOrFetcher, keyedFetcher);
	throw new TypeError(LOAD_ARGUMENTS_MESSAGE);
}
