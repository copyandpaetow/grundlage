import { SingleValueAttributeStaticBinding } from "../../parser/types";
import { isStringable } from "../../utils/guards";
import { combineOrderedHash, hashValue } from "../../utils/hashing";
import { combinedPartsHash, composeParts, hasHashChanged } from "../compose";
import { applyAttributeValue, isDeclaredPropName } from "./attribute-write";
import { SingleValueAttributeLiveBinding } from "./types";

const singleValueGateHash = (
	staticBinding: SingleValueAttributeStaticBinding,
	values: Array<unknown>,
): number =>
	combineOrderedHash(
		combinedPartsHash(staticBinding.nameParts, values),
		hashValue(values[staticBinding.valueIndex]),
	);

export const commitSingleValue = (
	liveBinding: SingleValueAttributeLiveBinding,
	values: Array<unknown>,
): void => {
	if (
		!hasHashChanged(
			liveBinding,
			singleValueGateHash(liveBinding.staticBinding, values),
		)
	)
		return;

	const { nameParts, valueIndex } = liveBinding.staticBinding;
	const element = liveBinding.anchor;
	const name = composeParts(nameParts, values);
	const value = values[valueIndex];
	const previousName = liveBinding.lastComposedName;
	const staysInTheSameSlot = name === previousName;

	//`${name}=${value}` can rename between frames, so the slot it left is cleared before the
	//new one is written
	if (!staysInTheSameSlot && previousName !== "")
		applyAttributeValue(element, previousName, null, liveBinding.lastValue);

	applyAttributeValue(
		element,
		name,
		value,
		staysInTheSameSlot ? liveBinding.lastValue : undefined,
	);
	liveBinding.lastComposedName = name;
	liveBinding.lastValue = value;
};

export const reapplyOnSwap = (
	liveBinding: SingleValueAttributeLiveBinding,
	element: Element,
): void => {
	const name = liveBinding.lastComposedName;
	const isCarriedByMarkup =
		isStringable(liveBinding.lastValue) && !isDeclaredPropName(element, name);
	if (isCarriedByMarkup) return;
	applyAttributeValue(element, name, liveBinding.lastValue);
};
