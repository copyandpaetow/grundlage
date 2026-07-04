import { ListItem } from "./instance";

//todo: the file name is not great here, it doesnt tell us what is happening in here

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
