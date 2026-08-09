import { combineOrderedHash, hashValue } from "../../utils/hashing";
import { isStringable } from "../../utils/guards";
import { SingleValueAttributeStaticBinding } from "../../parser/types";
import { combinedPartsHash, composeParts, hasHashChanged } from "../compose";
import { ValueOf } from "../../utils/types";
import { ATTRIBUTE_MODE } from "../constants";
import { triggerComponentUpdate, resolveTargetElement } from "../dom";
import { SingleValueAttributeLiveBinding } from "./types";

const singleValueGateHash = (
	staticBinding: SingleValueAttributeStaticBinding,
	values: Array<unknown>,
): number =>
	combineOrderedHash(
		combinedPartsHash(staticBinding.nameParts, values),
		hashValue(values[staticBinding.valueIndex]),
	);

export const resolveAttributeMode = (
	value: unknown,
): ValueOf<typeof ATTRIBUTE_MODE> => {
	if (value === null || value === undefined || value === false)
		return ATTRIBUTE_MODE.ABSENT;
	if (isStringable(value)) return ATTRIBUTE_MODE.ATTRIBUTE;
	return ATTRIBUTE_MODE.PROPERTY;
};

//the definition, not the instance: a fragment's elements upgrade on insertion, so a binding
//routinely commits against a child that has not upgraded yet
export const isDeclaredPropName = (element: Element, name: string): boolean => {
	if (!element.localName.includes("-")) return false;
	const definition = customElements.get(element.localName) as
		| (CustomElementConstructor & { declaredPropNames?: ReadonlySet<string> })
		| undefined;
	return definition?.declaredPropNames?.has(name) ?? false;
};

export const isAwaitingDefinition = (element: Element): boolean =>
	element.localName.includes("-") &&
	customElements.get(element.localName) === undefined;

//before upgrade there is no accessor, so this lands as an own property that
//recoverPreUpgradeAssignments runs back through the setter at mount
export const assignDeclaredProp = (
	element: Element,
	propName: string,
	value: unknown,
): void => {
	(element as unknown as Record<string, unknown>)[propName] = value;
};

export const clearAppliedAttribute = (
	element: Element,
	liveBinding: SingleValueAttributeLiveBinding,
): void => {
	switch (liveBinding.appliedAttributeMode) {
		case ATTRIBUTE_MODE.ATTRIBUTE:
			element.removeAttribute(liveBinding.lastComposedName);
			break;
		case ATTRIBUTE_MODE.PROPERTY:
			delete (element as unknown as Record<string, unknown>)[
				liveBinding.lastComposedName
			];
			triggerComponentUpdate(element);
			break;
		case ATTRIBUTE_MODE.DECLARED_PROP:
			assignDeclaredProp(element, liveBinding.lastComposedName, null);
			break;
	}
	liveBinding.appliedAttributeMode = ATTRIBUTE_MODE.ABSENT;
};

export const commitSingleValue = (
	liveBinding: SingleValueAttributeLiveBinding,
	values: Array<unknown>,
): void => {
	const { nameParts, valueIndex } = liveBinding.staticBinding;
	const value = values[valueIndex];
	if (
		!hasHashChanged(
			liveBinding,
			singleValueGateHash(liveBinding.staticBinding, values),
		)
	)
		return;

	const element = resolveTargetElement(liveBinding);
	const name = composeParts(nameParts, values);
	if (name !== liveBinding.lastComposedName) {
		clearAppliedAttribute(element, liveBinding);
		liveBinding.lastComposedName = name;
	}

	const nextAttributeMode = isDeclaredPropName(element, name)
		? ATTRIBUTE_MODE.DECLARED_PROP
		: resolveAttributeMode(value);
	if (nextAttributeMode !== liveBinding.appliedAttributeMode)
		clearAppliedAttribute(element, liveBinding);
	switch (nextAttributeMode) {
		case ATTRIBUTE_MODE.ABSENT:
			if (value === false && isAwaitingDefinition(element))
				(element as unknown as Record<string, unknown>)[name] = false;
			break;
		case ATTRIBUTE_MODE.ATTRIBUTE: {
			const stringValue = String(value);
			if (element.getAttribute(name) !== stringValue)
				element.setAttribute(name, stringValue);
			break;
		}
		case ATTRIBUTE_MODE.PROPERTY:
			(element as unknown as Record<string, unknown>)[name] = value;
			triggerComponentUpdate(element);
			break;
		case ATTRIBUTE_MODE.DECLARED_PROP:
			assignDeclaredProp(element, name, value);
			break;
	}
	liveBinding.appliedAttributeMode = nextAttributeMode;
};

export const hydrateSingleValue = (
	liveBinding: SingleValueAttributeLiveBinding,
	values: Array<unknown>,
): void => {
	const { nameParts, valueIndex } = liveBinding.staticBinding;
	const value = values[valueIndex];
	const name = composeParts(nameParts, values);
	const element = resolveTargetElement(liveBinding);
	const mode = isDeclaredPropName(element, name)
		? ATTRIBUTE_MODE.DECLARED_PROP
		: resolveAttributeMode(value);
	liveBinding.lastComposedName = name;
	liveBinding.appliedAttributeMode = mode;
	liveBinding.lastValueHash = singleValueGateHash(
		liveBinding.staticBinding,
		values,
	);
	if (mode === ATTRIBUTE_MODE.PROPERTY) {
		(element as unknown as Record<string, unknown>)[name] = value;
		triggerComponentUpdate(element);
	}
	//the value the binding holds, not the spelling the server wrote
	if (mode === ATTRIBUTE_MODE.DECLARED_PROP)
		assignDeclaredProp(element, name, value);
};

//the mode is recomputed rather than carried over: the new element may be defined where the old
//one was not
export const reapplyOnSwap = (
	liveBinding: SingleValueAttributeLiveBinding,
	element: Element,
	values: Array<unknown>,
): void => {
	const name = liveBinding.lastComposedName;
	const value = values[liveBinding.staticBinding.valueIndex];
	if (isDeclaredPropName(element, name))
		return assignDeclaredProp(element, name, value);
	if (resolveAttributeMode(value) !== ATTRIBUTE_MODE.PROPERTY) return;
	(element as unknown as Record<string, unknown>)[name] = value;
	triggerComponentUpdate(element);
};
