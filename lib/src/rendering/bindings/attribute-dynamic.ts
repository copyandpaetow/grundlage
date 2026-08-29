import {
	assertPrimitiveString,
	isPlainObject,
	isStringable,
} from "../../utils/guards";
import { hashValue } from "../../utils/hashing";
import { hasHashChanged } from "../compose";
import { applyAttributeValue, isDeclaredPropName } from "./attribute-write";
import { AppliedAttribute, DynamicAttributeLiveBinding } from "./types";

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
			applyAttributeValue(element, name, null, prev.value);
			applied.delete(name);
		}
	for (const [name, newValue] of desired) {
		const hash = hashValue(newValue);
		const prev = applied.get(name);
		if (prev === undefined) {
			applyAttributeValue(element, name, newValue);
			applied.set(name, { value: newValue, hash });
		} else if (prev.hash !== hash) {
			applyAttributeValue(element, name, newValue, prev.value);
			prev.value = newValue;
			prev.hash = hash;
		}
	}
};

export const commitDynamic = (
	liveBinding: DynamicAttributeLiveBinding,
	values: Array<unknown>,
): void => {
	const value = values[liveBinding.staticBinding.valueIndex];
	if (!hasHashChanged(liveBinding, hashValue(value))) return;
	const element = liveBinding.anchor;
	applyAttributeMap(
		element,
		liveBinding.appliedAttributes,
		normalizeToAttributeMap(value),
	);
};

export const reapplyOnSwap = (
	liveBinding: DynamicAttributeLiveBinding,
	element: Element,
): void => {
	for (const [name, entry] of liveBinding.appliedAttributes) {
		//a declared prop is reassigned even when stringable: reflection spells a value out, it does
		//not preserve it
		const isCarriedByMarkup =
			isStringable(entry.value) && !isDeclaredPropName(element, name);
		if (!isCarriedByMarkup) applyAttributeValue(element, name, entry.value);
	}
};
