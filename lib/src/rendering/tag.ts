import { TagBinding } from "../parser/types";
import { bindingToString } from "../utils/binding-to-string";
import { HTMLTemplate } from "./template-html";

export const updateTag = (context: HTMLTemplate, index: number) => {
	const binding = context.parsedHTML.bindings[index] as TagBinding;
	const element = context.targets[index] as Element;
	const newTag = bindingToString(binding.values, context.currentExpressions);

	if (newTag === element.localName) return;

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

	while (element.firstChild) {
		newElement.appendChild(element.firstChild);
	}
	element.replaceWith(newElement);
	focusElement?.focus();

	context.targets[index] = newElement;

	const relatedAttributes = binding.relatedAttributes;
	for (
		let attributeIndex = 0;
		attributeIndex < relatedAttributes.length;
		attributeIndex++
	) {
		const relatedIndex = relatedAttributes[attributeIndex];
		context.targets[relatedIndex] = newElement;
		context.dirtyBindings[relatedIndex] = 1;
	}
};
