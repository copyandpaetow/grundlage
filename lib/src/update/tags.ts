import { DynamicPart } from "../types";

export const updateTag = (currentBinding: DynamicPart) => {
	const placeholder = currentBinding.start.nextElementSibling!;
	const newTag = currentBinding.value.join(""); //functions in here would need to get called

	const newElement = document.createElement(newTag);
	placeholder
		.getAttributeNames()
		.forEach((name) =>
			newElement.setAttribute(name, placeholder.getAttribute(name)!)
		);

	newElement.replaceChildren(...placeholder.childNodes);

	let current = currentBinding.start.nextSibling;
	while (current && current !== currentBinding.end) {
		const next = current.nextSibling;
		current.remove();
		current = next;
	}

	currentBinding.start.after(newElement);
};
