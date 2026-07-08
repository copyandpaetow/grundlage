import { BINDING } from "../../parser/constants";
import { combinedPartsHash, composeParts } from "../compose";
import { targetElement } from "../dom";
import { reapplyOnSwap as reapplyDynamicOnSwap } from "./attribute-dynamic";
import { reapplyOnSwap as reapplySingleValueOnSwap } from "./attribute-single-value";
import {
	DynamicAttributeLiveBinding,
	LiveBinding,
	SingleValueAttributeLiveBinding,
	TagLiveBinding,
} from "./types";

export const carriesProperty = (
	liveBinding: LiveBinding,
): liveBinding is
	| SingleValueAttributeLiveBinding
	| DynamicAttributeLiveBinding =>
	liveBinding.staticBinding.type === BINDING.SINGLE_VALUE_ATTRIBUTE ||
	liveBinding.staticBinding.type === BINDING.DYNAMIC_ATTRIBUTE;

const reapplyCarried = (
	liveBinding: SingleValueAttributeLiveBinding | DynamicAttributeLiveBinding,
	element: Element,
	values: Array<unknown>,
): void => {
	if (liveBinding.staticBinding.type === BINDING.SINGLE_VALUE_ATTRIBUTE)
		reapplySingleValueOnSwap(
			liveBinding as SingleValueAttributeLiveBinding,
			element,
			values,
		);
	else
		reapplyDynamicOnSwap(
			liveBinding as DynamicAttributeLiveBinding,
			element,
			values,
		);
};

const swapElement = (
	element: Element,
	newTag: string,
	siblings: Array<LiveBinding>,
	values: Array<unknown>,
): void => {
	const carried: Array<
		SingleValueAttributeLiveBinding | DynamicAttributeLiveBinding
	> = [];
	for (let index = 0; index < siblings.length; index++) {
		const sibling = siblings[index];
		if (
			sibling !== undefined &&
			carriesProperty(sibling) &&
			targetElement(sibling) === element
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
	element.replaceWith(newElement);
	focusElement?.focus();

	for (let index = 0; index < carried.length; index++)
		reapplyCarried(carried[index], newElement, values);
};

export const commitTag = (
	liveBinding: TagLiveBinding,
	values: Array<unknown>,
	siblings: Array<LiveBinding>,
): void => {
	const { parts } = liveBinding.staticBinding;
	const valueHash = combinedPartsHash(parts, values);
	if (valueHash === liveBinding.valueHash) return;
	liveBinding.valueHash = valueHash;
	const element = liveBinding.markerComment.nextElementSibling!;
	const newTag = composeParts(parts, values);
	if (newTag === element.tagName.toLowerCase()) return;
	swapElement(element, newTag, siblings, values);
};
