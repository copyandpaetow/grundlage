import { hashValue } from "../../utils/hashing";
import { isStringable } from "../../utils/guards";
import { hasHashChanged } from "../compose";
import { resolveTargetElement } from "../dom";
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
		resolveTargetElement(liveBinding),
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
	if (isStringable(liveBinding.lastValue)) return;
	applyDynamicAttribute(
		element,
		liveBinding.staticBinding.name,
		liveBinding.lastValue,
	);
};
