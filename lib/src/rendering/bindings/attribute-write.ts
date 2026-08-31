import { MARKUP } from "../../parser/chars";
import { isStringable } from "../../utils/guards";
import { ValueOf } from "../../utils/types";
import { ATTRIBUTE_MODE } from "../constants";
import { markDeferredHydration } from "../defer-hydration";
import { triggerComponentUpdate } from "../dom";

export const resolveAttributeMode = (
	value: unknown,
): ValueOf<typeof ATTRIBUTE_MODE> => {
	if (value === null || value === undefined || value === false)
		return ATTRIBUTE_MODE.ABSENT;
	if (isStringable(value)) return ATTRIBUTE_MODE.ATTRIBUTE;
	return ATTRIBUTE_MODE.PROPERTY;
};

const NO_DECLARED_PROP_NAMES: ReadonlySet<string> = new Set();

//customElements.define throws on redefinition, so a definition that exists is permanent and so is
//the answer it gives. An element with no definition yet is never cached: define() can still happen
const declaredPropNamesByLocalName = new Map<string, ReadonlySet<string>>();

export const isDeclaredPropName = (element: Element, name: string): boolean => {
	const localName = element.localName;
	if (!localName.includes("-")) return false;
	const cached = declaredPropNamesByLocalName.get(localName);
	if (cached !== undefined) return cached.has(name);
	const definition = customElements.get(localName) as
		| (CustomElementConstructor & { declaredPropNames?: ReadonlySet<string> })
		| undefined;
	if (definition === undefined) return false;
	const declaredPropNames =
		definition.declaredPropNames ?? NO_DECLARED_PROP_NAMES;
	declaredPropNamesByLocalName.set(localName, declaredPropNames);
	return declaredPropNames.has(name);
};

export const isAwaitingDefinition = (element: Element): boolean =>
	element.localName.includes("-") &&
	customElements.get(element.localName) === undefined;

export const assignDeclaredProp = (
	element: Element,
	propName: string,
	value: unknown,
): void => {
	(element as unknown as Record<string, unknown>)[propName] = value;
};

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

const clearPropertyChannel = (element: Element, key: string): void => {
	if (!Object.hasOwn(element, key)) return;
	delete (element as unknown as Record<string, unknown>)[key];
	triggerComponentUpdate(element);
};

export const applyAttributeValue = (
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
		case ATTRIBUTE_MODE.ATTRIBUTE: {
			clearPropertyChannel(element, key);
			const attributeValue = String(value);
			if (element.getAttribute(key) !== attributeValue)
				element.setAttribute(key, attributeValue);
			return;
		}
		case ATTRIBUTE_MODE.PROPERTY:
			element.removeAttribute(key);
			(element as unknown as Record<string, unknown>)[key] = value;
			triggerComponentUpdate(element);
			return markDeferredHydration(element, valueChannel);
	}
};
