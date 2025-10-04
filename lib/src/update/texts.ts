import { DynamicPart } from "../types";

export const updateText = (currentBinding: DynamicPart) => {
	const text = currentBinding.value.join("");
	const textNode = document.createTextNode(text);

	let current = currentBinding.start.nextSibling;
	while (current && current !== currentBinding.end) {
		const next = current.nextSibling;
		current.remove();
		current = next;
	}
	currentBinding.start.after(textNode);
};
