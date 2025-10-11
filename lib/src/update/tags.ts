import { TagHole } from "../types";

export const updateTag = (
	currentBinding: TagHole,
	dynamicValues: Array<unknown>
) => {
	const placeholder = currentBinding.start.parentElement!;
	const newTag = currentBinding.values
		.map((relatedIndex) =>
			typeof relatedIndex === "number"
				? dynamicValues[relatedIndex]
				: relatedIndex
		)
		.join(""); //functions in here would need to get called

	const newElement = document.createElement(newTag);
	placeholder
		.getAttributeNames()
		.forEach((name) =>
			newElement.setAttribute(name, placeholder.getAttribute(name)!)
		);

	newElement.replaceChildren(...placeholder.childNodes);
	placeholder.replaceWith(newElement);
	currentBinding.dirty = false;
};
