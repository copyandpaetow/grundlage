import { BaseComponent } from "../types";
import { assertPrimitiveString, isStringable } from "../utils/to-primitive";
import { isPlainObject } from "../utils/validators";

const CHAR_LOWER_O = 111;
const CHAR_LOWER_N = 110;
const CHAR_DASH = 45;

export const nudgeComponent = (element: Element): void => {
	if ("update" in element) (element as BaseComponent).update();
};

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
	const valueIsFunction = typeof value === "function";
	const oldValueIsFunction = typeof oldValue === "function";
	if (valueIsFunction || oldValueIsFunction) {
		const listenerName = resolveEventNameFromKey(key, element);
		if (listenerName !== null) {
			if (oldValueIsFunction)
				element.removeEventListener(listenerName, oldValue as EventListener);
			if (valueIsFunction)
				element.addEventListener(listenerName, value as EventListener);
			return;
		}
		if (valueIsFunction) warnIfDeadNativeHandler(key, element);
	}

	if (value === null || value === undefined || value === false) {
		element.removeAttribute(key);
		return;
	}

	if (isStringable(value)) {
		if (oldValue !== undefined && !isStringable(oldValue))
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
	applied: Map<string, unknown>,
	desired: Map<string, unknown>,
): void => {
	for (const [name, oldValue] of applied)
		if (!desired.has(name)) applyDynamicAttribute(element, name, null, oldValue);
	for (const [name, newValue] of desired) {
		const hadName = applied.has(name);
		const oldValue = applied.get(name);
		if (hadName && oldValue === newValue) continue;
		applyDynamicAttribute(element, name, newValue, oldValue);
	}
};
