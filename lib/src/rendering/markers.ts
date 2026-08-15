import { MARKUP } from "../parser/chars";

export const isOpenMarker = (data: string): boolean =>
	data.startsWith(MARKUP.COMMENT_IDENTIFIER + " ") &&
	data[MARKUP.COMMENT_IDENTIFIER.length + 1] !== "/";

export const closeOf = (openData: string): string =>
	openData.replace(
		MARKUP.COMMENT_IDENTIFIER + " ",
		MARKUP.COMMENT_IDENTIFIER + " /",
	);

//every walk is bounded by the range it is allowed to consume, so a server range that
//contradicts the value is rejected instead of adopting a later binding's markers; a null
//bound is a component root, where the walker's own root is the bound
export const scanToClose = (
	walker: TreeWalker,
	open: Comment,
	rangeEnd: Comment | null,
): Comment | null => {
	const openData = open.data;
	const closeData = closeOf(openData);
	let depth = 1;
	let node: Comment | null;
	while ((node = walker.nextNode() as Comment | null)) {
		if (node === rangeEnd) return null;
		if (node.data === openData) depth++;
		else if (node.data === closeData && --depth === 0) return node;
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
