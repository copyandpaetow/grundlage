import { BINDING } from "../../parser/constants";
import { TagStaticBinding } from "../../parser/types";
import { combinedPartsHash, composeParts, hasHashChanged } from "../compose";
import { resolveTargetElement } from "../dom";
import { reapplyOnSwap } from "./dispatch";
import {
	DynamicAttributeLiveBinding,
	LiveBinding,
	NamedDynamicLiveBinding,
	SingleValueAttributeLiveBinding,
	TagLiveBinding,
} from "./types";

const shouldReapplyOnSwap = (
	liveBinding: LiveBinding,
): liveBinding is
	| SingleValueAttributeLiveBinding
	| DynamicAttributeLiveBinding
	| NamedDynamicLiveBinding =>
	liveBinding.staticBinding.type === BINDING.SINGLE_VALUE_ATTRIBUTE ||
	liveBinding.staticBinding.type === BINDING.DYNAMIC_ATTRIBUTE ||
	liveBinding.staticBinding.type === BINDING.NAMED_DYNAMIC;

const swapElement = (
	element: Element,
	newTag: string,
	siblings: Array<LiveBinding>,
	values: Array<unknown>,
): void => {
	const carried: Array<
		| SingleValueAttributeLiveBinding
		| DynamicAttributeLiveBinding
		| NamedDynamicLiveBinding
	> = [];
	for (let index = 0; index < siblings.length; index++) {
		const sibling = siblings[index];
		if (
			sibling !== undefined &&
			shouldReapplyOnSwap(sibling) &&
			resolveTargetElement(sibling) === element
		)
			carried.push(sibling);
	}

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

	for (let index = 0; index < carried.length; index++)
		reapplyOnSwap(carried[index], newElement, values);

	element.replaceWith(newElement);
	focusElement?.focus();
};

const tagGateHash = (
	staticBinding: TagStaticBinding,
	values: Array<unknown>,
): number => combinedPartsHash(staticBinding.parts, values);

export const commitTag = (
	liveBinding: TagLiveBinding,
	values: Array<unknown>,
	siblings: Array<LiveBinding>,
): void => {
	const { parts } = liveBinding.staticBinding;
	if (
		!hasHashChanged(liveBinding, tagGateHash(liveBinding.staticBinding, values))
	)
		return;
	const element = liveBinding.markerComment.nextElementSibling!;
	const newTag = composeParts(parts, values);
	if (newTag.toLowerCase() === element.tagName.toLowerCase()) return;
	swapElement(element, newTag, siblings, values);
};

export const hydrateTag = (
	liveBinding: TagLiveBinding,
	values: Array<unknown>,
): void => {
	liveBinding.lastValueHash = tagGateHash(liveBinding.staticBinding, values);
};
