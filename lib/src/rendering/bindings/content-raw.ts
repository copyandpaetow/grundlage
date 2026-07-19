import { combinedPartsHash, composeParts, hasHashChanged } from "../compose";
import { RawContentStaticBinding } from "../../parser/types";
import {
	applyChangedCustomProperties,
	hydrateCustomPropertyHashes,
} from "./css-apply";
import { RawContentLiveBinding } from "./types";

const rawContentGateHash = (
	staticBinding: RawContentStaticBinding,
	values: Array<unknown>,
): number => combinedPartsHash(staticBinding.parts, values);

export const commitRawContent = (
	liveBinding: RawContentLiveBinding,
	values: Array<unknown>,
	host: HTMLElement,
): void => {
	const { parts } = liveBinding.staticBinding;

	const styleSheetState = liveBinding.styleSheetState;
	//todo: why is this here? either we are in the fast path and the css stylesheet is static and applied in the parser
	//or we are not in the fast path and than it doesnt need extra handling => when can this happen with the duplicate instance?
	if (styleSheetState) {
		//only a duplicate instance carries an override; the baked sheet came with the markup
		if (styleSheetState.sheetOverride !== null) {
			liveBinding.markerComment.nextElementSibling!.textContent =
				styleSheetState.sheetOverride;
			styleSheetState.sheetOverride = null;
		}
		applyChangedCustomProperties(liveBinding, values, host);
		return;
	}

	if (
		!hasHashChanged(
			liveBinding,
			rawContentGateHash(liveBinding.staticBinding, values),
		)
	)
		return;
	const element = liveBinding.markerComment.nextElementSibling!;
	const composed = composeParts(parts, values);
	if (element instanceof HTMLTemplateElement) {
		if (element.innerHTML !== composed) element.innerHTML = composed;
		return;
	}
	if (element.textContent !== composed) element.textContent = composed;
};

export const hydrateRawContent = (
	liveBinding: RawContentLiveBinding,
	values: Array<unknown>,
): void => {
	if (liveBinding.styleSheetState === null) {
		liveBinding.lastValueHash = rawContentGateHash(
			liveBinding.staticBinding,
			values,
		);
		return;
	}
	liveBinding.styleSheetState.sheetOverride = null;
	hydrateCustomPropertyHashes(liveBinding, values);
};
