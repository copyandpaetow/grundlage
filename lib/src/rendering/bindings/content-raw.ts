import { combinedPartsHash, composeParts, hasHashChanged } from "../compose";
import { RawContentStaticBinding } from "../../parser/types";
import { applyChangedCssGroups } from "./css-apply";
import { RawContentLiveBinding } from "./types";

export const rawContentGateHash = (
	staticBinding: RawContentStaticBinding,
	values: Array<unknown>,
): number => combinedPartsHash(staticBinding.parts, values);

export const commitRawContent = (
	liveBinding: RawContentLiveBinding,
	values: Array<unknown>,
	host: HTMLElement,
): void => {
	const { parts } = liveBinding.staticBinding;

	const cssState = liveBinding.cssState;
	if (cssState !== null) {
		//only a duplicate instance carries an override; the baked sheet came with the markup
		if (cssState.sheetOverride !== null) {
			liveBinding.markerComment.nextElementSibling!.textContent =
				cssState.sheetOverride;
			cssState.sheetOverride = null;
		}
		applyChangedCssGroups(liveBinding, values, host);
		return;
	}

	if (!hasHashChanged(liveBinding, rawContentGateHash(liveBinding.staticBinding, values)))
		return;
	const element = liveBinding.markerComment.nextElementSibling!;
	const composed = composeParts(parts, values);
	if (element instanceof HTMLTemplateElement) {
		if (element.innerHTML !== composed) element.innerHTML = composed;
		return;
	}
	if (element.textContent !== composed) element.textContent = composed;
};
