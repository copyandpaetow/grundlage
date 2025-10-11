import { TemplateResult } from "../html/html";
import { ContentHole } from "../types";
import { renderStaticDom } from "./static";

export const updateText = (
	currentBinding: ContentHole,
	dynamicValues: Array<unknown>
) => {
	const text = dynamicValues[currentBinding.values];
	let textNode = document.createTextNode(text);
	if (text?.__type__) {
		textNode = renderStaticDom(text as TemplateResult);
	} else {
		textNode = document.createTextNode(text);
	}

	let current = currentBinding.start.nextSibling;
	while (current && current !== currentBinding.end) {
		const next = current.nextSibling;
		current.remove();
		current = next;
	}
	currentBinding.start.after(textNode);
	currentBinding.dirty = false;
};
