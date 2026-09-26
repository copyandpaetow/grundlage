import { CHAR_CODE, MARKUP } from "../parser/chars";
import { warnDuringDevelopment } from "../utils/diagnostics";

const MARKER_PREFIX = MARKUP.COMMENT_IDENTIFIER + " ";
const CLOSE_SLASH_INDEX = MARKER_PREFIX.length;

const isOpenMarker = (data: string): boolean =>
	data.startsWith(MARKER_PREFIX) &&
	data.charCodeAt(CLOSE_SLASH_INDEX) !== CHAR_CODE.SLASH;

//a binding's open marker sits directly before the element it binds
export const elementAfterMarker = (openMarker: Comment): Element =>
	openMarker.nextElementSibling!;

//every walk stops at the range it may consume, so a contradicting server range is rejected rather
//than adopting a later binding's markers. A null bound means the walker's own root bounds it
export const scanToClose = (
	walker: TreeWalker,
	openMarker: Comment,
	closeMarkerData: string,
	rangeEnd: Comment | null,
): Comment | null => {
	const openMarkerData = openMarker.data;
	let depth = 1;
	let node: Comment | null;
	while ((node = walker.nextNode() as Comment | null)) {
		if (node === rangeEnd) return null;
		if (node.data === openMarkerData) depth++;
		else if (node.data === closeMarkerData && --depth === 0) return node;
	}
	return null;
};

export const nextOpenMarker = (
	walker: TreeWalker,
	rangeEnd: Comment | null,
): Comment | null => {
	let node: Comment | null;
	while ((node = walker.nextNode() as Comment | null)) {
		if (node === rangeEnd) return null;
		if (isOpenMarker(node.data)) return node;
	}
	return null;
};

export const nextListTail = (
	walker: TreeWalker,
	rangeEnd: Comment,
): Comment | null => {
	let node: Comment | null;
	while ((node = walker.nextNode() as Comment | null)) {
		if (node === rangeEnd) return null;
		if (node.data === MARKUP.LIST_MARKER_DATA) return node;
	}
	return null;
};

export const warnOnRejectedServerRange = (): void =>
	warnDuringDevelopment(
		"hydration mismatch: the server's markup does not match this render. ",
	);

export const clearRange = (
	first: ChildNode | null,
	end: ChildNode | null,
): void => {
	let current = first;
	while (current && current !== end) {
		const next = current.nextSibling;
		current.remove();
		current = next;
	}
};
