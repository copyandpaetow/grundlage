import { TagDescriptor } from "../parser/types";
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

	/*
	- we create a new element and move as much as we can to the new element
	- since the nested elements technically leave the dom, all their internal state is gone
	todo: we should iterate the children and try to find animations etc before moving them and restore them

	
	*/

	const focusElement = element.contains(document.activeElement)
		? (document.activeElement as HTMLElement)
		: null;

	const newElement = document.createElement(newTag);
	for (const attr of element.attributes) {
		newElement.setAttribute(attr.name, attr.value);
	}

	newElement.replaceChildren(...element.childNodes);
	element.replaceWith(newElement);
	focusElement?.focus();

	//from the descriptor we know if there are related attributes and mark them as dirty
	//this is mainly for event listeners
	for (const relatedIndex of descriptor.relatedAttributes) {
		context.dirtyBindings.add(relatedIndex);
	}
};
