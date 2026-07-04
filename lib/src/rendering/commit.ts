import { BINDING, StaticBinding } from "../parser/types";
import { isTemplate, TemplateValue } from "../template-value";
import { hashValue } from "../utils/hashing";
import { assertPrimitiveString, isStringable } from "../utils/to-primitive";
import { combinedPartsHash, composeParts, hasValueChanged } from "./compose";
import {
	ATTR_MODE,
	combineOrderedHash,
	CONTENT_KIND,
	UNSET_HASH,
} from "./constants";
import {
	applyAttributeMap,
	applyDynamicAttribute,
	normalizeToAttributeMap,
	nudgeComponent,
} from "./dynamic-attribute";
import {
	AttributeLiveBinding,
	BranchContentState,
	CommentLiveBinding,
	ContentLiveBinding,
	ContentState,
	DynamicAttributeLiveBinding,
	EventLiveBinding,
	LiveBinding,
	RawContentLiveBinding,
	reconcileInstance,
	SingleValueAttributeLiveBinding,
	TagLiveBinding,
	TextContentState,
} from "./instance";
import { patchListContent } from "./list";
import { assertNestable } from "./mount-hydrate";
import { clearNodeRange } from "./range";

export const createLiveBinding = (
	staticBinding: StaticBinding,
	markerComment: Comment | null,
	hostElement: Element | null,
	endMarker: Comment | null = null,
): LiveBinding => {
	switch (staticBinding.type) {
		case BINDING.TAG:
			return {
				staticBinding,
				markerComment: markerComment!,
				relatedLiveBindings: [],
				valueHash: UNSET_HASH,
			};
		case BINDING.ATTRIBUTE:
			return {
				staticBinding,
				markerComment,
				hostElement,
				valueHash: UNSET_HASH,
				lastComposedName: "",
			};
		case BINDING.SINGLE_VALUE_ATTRIBUTE:
			return {
				staticBinding,
				markerComment,
				hostElement,
				valueHash: UNSET_HASH,
				lastComposedName: "",
				appliedMode: ATTR_MODE.ABSENT,
			};
		case BINDING.DYNAMIC_ATTRIBUTE:
			return {
				staticBinding,
				markerComment,
				hostElement,
				appliedAttributes: new Map(),
				lastValueHash: UNSET_HASH,
			};
		case BINDING.EVENT:
			return { staticBinding, markerComment, hostElement, eventHandler: null };
		case BINDING.CONTENT:
			return {
				staticBinding,
				startMarker: markerComment!,
				endMarker: endMarker!,
				content: { kind: CONTENT_KIND.UNRESOLVED },
			};
		case BINDING.RAW_CONTENT:
			return {
				staticBinding,
				markerComment: markerComment!,
				valueHash: UNSET_HASH,
			};
		case BINDING.COMMENT:
			return {
				staticBinding,
				startMarker: markerComment!,
				endMarker: endMarker!,
				valueHash: UNSET_HASH,
			};
	}
};

export const commitLiveBinding = (
	liveBinding: LiveBinding,
	values: Array<unknown>,
): void => {
	switch (liveBinding.staticBinding.type) {
		case BINDING.TAG:
			return commitTagLiveBinding(liveBinding as TagLiveBinding, values);
		case BINDING.ATTRIBUTE:
			return commitAttributeLiveBinding(
				liveBinding as AttributeLiveBinding,
				values,
			);
		case BINDING.SINGLE_VALUE_ATTRIBUTE:
			return commitSingleValueAttributeLiveBinding(
				liveBinding as SingleValueAttributeLiveBinding,
				values,
			);
		case BINDING.DYNAMIC_ATTRIBUTE:
			return commitDynamicAttributeLiveBinding(
				liveBinding as DynamicAttributeLiveBinding,
				values,
			);
		case BINDING.EVENT:
			return commitEventLiveBinding(liveBinding as EventLiveBinding, values);
		case BINDING.CONTENT:
			return commitContentLiveBinding(
				liveBinding as ContentLiveBinding,
				values,
			);
		case BINDING.RAW_CONTENT:
			return commitRawContentLiveBinding(
				liveBinding as RawContentLiveBinding,
				values,
			);
		case BINDING.COMMENT:
			return commitCommentLiveBinding(
				liveBinding as CommentLiveBinding,
				values,
			);
	}
};

const targetElement = (liveBinding: {
	hostElement: Element | null;
	markerComment: Comment | null;
}): Element =>
	liveBinding.hostElement ?? liveBinding.markerComment!.nextElementSibling!;

const commitAttributeLiveBinding = (
	liveBinding: AttributeLiveBinding,
	values: Array<unknown>,
): void => {
	const { nameParts, valueParts } = liveBinding.staticBinding;
	const valueHash = combineOrderedHash(
		combinedPartsHash(nameParts, values),
		combinedPartsHash(valueParts, values),
	);
	if (valueHash === liveBinding.valueHash) return;
	liveBinding.valueHash = valueHash;
	const element = targetElement(liveBinding);
	const composedName = composeParts(nameParts, values);
	if (composedName !== liveBinding.lastComposedName) {
		if (liveBinding.lastComposedName !== "")
			element.removeAttribute(liveBinding.lastComposedName);
		liveBinding.lastComposedName = composedName;
	}
	const composedValue = composeParts(valueParts, values);
	if (element.getAttribute(composedName) !== composedValue)
		element.setAttribute(composedName, composedValue);
};

const commitCommentLiveBinding = (
	liveBinding: CommentLiveBinding,
	values: Array<unknown>,
): void => {
	const { parts } = liveBinding.staticBinding;
	const valueHash = combinedPartsHash(parts, values);
	if (valueHash === liveBinding.valueHash) return;
	liveBinding.valueHash = valueHash;
	const composed = composeParts(parts, values);
	const existing = liveBinding.startMarker.nextSibling;
	if (existing === liveBinding.endMarker)
		liveBinding.startMarker.after(document.createComment(composed));
	else (existing as Comment).data = composed;
};

const commitRawContentLiveBinding = (
	liveBinding: RawContentLiveBinding,
	values: Array<unknown>,
): void => {
	const { parts } = liveBinding.staticBinding;
	const valueHash = combinedPartsHash(parts, values);
	if (valueHash === liveBinding.valueHash) return;
	liveBinding.valueHash = valueHash;
	const element = liveBinding.markerComment.nextElementSibling!;
	const composed = composeParts(parts, values);
	if (element.textContent !== composed) element.textContent = composed;
};

const commitTagLiveBinding = (
	liveBinding: TagLiveBinding,
	values: Array<unknown>,
): void => {
	const { parts } = liveBinding.staticBinding;
	const valueHash = combinedPartsHash(parts, values);
	if (valueHash === liveBinding.valueHash) return;
	liveBinding.valueHash = valueHash;
	const element = liveBinding.markerComment.nextElementSibling!;
	const newTag = composeParts(parts, values);
	if (newTag === element.tagName.toLowerCase()) return;
	swapElement(liveBinding, element, newTag);
};

const swapElement = (
	liveBinding: TagLiveBinding,
	element: Element,
	newTag: string,
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
	element.replaceWith(newElement);
	focusElement?.focus();

	const related = liveBinding.relatedLiveBindings;
	for (let index = 0; index < related.length; index++)
		resetLiveBindingGate(related[index]);
};

const resetLiveBindingGate = (liveBinding: LiveBinding): void => {
	switch (liveBinding.staticBinding.type) {
		case BINDING.SINGLE_VALUE_ATTRIBUTE: {
			const single = liveBinding as SingleValueAttributeLiveBinding;
			single.valueHash = UNSET_HASH;
			single.lastComposedName = "";
			single.appliedMode = ATTR_MODE.ABSENT;
			return;
		}
		case BINDING.ATTRIBUTE: {
			const attribute = liveBinding as AttributeLiveBinding;
			attribute.valueHash = UNSET_HASH;
			attribute.lastComposedName = "";
			return;
		}
		case BINDING.DYNAMIC_ATTRIBUTE: {
			const dynamic = liveBinding as DynamicAttributeLiveBinding;
			dynamic.lastValueHash = UNSET_HASH;
			dynamic.appliedAttributes = new Map();
			return;
		}
	}
};

const attributeModeOf = (value: unknown): number => {
	if (value === null || value === undefined || value === false)
		return ATTR_MODE.ABSENT;
	if (isStringable(value)) return ATTR_MODE.ATTRIBUTE;
	return ATTR_MODE.PROPERTY;
};

const revertAttributeMode = (
	element: Element,
	liveBinding: SingleValueAttributeLiveBinding,
): void => {
	switch (liveBinding.appliedMode) {
		case ATTR_MODE.ATTRIBUTE:
			element.removeAttribute(liveBinding.lastComposedName);
			break;
		case ATTR_MODE.PROPERTY:
			delete (element as unknown as Record<string, unknown>)[
				liveBinding.lastComposedName
			];
			nudgeComponent(element);
			break;
	}
	liveBinding.appliedMode = ATTR_MODE.ABSENT;
};

const commitSingleValueAttributeLiveBinding = (
	liveBinding: SingleValueAttributeLiveBinding,
	values: Array<unknown>,
): void => {
	const { nameParts, valueIndex } = liveBinding.staticBinding;
	const value = values[valueIndex];
	const valueHash = combineOrderedHash(
		combinedPartsHash(nameParts, values),
		hashValue(value),
	);
	if (valueHash === liveBinding.valueHash) return;
	liveBinding.valueHash = valueHash;

	const element = targetElement(liveBinding);
	const name = composeParts(nameParts, values);
	if (name !== liveBinding.lastComposedName) {
		revertAttributeMode(element, liveBinding);
		liveBinding.lastComposedName = name;
	}

	const nextMode = attributeModeOf(value);
	if (nextMode !== liveBinding.appliedMode)
		revertAttributeMode(element, liveBinding);
	switch (nextMode) {
		case ATTR_MODE.ATTRIBUTE: {
			const stringValue = String(value);
			if (element.getAttribute(name) !== stringValue)
				element.setAttribute(name, stringValue);
			break;
		}
		case ATTR_MODE.PROPERTY:
			(element as unknown as Record<string, unknown>)[name] = value;
			nudgeComponent(element);
			break;
	}
	liveBinding.appliedMode = nextMode;
};

const commitDynamicAttributeLiveBinding = (
	liveBinding: DynamicAttributeLiveBinding,
	values: Array<unknown>,
): void => {
	const value = values[liveBinding.staticBinding.valueIndex];
	if (!hasValueChanged(liveBinding, value)) return;
	const element = targetElement(liveBinding);
	const desired = normalizeToAttributeMap(value);
	applyAttributeMap(element, liveBinding.appliedAttributes, desired);
	liveBinding.appliedAttributes = desired;
};

const commitEventLiveBinding = (
	liveBinding: EventLiveBinding,
	values: Array<unknown>,
): void => {
	const value = values[liveBinding.staticBinding.valueIndex];
	const nextHandler =
		typeof value === "function" ? (value as EventListener) : null;
	const element = targetElement(liveBinding);
	const { eventType } = liveBinding.staticBinding;
	if (liveBinding.eventHandler !== null)
		element.removeEventListener(eventType, liveBinding.eventHandler);
	if (nextHandler !== null) element.addEventListener(eventType, nextHandler);
	liveBinding.eventHandler = nextHandler;
};

export const contentKindOf = (value: unknown): number =>
	isTemplate(value)
		? CONTENT_KIND.BRANCH
		: Array.isArray(value)
			? CONTENT_KIND.LIST
			: CONTENT_KIND.TEXT;

export const freshContentState = (contentKind: number): ContentState => {
	switch (contentKind) {
		case CONTENT_KIND.TEXT:
			return { kind: CONTENT_KIND.TEXT, lastValueHash: UNSET_HASH };
		case CONTENT_KIND.BRANCH:
			return { kind: CONTENT_KIND.BRANCH, instance: null };
		case CONTENT_KIND.LIST:
			return { kind: CONTENT_KIND.LIST, items: [], aggregateHash: UNSET_HASH };
		default:
			return { kind: CONTENT_KIND.UNRESOLVED };
	}
};

const switchContentKind = (
	liveBinding: ContentLiveBinding,
	contentKind: number,
): void => {
	clearNodeRange(liveBinding.startMarker, liveBinding.endMarker);
	liveBinding.content = freshContentState(contentKind);
};

const coerceToText = (value: unknown): string =>
	value === null || value === undefined ? "" : assertPrimitiveString(value);

const patchTextContent = (
	liveBinding: ContentLiveBinding,
	value: unknown,
): void => {
	const textState = liveBinding.content as TextContentState;
	if (!hasValueChanged(textState, value)) return;
	const text = coerceToText(value);
	const existing = liveBinding.startMarker.nextSibling;
	if (existing === liveBinding.endMarker)
		liveBinding.startMarker.after(document.createTextNode(text));
	else (existing as Text).data = text;
};

const patchBranchContent = (
	liveBinding: ContentLiveBinding,
	value: TemplateValue,
): void => {
	assertNestable(value);
	const branch = liveBinding.content as BranchContentState;
	const mounted = reconcileInstance(branch.instance, value);
	if (mounted === null) return;
	clearNodeRange(liveBinding.startMarker, liveBinding.endMarker);
	liveBinding.startMarker.after(mounted.fragment);
	branch.instance = mounted.instance;
};

const commitContentLiveBinding = (
	liveBinding: ContentLiveBinding,
	values: Array<unknown>,
): void => {
	const value = values[liveBinding.staticBinding.valueIndex];
	const contentKind = contentKindOf(value);
	if (contentKind !== liveBinding.content.kind)
		switchContentKind(liveBinding, contentKind);
	switch (liveBinding.content.kind) {
		case CONTENT_KIND.TEXT:
			return patchTextContent(liveBinding, value);
		case CONTENT_KIND.BRANCH:
			return patchBranchContent(liveBinding, value as TemplateValue);
		case CONTENT_KIND.LIST:
			return patchListContent(liveBinding, value as Array<unknown>);
	}
};

export const computeGateHash = (
	liveBinding: LiveBinding,
	values: Array<unknown>,
): number => {
	const staticBinding = liveBinding.staticBinding;
	switch (staticBinding.type) {
		case BINDING.ATTRIBUTE:
			return combineOrderedHash(
				combinedPartsHash(staticBinding.nameParts, values),
				combinedPartsHash(staticBinding.valueParts, values),
			);
		case BINDING.TAG:
		case BINDING.RAW_CONTENT:
		case BINDING.COMMENT:
			return combinedPartsHash(staticBinding.parts, values);
		default:
			return UNSET_HASH;
	}
};

export const seedOrCommitSingleValue = (
	liveBinding: SingleValueAttributeLiveBinding,
	values: Array<unknown>,
): void => {
	const { nameParts, valueIndex } = liveBinding.staticBinding;
	const value = values[valueIndex];
	const name = composeParts(nameParts, values);
	const mode = attributeModeOf(value);
	liveBinding.lastComposedName = name;
	liveBinding.appliedMode = mode;
	liveBinding.valueHash = combineOrderedHash(
		combinedPartsHash(nameParts, values),
		hashValue(value),
	);
	if (mode === ATTR_MODE.PROPERTY) {
		const element = targetElement(liveBinding);
		(element as unknown as Record<string, unknown>)[name] = value;
		nudgeComponent(element);
	}
};

export const revertHostBinding = (liveBinding: LiveBinding): void => {
	switch (liveBinding.staticBinding.type) {
		case BINDING.ATTRIBUTE: {
			const attribute = liveBinding as AttributeLiveBinding;
			if (attribute.hostElement !== null && attribute.lastComposedName !== "")
				attribute.hostElement.removeAttribute(attribute.lastComposedName);
			return;
		}
		case BINDING.SINGLE_VALUE_ATTRIBUTE: {
			const single = liveBinding as SingleValueAttributeLiveBinding;
			if (single.hostElement !== null)
				revertAttributeMode(single.hostElement, single);
			return;
		}
		case BINDING.DYNAMIC_ATTRIBUTE: {
			const dynamic = liveBinding as DynamicAttributeLiveBinding;
			if (dynamic.hostElement === null) return;
			for (const [name, value] of dynamic.appliedAttributes)
				applyDynamicAttribute(dynamic.hostElement, name, null, value);
			return;
		}
		case BINDING.EVENT: {
			const event = liveBinding as EventLiveBinding;
			if (event.hostElement !== null && event.eventHandler !== null)
				event.hostElement.removeEventListener(
					event.staticBinding.eventType,
					event.eventHandler,
				);
			return;
		}
	}
};
//todo: why?
export { applyDynamicAttribute };
