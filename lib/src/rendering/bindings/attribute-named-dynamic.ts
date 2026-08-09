import { hashValue } from "../../utils/hashing";
import { isStringable } from "../../utils/guards";
import { hasHashChanged } from "../compose";
import { resolveTargetElement } from "../dom";
import { applyDynamicAttribute } from "./attribute-dynamic";
import { isDeclaredPropName } from "./attribute-single-value";
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
	const { name } = liveBinding.staticBinding;
	const isCarriedByMarkup =
		isStringable(liveBinding.lastValue) && !isDeclaredPropName(element, name);
	if (isCarriedByMarkup) return;
	applyDynamicAttribute(element, name, liveBinding.lastValue);
};
