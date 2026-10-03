import { MARKUP } from "../../parser/characters";
import { warnDuringDevelopment } from "../../utils/diagnostics";
import { isStringable } from "../../utils/guards";
import { ValueOf } from "../../utils/types";
import { ATTRIBUTE_MODE } from "../constants";
import { markDeferredHydration } from "../defer-hydration";
import { triggerComponentUpdate } from "../dom";

const attributeModeOf = (value: unknown): ValueOf<typeof ATTRIBUTE_MODE> => {
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

const NO_EVENT_NAME: unique symbol = Symbol("not an event");

//the one place that knows a key parsed as a native handler and found no property to bind it to, so
//the warning belongs here rather than at the call site that would have to ask all of it again
const eventNameOf = (
	key: string,
	element: Element,
	value: unknown,
): string | typeof NO_EVENT_NAME => {
	if (!key.startsWith(MARKUP.EVENT_PREFIX)) return NO_EVENT_NAME;
	if (key.startsWith(MARKUP.CUSTOM_EVENT_PREFIX))
		return key.slice(MARKUP.CUSTOM_EVENT_PREFIX.length).toLowerCase();
	const lowercaseKey = key.toLowerCase();
	if (lowercaseKey in element)
		return lowercaseKey.slice(MARKUP.EVENT_PREFIX.length);
	if (typeof value === "function")
		warnDuringDevelopment(
			`"${key}" looks like an event handler but "${lowercaseKey}" is not a property of <${element.localName}> — the function was assigned as a dead property and will never fire. Check the spelling, or use "on-${key.slice(MARKUP.EVENT_PREFIX.length).toLowerCase()}" to bind it as a custom event.`,
		);
	return NO_EVENT_NAME;
};

//once the user has interacted, the attribute is only the default (`defaultValue`, `defaultChecked`,
//`defaultSelected`) and the property is what is shown; elsewhere these names reflect, and attributes do
export const isLiveStatePropertyOf = (
	element: Element,
	key: string,
): boolean => {
	switch (key) {
		case "value":
			return (
				element instanceof HTMLInputElement ||
				element instanceof HTMLTextAreaElement
			);
		case "checked":
		case "indeterminate":
			return element instanceof HTMLInputElement;
		case "selected":
			return element instanceof HTMLOptionElement;
		default:
			return false;
	}
};

//absence empties what is shown and leaves the default alone, the way removing the attribute does
//before the user interacts
const emptyLiveStateOf = (key: string): string | boolean =>
	key === "value" ? "" : false;

export const applyLiveState = (
	element: Element,
	key: string,
	value: unknown,
): void => {
	const isAbsent = value === null || value === undefined || value === false;
	const shown = isAbsent ? emptyLiveStateOf(key) : value;
	//Element has no index signature; the live state is read and written by its IDL name
	const record = element as unknown as Record<string, unknown>;
	if (record[key] !== shown) record[key] = shown;
};

//a textarea's default is its text, not an attribute: the markup a server sends carries it there too
export const applyLiveStateDefault = (
	element: Element,
	key: string,
	value: unknown,
): void => {
	if (!(element instanceof HTMLTextAreaElement)) {
		applyAttributeValue(element, key, value);
		return;
	}
	const isAbsent = value === null || value === undefined || value === false;
	if (isAbsent) return;
	const text = String(value);
	if (element.defaultValue !== text) element.defaultValue = text;
};

//Element has no index signature; props are read and written by their runtime name
const clearPropertyValue = (element: Element, key: string): void => {
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
	const attributeMode = attributeModeOf(value);

	//ahead of the event check: that one takes any key starting with "on" as a native handler once
	//`key in element` is true, which a prop's own accessor makes true. A prop named `once` would
	//add a listener for "ce" instead of being assigned
	if (isDeclaredPropName(element, key)) {
		(element as unknown as Record<string, unknown>)[key] = value;
		markDeferredHydration(element, attributeMode);
		return;
	}

	const listenerName = eventNameOf(key, element, value);
	if (listenerName !== NO_EVENT_NAME) {
		if (typeof oldValue === "function")
			element.removeEventListener(listenerName, oldValue as EventListener);
		if (typeof value === "function")
			element.addEventListener(listenerName, value as EventListener);
		return;
	}

	switch (attributeMode) {
		case ATTRIBUTE_MODE.ABSENT:
			clearPropertyValue(element, key);
			element.removeAttribute(key);
			//until the element is defined, a missing attribute reads as absence, which `[Boolean, true]`
			//resolves to true; the own property carries the false across the upgrade
			const mustCarryFalseAcrossUpgrade =
				value === false && isAwaitingDefinition(element);
			if (mustCarryFalseAcrossUpgrade)
				(element as unknown as Record<string, unknown>)[key] = false;
			break;
		case ATTRIBUTE_MODE.ATTRIBUTE: {
			clearPropertyValue(element, key);
			const attributeValue = String(value);
			if (element.getAttribute(key) !== attributeValue)
				element.setAttribute(key, attributeValue);
			break;
		}
		case ATTRIBUTE_MODE.PROPERTY:
			element.removeAttribute(key);
			(element as unknown as Record<string, unknown>)[key] = value;
			triggerComponentUpdate(element);
			markDeferredHydration(element, attributeMode);
			break;
		default:
			return attributeMode satisfies never;
	}
};

//a tag swap's clone keeps every attribute, so only what never was one is written again: a
//property, a listener, a declared prop, which reflection spells out rather than preserves, or live state
export const reapplyValueOnSwap = (
	element: Element,
	key: string,
	value: unknown,
): void => {
	if (isLiveStatePropertyOf(element, key)) {
		applyLiveState(element, key, value);
		return;
	}
	const isCarriedByClonedMarkup =
		isStringable(value) && !isDeclaredPropName(element, key);
	if (!isCarriedByClonedMarkup) applyAttributeValue(element, key, value);
};
