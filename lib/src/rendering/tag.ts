import { TagBinding } from "../parser/types";
import { bindingToString } from "../utils/binding-to-string";
import { HTMLTemplate } from "./template-html";

export const updateTag = (context: HTMLTemplate, index: number) => {
	const marker = context.markers[index];
	const binding = context.parsedHTML.bindings[index] as TagBinding;
	const element = marker.nextElementSibling!;
	const newTag = bindingToString(binding.values, context.currentExpressions);

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

	//from the binding we know if there are related attributes and mark them as dirty
	//this is mainly for event listeners
	for (const relatedIndex of binding.relatedAttributes) {
		context.dirtyBindings.add(relatedIndex);
	}
};
