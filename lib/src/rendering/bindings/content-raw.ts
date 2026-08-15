import { combinedPartsHash, composeParts, hasHashChanged } from "../compose";
import {
	commitStyleSheetDirect,
	seedDeclarationValueHashes,
} from "./css-apply";
import { RawContentLiveBinding } from "./types";

export const commitRawContent = (
	liveBinding: RawContentLiveBinding,
	values: Array<unknown>,
): void => {
	const committedToLiveSheet =
		liveBinding.styleSheetState && commitStyleSheetDirect(liveBinding, values);
	if (committedToLiveSheet) return;

	const { parts } = liveBinding.staticBinding;
	if (!hasHashChanged(liveBinding, combinedPartsHash(parts, values))) return;
	const element = liveBinding.markerComment.nextElementSibling!;
	const composed = composeParts(parts, values);
	if (element instanceof HTMLTemplateElement) {
		if (element.innerHTML !== composed) element.innerHTML = composed;
		return;
	}
	if (element.textContent !== composed) element.textContent = composed;
	//commitStyleSheetDirect above may have demoted this binding to null — re-read, don't cache
	if (liveBinding.styleSheetState)
		seedDeclarationValueHashes(liveBinding, values);
};
