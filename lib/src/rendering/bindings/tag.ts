import { combinedPartsHash, composeParts } from "../compose";
import { elementAfterMarker } from "../markers";
import {
	FOREIGN_CONTENT_ROOT_TAGS,
	HTML_NAMESPACE,
	warnWhenParsingWouldSplitParagraph,
} from "../parse-context";
import { libraryMessage } from "../../utils/diagnostics";
import { isSingleHoleValue } from "./attribute";
import { namedBindingErrorOf, reapplyValueOnSwap } from "./attribute-apply";
import {
	isAttributeBinding,
	isDynamicAttributeBinding,
	LiveBinding,
	TagLiveBinding,
} from "./types";

const repointAnchoredBindings = (
	siblings: ReadonlyArray<LiveBinding | undefined>,
	element: Element,
	newElement: Element,
): void => {
	for (let index = 0; index < siblings.length; index++) {
		const sibling = siblings[index];
		if (sibling === undefined) continue;
		if (isAttributeBinding(sibling) && sibling.anchor === element) {
			sibling.anchor = newElement;
			//a composed value is a string, so the attribute copy already carries it
			if (isSingleHoleValue(sibling.staticBinding.valueParts)) {
				reapplyValueOnSwap(newElement, sibling.lastComposedName, sibling.lastValue);
			}
		} else if (isDynamicAttributeBinding(sibling) && sibling.anchor === element) {
			sibling.anchor = newElement;
			for (const [name, entry] of sibling.appliedAttributes) {
				reapplyValueOnSwap(newElement, name, entry.value);
			}
		}
	}
};

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
	const switchesIntoForeignContent =
		FOREIGN_CONTENT_ROOT_TAGS.has(newTag.toLowerCase()) && element.namespaceURI === HTML_NAMESPACE;
	if (switchesIntoForeignContent) {
		throw new Error(
			libraryMessage(
				`a dynamic tag cannot become <${newTag}>: the markup inside it was already parsed as HTML. Write <${newTag}> statically and keep the dynamic tag inside it.`,
			),
		);
	}

	const focusRoot = element.getRootNode() as ShadowRoot | Document;
	const focusedNode = focusRoot.activeElement as HTMLElement | null;
	const focusElement = focusedNode && element.contains(focusedNode) ? focusedNode : null;

	//the placeholder was parsed in the namespace of its position, which an SVG or MathML tag needs
	let newElement: Element;
	try {
		newElement = document.createElementNS(element.namespaceURI, newTag);
	} catch (error) {
		throw namedBindingErrorOf(
			error,
			`a dynamic tag <\${…}> composed "${newTag}", which is not a valid tag name. Bind a name such as "section" or "my-card".`,
		);
	}
	warnWhenParsingWouldSplitParagraph(newTag, element.parentNode);
	for (let index = 0; index < element.attributes.length; index++) {
		const attribute = element.attributes[index];
		newElement.setAttribute(attribute.name, attribute.value);
	}
	while (element.firstChild) newElement.appendChild(element.firstChild);
	repointAnchoredBindings(siblings, element, newElement);
	element.replaceWith(newElement);
	focusElement?.focus();
};
