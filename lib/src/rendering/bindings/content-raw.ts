import { combinedPartsHash, composeParts, hasHashChanged } from "../compose";
import { RawContentStaticBinding } from "../../parser/types";
import {
	commitStyleSheetDirect,
	seedDeclarationValueHashes,
} from "./css-apply";
import { RawContentLiveBinding } from "./types";

const rawContentGateHash = (
	staticBinding: RawContentStaticBinding,
	values: Array<unknown>,
): number => combinedPartsHash(staticBinding.parts, values);

export const commitRawContent = (
	liveBinding: RawContentLiveBinding,
	values: Array<unknown>,
): void => {
	const committedToLiveSheet =
		liveBinding.styleSheetState && commitStyleSheetDirect(liveBinding, values);
	if (committedToLiveSheet) return;

	if (
		!hasHashChanged(
			liveBinding,
			rawContentGateHash(liveBinding.staticBinding, values),
		)
	)
		return;
	const element = liveBinding.markerComment.nextElementSibling!;
	const composed = composeParts(liveBinding.staticBinding.parts, values);
	if (element instanceof HTMLTemplateElement) {
		if (element.innerHTML !== composed) element.innerHTML = composed;
		return;
	}
	if (element.textContent !== composed) element.textContent = composed;
	//commitStyleSheetDirect above may have demoted this binding to null — re-read, don't cache
	if (liveBinding.styleSheetState)
		seedDeclarationValueHashes(liveBinding, values);
};

export const hydrateRawContent = (
	liveBinding: RawContentLiveBinding,
	values: Array<unknown>,
): void => {
	liveBinding.lastValueHash = rawContentGateHash(
		liveBinding.staticBinding,
		values,
	);
	if (liveBinding.styleSheetState)
		seedDeclarationValueHashes(liveBinding, values);
};
