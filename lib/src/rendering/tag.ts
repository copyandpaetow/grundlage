import { TagBinding } from "../parser/types";
import { bindingToString } from "../utils/binding-to-string";
import { HTMLTemplate } from "./template-html";

export const updateTag = (context: HTMLTemplate, index: number) => {
	const binding = context.parsedHTML.bindings[index] as TagBinding;
	const element = context.targets[index] as Element;
	const newTag = bindingToString(binding.values, context.currentExpressions);

	//rebuilding into the same tag is a full createElement + attribute copy + child re-parent that also drops focus and selection, so repeating it for an unchanged name is pure waste. this fires most on the first flush, where every binding starts dirty and the parser's <div> placeholder already matches a `<${"div"}>`. a bare === stays cheaper than the rebuild it skips (a hash here would cost more than it saves; cf. the attribute array-diff rejection). localName is the lowercased tag, so common lowercase names take the fast path and any other case rebuilds as before
	if (newTag === element.localName) return;

	//we're about to replace the element with a freshly-created one. to the browser that's a remove + insert, which drops focus, selection, and similar live UI state
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

	//the targets array is pre-resolved at setup, so a tag swap invalidates the old element reference for this slot and for every attribute binding that lives on the tag
	//=> we point all of them at the freshly-created element before marking the related attrs dirty so the next flush writes against the new node
	context.targets[index] = newElement;

	//we copied the html attributes onto the new element above, but anything written as a JS property (event listeners via onclick={...}, complex values) does not transfer
	//=> we mark every attribute binding that lives on this tag as dirty so the next flush re-runs them against the new element
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
