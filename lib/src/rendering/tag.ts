import { TagDescriptor } from "../parser/parser-html";
import { descriptorToString } from "../utils/descriptor-to-string";
import { HTMLTemplate } from "./template-html";

export const updateTag = (context: HTMLTemplate, index: number) => {
	const marker = context.markers[index];
	const descriptor = context.parsedHTML.descriptors[index] as TagDescriptor;
	const element = marker.nextElementSibling!;
	const newTag = descriptorToString(
		descriptor.values,
		context.currentExpressions,
	);

	const newElement = document.createElement(newTag);
	for (const attr of element.attributes) {
		newElement.setAttribute(attr.name, attr.value);
	}

	newElement.replaceChildren(...element.childNodes);
	element.replaceWith(newElement);

	for (const relatedIndex of descriptor.relatedAttributes) {
		context.dirtyBindings.add(relatedIndex);
	}
};
