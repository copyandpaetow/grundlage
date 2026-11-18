import * as MARKUP from "../../parser/markup";
import { combinedPartsHash, composeParts } from "../compose";
import { elementAfterMarker } from "../markers";
import { RawContentLiveBinding } from "./types";
import { ensureScriptText, ensureStyleText } from "./verbatim-text";

export const commitRawContent = (
	liveBinding: RawContentLiveBinding,
	values: Array<unknown>,
): void => {
	const { parts, elementName } = liveBinding.staticBinding;
	const hash = combinedPartsHash(parts, values);
	if (hash === liveBinding.lastValueHash) return;
	const composed = composeParts(parts, values);
	if (elementName === MARKUP.STYLE_TAG) ensureStyleText(composed);
	if (elementName === MARKUP.SCRIPT_TAG) ensureScriptText(composed);
	liveBinding.lastValueHash = hash;
	const element = elementAfterMarker(liveBinding.openMarker);
	if (element.textContent !== composed) element.textContent = composed;
};
