import { combinedPartsHash, composeParts, claimHashChange } from "../compose";
import { combineOrderedHash } from "../../utils/hashing";
import { AttributeStaticBinding, Part } from "../../parser/types";
import { applyAttributeValue } from "./attribute-write";
import { AttributeLiveBinding } from "./types";

//one hole is the whole value and keeps its type; any text around a hole makes a string
export const isSingleHoleValue = (
	valueParts: Array<Part>,
): valueParts is [number] =>
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
	if (
		!claimHashChange(
			liveBinding,
			attributeGateHash(liveBinding.staticBinding, values),
		)
	)
		return;
	const { nameParts, valueParts } = liveBinding.staticBinding;
	const element = liveBinding.anchor;
	const name = composeParts(nameParts, values);
	const keepsTheSameName = name === liveBinding.lastComposedName;

	if (!keepsTheSameName && liveBinding.lastComposedName !== "")
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
