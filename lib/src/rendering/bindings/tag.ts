import { BINDING } from "../../parser/constants";
import { combinedPartsHash, composeParts, hasHashChanged } from "../compose";
import { reapplyOnSwap } from "./dispatch";
import {
	AttributeLiveBinding,
	DynamicAttributeLiveBinding,
	LiveBinding,
	SingleValueAttributeLiveBinding,
	TagLiveBinding,
} from "./types";

type AnyAttributeLiveBinding =
	| AttributeLiveBinding
	| SingleValueAttributeLiveBinding
	| DynamicAttributeLiveBinding;

const isAttributeLane = (
	liveBinding: LiveBinding,
): liveBinding is AnyAttributeLiveBinding =>
	liveBinding.staticBinding.type === BINDING.ATTRIBUTE ||
	liveBinding.staticBinding.type === BINDING.SINGLE_VALUE_ATTRIBUTE ||
	liveBinding.staticBinding.type === BINDING.DYNAMIC_ATTRIBUTE;

const isCarriedByMarkupAlone = (
	liveBinding: AnyAttributeLiveBinding,
): liveBinding is AttributeLiveBinding =>
	liveBinding.staticBinding.type === BINDING.ATTRIBUTE;

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
		if (!isCarriedByMarkupAlone(sibling)) reapplyOnSwap(sibling, newElement);
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
	if (!hasHashChanged(liveBinding, combinedPartsHash(parts, values))) return;
	const element = liveBinding.markerComment.nextElementSibling!;
	const newTag = composeParts(parts, values);
	if (newTag.toLowerCase() === element.tagName.toLowerCase()) return;
	swapElement(element, newTag, siblings);
};
