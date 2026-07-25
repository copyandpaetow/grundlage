import { combinedPartsHash, composeParts, hasHashChanged } from "../compose";
import { CommentStaticBinding } from "../../parser/types";
import { CommentLiveBinding } from "./types";

const commentGateHash = (
	staticBinding: CommentStaticBinding,
	values: Array<unknown>,
): number => combinedPartsHash(staticBinding.parts, values);

export const commitComment = (
	liveBinding: CommentLiveBinding,
	values: Array<unknown>,
): void => {
	const { parts } = liveBinding.staticBinding;
	if (
		!hasHashChanged(
			liveBinding,
			commentGateHash(liveBinding.staticBinding, values),
		)
	)
		return;
	const composed = composeParts(parts, values);
	const payload = liveBinding.markerComment.nextSibling as Comment;
	if (payload.data !== composed) payload.data = composed;
};

export const hydrateComment = (
	liveBinding: CommentLiveBinding,
	values: Array<unknown>,
): void => {
	liveBinding.lastValueHash = commentGateHash(
		liveBinding.staticBinding,
		values,
	);
};
