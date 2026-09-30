import { combinedPartsHash, composeParts } from "../compose";
import { STYLE_SHEET_LANE, UNSET_HASH } from "../constants";
import { elementAfterMarker } from "../markers";
import {
	applyChangedDeclarations,
	matchCompiledStyleSheet,
	RULE_STRUCTURE_MISMATCH,
	seedDeclarationValueHashes,
	TEXT_STYLE_SHEET_LANE,
} from "./css-apply";
import { RawContentLiveBinding } from "./types";

const writeRawContentAsText = (
	liveBinding: RawContentLiveBinding,
	values: Array<unknown>,
): boolean => {
	const { parts } = liveBinding.staticBinding;
	const hash = combinedPartsHash(parts, values);
	if (hash === liveBinding.lastValueHash) return false;
	liveBinding.lastValueHash = hash;
	const element = elementAfterMarker(liveBinding.openMarker);
	const composed = composeParts(parts, values);
	if (element instanceof HTMLTemplateElement) {
		if (element.innerHTML !== composed) element.innerHTML = composed;
		return true;
	}
	if (element.textContent !== composed) element.textContent = composed;
	return true;
};

export const commitRawContent = (
	liveBinding: RawContentLiveBinding,
	values: Array<unknown>,
): void => {
	const lane = liveBinding.styleSheetLane;
	if (lane.kind === STYLE_SHEET_LANE.TEXT) {
		writeRawContentAsText(liveBinding, values);
		return;
	}
	const liveSheet = lane.styleElement.sheet;
	//the sheet will parse from the text written here, so its declarations already hold these values
	if (liveSheet === null) {
		if (writeRawContentAsText(liveBinding, values))
			seedDeclarationValueHashes(lane, values);
		return;
	}
	if (lane.boundSheet?.sheet !== liveSheet) {
		const matchedSheet = matchCompiledStyleSheet(
			lane.compiledStyleSheet,
			liveSheet,
		);
		if (matchedSheet === RULE_STRUCTURE_MISMATCH) {
			liveBinding.styleSheetLane = TEXT_STYLE_SHEET_LANE;
			writeRawContentAsText(liveBinding, values);
			return;
		}
		//a reparse restored the last written text — every hole must be rewritten
		if (lane.boundSheet !== null) lane.declarationValueHashes.fill(UNSET_HASH);
		lane.boundSheet = matchedSheet;
	}
	applyChangedDeclarations(lane, lane.boundSheet, values);
};
