import { combinedPartsHash, composeParts } from "../compose";
import { CommentLiveBinding } from "./types";

export const commitComment = (
	liveBinding: CommentLiveBinding,
	values: Array<unknown>,
): void => {
	const { parts } = liveBinding.staticBinding;
	const valueHash = combinedPartsHash(parts, values);
	if (valueHash === liveBinding.valueHash) return;
	liveBinding.valueHash = valueHash;
	const composed = composeParts(parts, values);
	const payload = liveBinding.markerComment.nextSibling as Comment;
	if (payload.data !== composed) payload.data = composed;
};
