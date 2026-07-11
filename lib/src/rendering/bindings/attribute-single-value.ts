import { hashValue } from "../../utils/hashing";
import { isStringable } from "../../utils/guards";
import { combinedPartsHash, composeParts } from "../compose";
import { ATTRIBUTE_MODE, combineOrderedHash } from "../constants";
import { nudgeComponent, targetElement } from "../dom";
import { SingleValueAttributeLiveBinding } from "./types";

export const attributeModeOf = (value: unknown): number => {
	if (value === null || value === undefined || value === false)
		return ATTRIBUTE_MODE.ABSENT;
	if (isStringable(value)) return ATTRIBUTE_MODE.ATTRIBUTE;
	return ATTRIBUTE_MODE.PROPERTY;
};

export const revertAttributeMode = (
	element: Element,
	liveBinding: SingleValueAttributeLiveBinding,
): void => {
	switch (liveBinding.appliedMode) {
		case ATTRIBUTE_MODE.ATTRIBUTE:
			element.removeAttribute(liveBinding.lastComposedName);
			break;
		case ATTRIBUTE_MODE.PROPERTY:
			delete (element as unknown as Record<string, unknown>)[
				liveBinding.lastComposedName
			];
			nudgeComponent(element);
			break;
	}
	liveBinding.appliedMode = ATTRIBUTE_MODE.ABSENT;
};

export const commitSingleValue = (
	liveBinding: SingleValueAttributeLiveBinding,
	values: Array<unknown>,
): void => {
	const { nameParts, valueIndex } = liveBinding.staticBinding;
	const value = values[valueIndex];
	const valueHash = combineOrderedHash(
		combinedPartsHash(nameParts, values),
		hashValue(value),
	);
	if (valueHash === liveBinding.valueHash) return;
	liveBinding.valueHash = valueHash;

	const element = targetElement(liveBinding);
	const name = composeParts(nameParts, values);
	if (name !== liveBinding.lastComposedName) {
		revertAttributeMode(element, liveBinding);
		liveBinding.lastComposedName = name;
	}

	const nextMode = attributeModeOf(value);
	if (nextMode !== liveBinding.appliedMode)
		revertAttributeMode(element, liveBinding);
	switch (nextMode) {
		case ATTRIBUTE_MODE.ATTRIBUTE: {
			const stringValue = String(value);
			if (element.getAttribute(name) !== stringValue)
				element.setAttribute(name, stringValue);
			break;
		}
		case ATTRIBUTE_MODE.PROPERTY:
			(element as unknown as Record<string, unknown>)[name] = value;
			nudgeComponent(element);
			break;
	}
	liveBinding.appliedMode = nextMode;
};

export const seedOrCommitSingleValue = (
	liveBinding: SingleValueAttributeLiveBinding,
	values: Array<unknown>,
): void => {
	const { nameParts, valueIndex } = liveBinding.staticBinding;
	const value = values[valueIndex];
	const name = composeParts(nameParts, values);
	const mode = attributeModeOf(value);
	liveBinding.lastComposedName = name;
	liveBinding.appliedMode = mode;
	liveBinding.valueHash = combineOrderedHash(
		combinedPartsHash(nameParts, values),
		hashValue(value),
	);
	if (mode === ATTRIBUTE_MODE.PROPERTY) {
		const element = targetElement(liveBinding);
		(element as unknown as Record<string, unknown>)[name] = value;
		nudgeComponent(element);
	}
};

export const reapplyOnSwap = (
	liveBinding: SingleValueAttributeLiveBinding,
	element: Element,
	values: Array<unknown>,
): void => {
	if (liveBinding.appliedMode !== ATTRIBUTE_MODE.PROPERTY) return;
	const value = values[liveBinding.staticBinding.valueIndex];
	(element as unknown as Record<string, unknown>)[liveBinding.lastComposedName] =
		value;
	nudgeComponent(element);
};
