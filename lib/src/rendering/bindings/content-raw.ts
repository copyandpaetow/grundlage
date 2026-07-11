import { combinedPartsHash, composeParts } from "../compose";
import { RawContentLiveBinding } from "./types";

export const commitRawContent = (
	liveBinding: RawContentLiveBinding,
	values: Array<unknown>,
): void => {
	const { parts } = liveBinding.staticBinding;
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
