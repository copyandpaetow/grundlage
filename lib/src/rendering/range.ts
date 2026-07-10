import { COMMENT_IDENTIFIER } from "../parser/constants";
import { ListItem } from "./bindings/types";

export const isOpenMarker = (data: string): boolean =>
	data.startsWith(COMMENT_IDENTIFIER + " ") &&
	data[COMMENT_IDENTIFIER.length + 1] !== "/";

export const isCloseMarker = (data: string): boolean =>
	data.startsWith(COMMENT_IDENTIFIER + " /");

export const closeOf = (openData: string): string =>
	openData.replace(COMMENT_IDENTIFIER + " ", COMMENT_IDENTIFIER + " /");

export const clearNodeRange = (
	startMarker: Comment,
	endMarker: Comment,
): void => {
	let current = startMarker.nextSibling;
	while (current !== null && current !== endMarker) {
		const next = current.nextSibling;
		current.remove();
		current = next;
	}
};

export const forEachRowNode = (
	row: ListItem,
	visit: (node: ChildNode) => void,
): void => {
	let current: ChildNode = row.spanStart;
	while (current !== row.tailMarker) {
		const next = current.nextSibling!;
		visit(current);
		current = next;
	}
};
