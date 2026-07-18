import { hashValue } from "../../utils/hashing";
import {
	assertPrimitiveString,
	isPlainObject,
	isStringable,
} from "../../utils/guards";
import { hasHashChanged } from "../compose";
import { nudgeComponent, targetElement } from "../dom";
import { AppliedAttribute, DynamicAttributeLiveBinding } from "./types";

const CHAR_LOWER_O = 111;
const CHAR_LOWER_N = 110;
const CHAR_DASH = 45;

const resolveEventNameFromKey = (
	key: string,
	element: Element,
): string | null => {
	if (key.charCodeAt(0) !== CHAR_LOWER_O || key.charCodeAt(1) !== CHAR_LOWER_N)
		return null;
	if (key.charCodeAt(2) === CHAR_DASH) return key.slice(3).toLowerCase();
	const lowerKey = key.toLowerCase();
	return lowerKey in element ? lowerKey.slice(2) : null;
};

const warnIfDeadNativeHandler = (key: string, element: Element): void => {
	if (key.charCodeAt(0) !== CHAR_LOWER_O || key.charCodeAt(1) !== CHAR_LOWER_N)
		return;
	if (key.charCodeAt(2) === CHAR_DASH) return;
	const lowerKey = key.toLowerCase();
	if (lowerKey in element) return;
	console.warn(
		`grundlage: "${key}" looks like an event handler but "${lowerKey}" is not a property of <${element.localName}> — the function was assigned as a dead property and will never fire. Check the spelling, or use "on-${key.slice(2).toLowerCase()}" to bind it as a custom event.`,
	);
};

export const applyDynamicAttribute = (
	element: Element,
	key: string,
	value: unknown,
	oldValue?: unknown,
): void => {
	const listenerName = resolveEventNameFromKey(key, element);
	if (listenerName !== null) {
		if (typeof oldValue === "function")
			element.removeEventListener(listenerName, oldValue as EventListener);
		if (typeof value === "function")
			element.addEventListener(listenerName, value as EventListener);
		return;
	}

	if (typeof value === "function") warnIfDeadNativeHandler(key, element);

	const clearsProperty = oldValue !== undefined && !isStringable(oldValue);

	if (value === null || value === undefined || value === false) {
		if (clearsProperty) {
			delete (element as unknown as Record<string, unknown>)[key];
			nudgeComponent(element);
		}
		element.removeAttribute(key);
		return;
	}

	if (isStringable(value)) {
		if (clearsProperty)
			delete (element as unknown as Record<string, unknown>)[key];
		element.setAttribute(key, String(value));
		return;
	}

	(element as unknown as Record<string, unknown>)[key] = value;
	nudgeComponent(element);
};

export const normalizeToAttributeMap = (
	value: unknown,
): Map<string, unknown> => {
	const map = new Map<string, unknown>();
	if (Array.isArray(value)) {
		for (let index = 0; index < value.length; index++)
			map.set(assertPrimitiveString(value[index]), "");
	} else if (isPlainObject(value)) {
		for (const name in value) map.set(name, value[name]);
	} else if (value) {
		map.set(assertPrimitiveString(value), "");
	}
	return map;
};

export const applyAttributeMap = (
	element: Element,
	applied: Map<string, AppliedAttribute>,
	desired: Map<string, unknown>,
): void => {
	for (const [name, prev] of applied)
		if (!desired.has(name)) {
			applyDynamicAttribute(element, name, null, prev.value);
			applied.delete(name);
		}
	for (const [name, newValue] of desired) {
		const hash = hashValue(newValue);
		const prev = applied.get(name);
		if (prev === undefined) {
			applyDynamicAttribute(element, name, newValue);
			applied.set(name, { value: newValue, hash });
		} else if (prev.hash !== hash) {
			applyDynamicAttribute(element, name, newValue, prev.value);
			prev.value = newValue;
			prev.hash = hash;
		}
	}
};

const snapshotAttributeMap = (
	desired: Map<string, unknown>,
): Map<string, AppliedAttribute> => {
	const applied = new Map<string, AppliedAttribute>();
	for (const [name, value] of desired)
		applied.set(name, { value, hash: hashValue(value) });
	return applied;
};

export const commitDynamic = (
	liveBinding: DynamicAttributeLiveBinding,
	values: Array<unknown>,
): void => {
	const value = values[liveBinding.staticBinding.valueIndex];
	if (!hasHashChanged(liveBinding, hashValue(value))) return;
	const element = targetElement(liveBinding);
	applyAttributeMap(
		element,
		liveBinding.appliedAttributes,
		normalizeToAttributeMap(value),
	);
};

export const seedDynamic = (
	liveBinding: DynamicAttributeLiveBinding,
	values: Array<unknown>,
): void => {
	const value = values[liveBinding.staticBinding.valueIndex];
	liveBinding.lastValueHash = hashValue(value);
	liveBinding.appliedAttributes = snapshotAttributeMap(
		normalizeToAttributeMap(value),
	);
	//server HTML carries only stringable entries; handlers and property-mode values must be
	//attached to the hydrated element here, the same non-stringable set a tag swap reapplies
	reapplyOnSwap(liveBinding, targetElement(liveBinding), values);
};

export const reapplyOnSwap = (
	liveBinding: DynamicAttributeLiveBinding,
	element: Element,
	_values: Array<unknown>,
): void => {
	for (const [name, entry] of liveBinding.appliedAttributes)
		if (!isStringable(entry.value))
			applyDynamicAttribute(element, name, entry.value);
};
