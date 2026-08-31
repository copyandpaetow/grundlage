import { combinedPartsHash, composeParts, claimHashChange } from "../compose";
import { CommentLiveBinding } from "./types";

export const commitComment = (
	liveBinding: CommentLiveBinding,
	values: Array<unknown>,
): void => {
	const { parts } = liveBinding.staticBinding;
	if (!claimHashChange(liveBinding, combinedPartsHash(parts, values))) return;
	const composed = composeParts(parts, values);
	const payload = liveBinding.openMarker.nextSibling as Comment;
	if (payload.data !== composed) payload.data = composed;
};
