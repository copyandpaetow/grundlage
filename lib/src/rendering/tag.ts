import { TagBinding } from "../parser/types";
import { bindingToString } from "../utils/binding-to-string";
import { HTMLTemplate } from "./template-html";

export const updateTag = (context: HTMLTemplate, index: number) => {
	const marker = context.markers[index];
	const binding = context.parsedHTML.bindings[index] as TagBinding;
	const element = marker.nextElementSibling!;
	const newTag = bindingToString(binding.values, context.currentExpressions);

	//we're about to replace the element with a freshly-created one — to the browser that's a remove + insert, which drops focus, selection, and similar live UI state
	//=> if focus currently lives inside this element we remember it so we can restore it after the swap below
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

	//appendChild adopts the node out of `element` and drains its childNodes in place
	//=> no spread, no iterator, no temporary array
	while (element.firstChild) {
		newElement.appendChild(element.firstChild);
	}
	element.replaceWith(newElement);
	focusElement?.focus();

	//we copied the html attributes onto the new element above, but anything written as a JS property (event listeners via onclick={...}, complex values) does not transfer
	//=> we mark every attribute binding that lives on this tag as dirty so the next flush re-runs them against the new element
	const relatedAttributes = binding.relatedAttributes;
	for (
		let attributeIndex = 0;
		attributeIndex < relatedAttributes.length;
		attributeIndex++
	) {
		context.dirtyBindings[relatedAttributes[attributeIndex]] = 1;
	}
};
