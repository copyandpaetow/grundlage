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

	const nextAttributeMode = resolveAttributeMode(value);
	if (nextAttributeMode !== liveBinding.appliedAttributeMode)
		clearAppliedAttribute(element, liveBinding);
	switch (nextAttributeMode) {
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
	const mode = resolveAttributeMode(value);
	liveBinding.lastComposedName = name;
	liveBinding.appliedAttributeMode = mode;
	liveBinding.lastValueHash = singleValueGateHash(
		liveBinding.staticBinding,
		values,
	);
	if (mode === ATTRIBUTE_MODE.PROPERTY) {
		const element = resolveTargetElement(liveBinding);
		(element as unknown as Record<string, unknown>)[name] = value;
		triggerComponentUpdate(element);
	}
};

export const reapplyOnSwap = (
	liveBinding: SingleValueAttributeLiveBinding,
	element: Element,
	values: Array<unknown>,
): void => {
	if (liveBinding.appliedAttributeMode !== ATTRIBUTE_MODE.PROPERTY) return;
	const value = values[liveBinding.staticBinding.valueIndex];
	(element as unknown as Record<string, unknown>)[
		liveBinding.lastComposedName
	] = value;
	triggerComponentUpdate(element);
};
