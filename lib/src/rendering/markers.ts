import { CHAR_CODE, MARKUP } from "../parser/chars";

const MARKER_PREFIX = MARKUP.COMMENT_IDENTIFIER + " ";
const CLOSE_SLASH_INDEX = MARKER_PREFIX.length;

const isOpenMarker = (data: string): boolean =>
	data.startsWith(MARKER_PREFIX) &&
	data.charCodeAt(CLOSE_SLASH_INDEX) !== CHAR_CODE.SLASH;

//every walk is bounded by the range it is allowed to consume, so a server range that
//contradicts the value is rejected instead of adopting a later binding's markers; a null
//bound is a component root, where the walker's own root is the bound
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
	console.warn(
		"grundlage: hydration mismatch: the server's markup does not match this render. ",
	);

export const forEachNode = (
	first: ChildNode | null,
	end: ChildNode | null,
	visit: (node: ChildNode) => void,
): void => {
	let current = first;
	while (current && current !== end) {
		const next = current.nextSibling;
		visit(current);
		current = next;
	}
};
