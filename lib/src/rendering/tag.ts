import { TagBinding } from "../parser/types";
import { bindingToString } from "../utils/binding-to-string";
import { HTMLTemplate } from "./template-html";

export const updateTag = (context: HTMLTemplate, index: number) => {
	const marker = context.markers[index];
	const binding = context.parsedHTML.bindings[index] as TagBinding;
	const element = marker.nextElementSibling!;
	const newTag = bindingToString(binding.values, context.currentExpressions);

	//we are going to replace the surrounding element with something new. To the browser, it's a series of removals and additions and clears browser states like focus
	//Resolve detection and capture from the same root: in a shadow root with delegatesFocus,
	//document.activeElement is the host while root.activeElement is the actual focused inner field —
	//mixing them refocused the host.
	const focusRoot = element.getRootNode() as ShadowRoot | Document;
	const focusedNode = focusRoot.activeElement as HTMLElement | null;
	const focusElement =
		focusedNode && element.contains(focusedNode) ? focusedNode : null;

	const newElement = document.createElement(newTag);
	for (
		let attributeIndex = 0;
		attributeIndex < element.attributes.length;
		attributeIndex++
	) {
		const attribute = element.attributes[attributeIndex];
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
	for (
		let attributeIndex = 0;
		attributeIndex < relatedAttributes.length;
		attributeIndex++
	) {
		context.dirtyBindings[relatedAttributes[attributeIndex]] = 1;
	}
};
