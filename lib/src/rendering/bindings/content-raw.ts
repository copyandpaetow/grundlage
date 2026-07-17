import { combinedPartsHash, composeParts } from "../compose";
import { applyChangedCssGroups } from "./css-apply";
import { RawContentLiveBinding } from "./types";

export const commitRawContent = (
	liveBinding: RawContentLiveBinding,
	values: Array<unknown>,
): void => {
	const { parts, cssPlan } = liveBinding.staticBinding;
	const groupHashes = liveBinding.previousGroupHashes;

	if (groupHashes !== null) {
		//only a duplicate instance carries an override; the baked sheet came with the markup
		if (liveBinding.sheetOverride !== null) {
			liveBinding.markerComment.nextElementSibling!.textContent =
				liveBinding.sheetOverride;
			liveBinding.sheetOverride = null;
		}
		applyChangedCssGroups(
			liveBinding.carrier.host.style,
			cssPlan!.groups,
			liveBinding.groupNames!,
			groupHashes,
			values,
		);
		return;
	}

	const valueHash = combinedPartsHash(parts, values);
	if (valueHash === liveBinding.valueHash) return;
	liveBinding.valueHash = valueHash;
	const element = liveBinding.markerComment.nextElementSibling!;
	const composed = composeParts(parts, values);
	if (element instanceof HTMLTemplateElement) {
		if (element.innerHTML !== composed) element.innerHTML = composed;
		return;
	}
	if (element.textContent !== composed) element.textContent = composed;
};
