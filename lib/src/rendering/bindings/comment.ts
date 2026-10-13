import { combinedPartsHash, composeParts } from "../compose";
import { CommentLiveBinding } from "./types";
import { assertDuringDevelopment } from "../../utils/diagnostics";

export const commitComment = (
	liveBinding: CommentLiveBinding,
	values: Array<unknown>,
): void => {
	const { parts } = liveBinding.staticBinding;
	const hash = combinedPartsHash(parts, values);
	if (hash === liveBinding.lastValueHash) return;
	liveBinding.lastValueHash = hash;
	const composed = composeParts(parts, values);
	const payload = liveBinding.openMarker.nextSibling;
	assertDuringDevelopment(
		payload instanceof Comment,
		"a comment binding's payload comment follows its marker",
	);
	if (payload.data !== composed) payload.data = composed;
};
