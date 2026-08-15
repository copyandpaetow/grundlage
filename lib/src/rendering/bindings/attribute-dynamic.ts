import { MARKUP } from "../../parser/chars";
import { hashValue } from "../../utils/hashing";
import {
	assertPrimitiveString,
	isPlainObject,
	isStringable,
} from "../../utils/guards";
import { hasHashChanged } from "../compose";
import { ATTRIBUTE_MODE } from "../constants";
import { markDeferredHydration } from "../defer-hydration";
import { triggerComponentUpdate, resolveTargetElement } from "../dom";
import {
	assignDeclaredProp,
	isAwaitingDefinition,
	isDeclaredPropName,
	resolveAttributeMode,
} from "./attribute-single-value";
import { AppliedAttribute, DynamicAttributeLiveBinding } from "./types";

const resolveEventNameFromKey = (
	key: string,
	element: Element,
): string | null => {
	if (!key.startsWith(MARKUP.EVENT_PREFIX)) return null;
	if (key.startsWith(MARKUP.CUSTOM_EVENT_PREFIX))
		return key.slice(MARKUP.CUSTOM_EVENT_PREFIX.length).toLowerCase();
	const lowerKey = key.toLowerCase();
	return lowerKey in element
		? lowerKey.slice(MARKUP.EVENT_PREFIX.length)
		: null;
};

const warnIfDeadNativeHandler = (key: string, element: Element): void => {
	if (
		!key.startsWith(MARKUP.EVENT_PREFIX) ||
		key.startsWith(MARKUP.CUSTOM_EVENT_PREFIX)
	)
		return;
	const lowerKey = key.toLowerCase();
	if (lowerKey in element) return;
	console.warn(
		`grundlage: "${key}" looks like an event handler but "${lowerKey}" is not a property of <${element.localName}> — the function was assigned as a dead property and will never fire. Check the spelling, or use "on-${key.slice(2).toLowerCase()}" to bind it as a custom event.`,
	);
};

//which channel holds the value is read off the element, so the two-argument setProp(name, value)
//clears as reliably as a caller that tracked an oldValue
const clearPropertyChannel = (element: Element, key: string): void => {
	if (!Object.hasOwn(element, key)) return;
	delete (element as unknown as Record<string, unknown>)[key];
	triggerComponentUpdate(element);
};

export const applyDynamicAttribute = (
	element: Element,
	key: string,
	value: unknown,
	oldValue?: unknown,
): void => {
	const valueChannel = resolveAttributeMode(value);

	//ahead of the event check: that one takes any key starting with "on" as a native handler once
	//`key in element` is true, which a prop's own accessor makes true. A prop named `once` would
	//add a listener for "ce" instead of being assigned
	if (isDeclaredPropName(element, key)) {
		assignDeclaredProp(element, key, value);
		return markDeferredHydration(element, valueChannel);
	}

	const listenerName = resolveEventNameFromKey(key, element);
	if (listenerName !== null) {
		if (typeof oldValue === "function")
			element.removeEventListener(listenerName, oldValue as EventListener);
		if (typeof value === "function")
			element.addEventListener(listenerName, value as EventListener);
		return;
	}

	if (typeof value === "function") warnIfDeadNativeHandler(key, element);

	switch (valueChannel) {
		case ATTRIBUTE_MODE.ABSENT:
			clearPropertyChannel(element, key);
			element.removeAttribute(key);
			if (value === false && isAwaitingDefinition(element))
				(element as unknown as Record<string, unknown>)[key] = false;
			return;
		case ATTRIBUTE_MODE.ATTRIBUTE:
			clearPropertyChannel(element, key);
			element.setAttribute(key, String(value));
			return;
		case ATTRIBUTE_MODE.PROPERTY:
			//a stringable → object switch would otherwise leave both channels populated and the
			//reader takes the stale attribute
			element.removeAttribute(key);
			(element as unknown as Record<string, unknown>)[key] = value;
			triggerComponentUpdate(element);
			return markDeferredHydration(element, valueChannel);
	}
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
	const element = resolveTargetElement(liveBinding);
	applyAttributeMap(
		element,
		liveBinding.appliedAttributes,
		normalizeToAttributeMap(value),
	);
};

export const hydrateDynamic = (
	liveBinding: DynamicAttributeLiveBinding,
	values: Array<unknown>,
): void => {
	const value = values[liveBinding.staticBinding.valueIndex];
	liveBinding.lastValueHash = hashValue(value);
	liveBinding.appliedAttributes = snapshotAttributeMap(
		normalizeToAttributeMap(value),
	);
	//server HTML carries only attributes; handlers, property-mode values and declared props are
	//attached to the hydrated element here, the same set a tag swap reapplies
	reapplyOnSwap(liveBinding, resolveTargetElement(liveBinding), values);
};

export const reapplyOnSwap = (
	liveBinding: DynamicAttributeLiveBinding,
	element: Element,
	_values: Array<unknown>,
): void => {
	for (const [name, entry] of liveBinding.appliedAttributes) {
		//a declared prop is reassigned even when stringable: reflection spells a value out, it does
		//not preserve it
		const isCarriedByMarkup =
			isStringable(entry.value) && !isDeclaredPropName(element, name);
		if (!isCarriedByMarkup) applyDynamicAttribute(element, name, entry.value);
	}
};
