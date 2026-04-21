import { TagBinding } from "../parser/types";
import { bindingToString } from "../utils/binding-to-string";
import { HTMLTemplate } from "./template-html";

export const updateTag = (context: HTMLTemplate, index: number) => {
	const marker = context.markers[index];
	const binding = context.parsedHTML.bindings[index] as TagBinding;
	const element = marker.nextElementSibling!;
	const newTag = bindingToString(binding.values, context.currentExpressions);

	//we are going to replace the surrounding element with something new. To the browser, its a series of removals and additions and clears browser states like focus
	const focusElement = element.contains(
		(element.getRootNode() as ShadowRoot).activeElement,
	)
		? (document.activeElement as HTMLElement)
		: null;

	const newElement = document.createElement(newTag);
	for (let index = 0; index < element.attributes.length; index++) {
		const attribute = element.attributes[index];
		newElement.setAttribute(attribute.name, attribute.value);
	}

	// appendChild adopts the node out of `element`, draining its childNodes
	// in place — no spread, no iterator, no temporary array.
	while (element.firstChild) {
		newElement.appendChild(element.firstChild);
	}
	element.replaceWith(newElement);
	focusElement?.focus();

	//from the binding we know if there are related attributes and mark them as dirty
	//this is mainly for event listeners
	const relatedAttributes = binding.relatedAttributes;
	for (let index = 0; index < relatedAttributes.length; index++) {
		context.dirtyBindings[relatedAttributes[index]] = 1;
	}
};
