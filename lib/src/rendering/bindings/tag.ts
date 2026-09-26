import { combinedPartsHash, composeParts, claimHashChange } from "../compose";
import { elementAfterMarker } from "../markers";
import { isSingleHoleValue } from "./attribute";
import { reapplyValueOnSwap } from "./attribute-write";
import {
	AttributeLaneLiveBinding,
	isAttributeBinding,
	isDynamicAttributeBinding,
	LiveBinding,
	TagLiveBinding,
} from "./types";

const isAttributeLane = (
	liveBinding: LiveBinding,
): liveBinding is AttributeLaneLiveBinding =>
	isAttributeBinding(liveBinding) || isDynamicAttributeBinding(liveBinding);

const swapElement = (
	element: Element,
	newTag: string,
	siblings: Array<LiveBinding>,
): void => {
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
		if (
			sibling === undefined ||
			!isAttributeLane(sibling) ||
			sibling.anchor !== element
		)
			continue;
		sibling.anchor = newElement;
		//a composed value is a string, so the attribute copy above already carries it
		if (
			isAttributeBinding(sibling) &&
			isSingleHoleValue(sibling.staticBinding.valueParts)
		)
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

export const commitTag = (
	liveBinding: TagLiveBinding,
	values: Array<unknown>,
	siblings: Array<LiveBinding>,
): void => {
	const { parts } = liveBinding.staticBinding;
	if (!claimHashChange(liveBinding, combinedPartsHash(parts, values))) return;
	const element = elementAfterMarker(liveBinding.openMarker);
	const newTag = composeParts(parts, values);
	if (newTag.toLowerCase() === element.tagName.toLowerCase()) return;
	swapElement(element, newTag, siblings);
};
