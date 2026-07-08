import { combinedPartsHash, composeParts } from "../compose";
import { combineOrderedHash } from "../constants";
import { targetElement } from "../dom";
import { AttributeLiveBinding } from "./types";

export const commitAttribute = (
	liveBinding: AttributeLiveBinding,
	values: Array<unknown>,
): void => {
	const { nameParts, valueParts } = liveBinding.staticBinding;
	const valueHash = combineOrderedHash(
		combinedPartsHash(nameParts, values),
		combinedPartsHash(valueParts, values),
	);
	if (valueHash === liveBinding.valueHash) return;
	liveBinding.valueHash = valueHash;
	const element = targetElement(liveBinding);
	const composedName = composeParts(nameParts, values);
	if (composedName !== liveBinding.lastComposedName) {
		if (liveBinding.lastComposedName !== "")
			element.removeAttribute(liveBinding.lastComposedName);
		liveBinding.lastComposedName = composedName;
	}
	const composedValue = composeParts(valueParts, values);
	if (element.getAttribute(composedName) !== composedValue)
		element.setAttribute(composedName, composedValue);
};
