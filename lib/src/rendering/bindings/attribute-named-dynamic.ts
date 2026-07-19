import { hashValue } from "../../utils/hashing";
import { isStringable } from "../../utils/guards";
import { hasHashChanged } from "../compose";
import { targetElement } from "../dom";
import { applyDynamicAttribute } from "./attribute-dynamic";
import { NamedDynamicLiveBinding } from "./types";

export const commitNamedDynamic = (
	liveBinding: NamedDynamicLiveBinding,
	values: Array<unknown>,
): void => {
	const { name, valueIndex } = liveBinding.staticBinding;
	const value = values[valueIndex];
	if (!hasHashChanged(liveBinding, hashValue(value))) return;
	applyDynamicAttribute(
		targetElement(liveBinding),
		name,
		value,
		liveBinding.lastValue,
	);
	liveBinding.lastValue = value;
};

export const reapplyOnSwap = (
	liveBinding: NamedDynamicLiveBinding,
	element: Element,
): void => {
	// swapElement copies attributes onto the new element, so only listeners and properties
	// (non-stringable values) need re-applying — mirrors the dynamic-spread reapply path.
	if (isStringable(liveBinding.lastValue)) return;
	applyDynamicAttribute(
		element,
		liveBinding.staticBinding.name,
		liveBinding.lastValue,
	);
};
