import { combinedPartsHash, composeParts, hasHashChanged } from "../compose";
import { CommentLiveBinding } from "./types";

export const commitComment = (
	liveBinding: CommentLiveBinding,
	values: Array<unknown>,
): void => {
	const { parts } = liveBinding.staticBinding;
	if (!hasHashChanged(liveBinding, combinedPartsHash(parts, values))) return;
	const composed = composeParts(parts, values);
	const payload = liveBinding.markerComment.nextSibling as Comment;
	if (payload.data !== composed) payload.data = composed;
};
