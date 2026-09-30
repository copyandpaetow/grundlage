import { combinedPartsHash, composeParts } from "../compose";
import { elementAfterMarker } from "../markers";
import { isSingleHoleValue } from "./attribute";
import { reapplyValueOnSwap } from "./attribute-write";
import {
	isAttributeBinding,
	isDynamicAttributeBinding,
	LiveBinding,
	TagLiveBinding,
} from "./types";

export const commitTag = (
	liveBinding: TagLiveBinding,
	values: Array<unknown>,
	siblings: ReadonlyArray<LiveBinding | undefined>,
): void => {
	const { parts } = liveBinding.staticBinding;
	const hash = combinedPartsHash(parts, values);
	if (hash === liveBinding.lastValueHash) return;
	liveBinding.lastValueHash = hash;
	const element = elementAfterMarker(liveBinding.openMarker);
	const newTag = composeParts(parts, values);
	if (newTag.toLowerCase() === element.tagName.toLowerCase()) return;

	const focusRoot = element.getRootNode() as ShadowRoot | Document;
	const focusedNode = focusRoot.activeElement as HTMLElement | null;
	const focusElement =
		focusedNode && element.contains(focusedNode) ? focusedNode : null;

	const newElement = document.createElement(newTag);
	for (let index = 0; index < element.attributes.length; index++) {
		const attribute = element.attributes[index];
		newElement.setAttribute(attribute.name, attribute.value);
	}
	while (element.firstChild) newElement.appendChild(element.firstChild);

	for (let index = 0; index < siblings.length; index++) {
		const sibling = siblings[index];
		const isAnchoredToSwappedElement =
			sibling !== undefined &&
			(isAttributeBinding(sibling) || isDynamicAttributeBinding(sibling)) &&
			sibling.anchor === element;
		if (!isAnchoredToSwappedElement) continue;
		sibling.anchor = newElement;
		//a composed value is a string, so the attribute copy above already carries it
		const isSingleHoleAttribute =
			isAttributeBinding(sibling) &&
			isSingleHoleValue(sibling.staticBinding.valueParts);
		if (isSingleHoleAttribute)
			reapplyValueOnSwap(
				newElement,
				sibling.lastComposedName,
				sibling.lastValue,
			);
		else if (isDynamicAttributeBinding(sibling))
			for (const [name, entry] of sibling.appliedAttributes)
				reapplyValueOnSwap(newElement, name, entry.value);
	}

	element.replaceWith(newElement);
	focusElement?.focus();
};
