import { combinedPartsHash, composeParts } from "../compose";
import { combineOrderedHash } from "../../utils/hashing";
import { AttributeStaticBinding, Part } from "../../parser/types";
import { applyAttributeValue } from "./attribute-write";
import { NO_ATTRIBUTE_WRITTEN } from "../constants";
import { AttributeLiveBinding } from "./types";

//one hole is the whole value and keeps its type; any text around a hole makes a string
export const isSingleHoleValue = (
	valueParts: ReadonlyArray<Part>,
): valueParts is readonly [number] =>
	valueParts.length === 1 && typeof valueParts[0] === "number";

const attributeGateHash = (
	staticBinding: AttributeStaticBinding,
	values: Array<unknown>,
): number =>
	combineOrderedHash(
		combinedPartsHash(staticBinding.nameParts, values),
		combinedPartsHash(staticBinding.valueParts, values),
	);

export const removeWrittenAttribute = (
	liveBinding: AttributeLiveBinding,
	name: string,
): void => {
	if (isSingleHoleValue(liveBinding.staticBinding.valueParts))
		applyAttributeValue(liveBinding.anchor, name, null, liveBinding.lastValue);
	else liveBinding.anchor.removeAttribute(name);
};

export const commitAttribute = (
	liveBinding: AttributeLiveBinding,
	values: Array<unknown>,
): void => {
	const hash = attributeGateHash(liveBinding.staticBinding, values);
	if (hash === liveBinding.lastValueHash) return;
	liveBinding.lastValueHash = hash;
	const { nameParts, valueParts } = liveBinding.staticBinding;
	const element = liveBinding.anchor;
	const name = composeParts(nameParts, values);
	const keepsTheSameName = name === liveBinding.lastComposedName;

	const leavesAStaleAttribute =
		!keepsTheSameName && liveBinding.lastComposedName !== NO_ATTRIBUTE_WRITTEN;
	if (leavesAStaleAttribute)
		removeWrittenAttribute(liveBinding, liveBinding.lastComposedName);
	liveBinding.lastComposedName = name;

	//applyAttributeValue would read `onclick="alert(${x})"` as an event, find a string instead of a
	//function, and write nothing
	if (!isSingleHoleValue(valueParts)) {
		const composedValue = composeParts(valueParts, values);
		if (element.getAttribute(name) !== composedValue)
			element.setAttribute(name, composedValue);
		return;
	}
	const value = values[valueParts[0]];
	applyAttributeValue(
		element,
		name,
		value,
		keepsTheSameName ? liveBinding.lastValue : undefined,
	);
	liveBinding.lastValue = value;
};
