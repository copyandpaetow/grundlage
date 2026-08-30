import { combinedPartsHash, composeParts, claimHashChange } from "../compose";
import { combineOrderedHash } from "../../utils/hashing";
import { AttributeStaticBinding } from "../../parser/types";
import { AttributeLiveBinding } from "./types";

const attributeGateHash = (
	staticBinding: AttributeStaticBinding,
	values: Array<unknown>,
): number =>
	combineOrderedHash(
		combinedPartsHash(staticBinding.nameParts, values),
		combinedPartsHash(staticBinding.valueParts, values),
	);

export const commitAttribute = (
	liveBinding: AttributeLiveBinding,
	values: Array<unknown>,
): void => {
	const { nameParts, valueParts } = liveBinding.staticBinding;
	if (
		!claimHashChange(
			liveBinding,
			attributeGateHash(liveBinding.staticBinding, values),
		)
	)
		return;
	const element = liveBinding.anchor;
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
