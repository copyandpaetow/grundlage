import { MARKUP } from "../parser/chars";

export const isOpenMarker = (data: string): boolean =>
	data.startsWith(MARKUP.COMMENT_IDENTIFIER + " ") &&
	data[MARKUP.COMMENT_IDENTIFIER.length + 1] !== "/";

export const closeOf = (openData: string): string =>
	openData.replace(
		MARKUP.COMMENT_IDENTIFIER + " ",
		MARKUP.COMMENT_IDENTIFIER + " /",
	);

export const scanToClose = (walker: TreeWalker, open: Comment): Comment => {
	const openData = open.data;
	const closeData = closeOf(openData);
	let depth = 1;
	let node: Comment | null;
	while ((node = walker.nextNode() as Comment | null)) {
		if (node.data === openData) depth++;
		else if (node.data === closeData && --depth === 0) return node;
	}
	throw new Error("grundlage: unterminated content marker");
};

export const nextOpenMarker = (walker: TreeWalker): Comment => {
	let node: Comment | null;
	while ((node = walker.nextNode() as Comment | null))
		if (isOpenMarker(node.data)) return node;
	throw new Error(
		"grundlage: hydration marker mismatch: fewer markers than bindings",
	);
};

export const nextListTail = (walker: TreeWalker): Comment => {
	let node: Comment | null;
	while ((node = walker.nextNode() as Comment | null))
		if (node.data === MARKUP.LIST_MARKER_DATA) return node;
	throw new Error("grundlage: unterminated list row");
};

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
