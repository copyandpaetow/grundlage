import { BINDING } from "../../parser/constants";
import { StaticBinding } from "../../parser/types";
import { combinedPartsHash, composeParts } from "../compose";
import {
	ATTR_MODE,
	combineOrderedHash,
	CONTENT_KIND,
	UNSET_HASH,
} from "../constants";
import { commitAttribute } from "./attribute";
import {
	applyDynamicAttribute,
	commitDynamic,
	reapplyOnSwap as reapplyDynamicOnSwap,
	seedDynamic,
} from "./attribute-dynamic";
import {
	commitSingleValue,
	reapplyOnSwap as reapplySingleValueOnSwap,
	revertAttributeMode,
	seedOrCommitSingleValue,
} from "./attribute-single-value";
import { commitComment } from "./comment";
import { commitContent, seedContentByAdoption } from "./content";
import { commitRawContent } from "./content-raw";
import {
	commitNamedDynamic,
	reapplyOnSwap as reapplyNamedDynamicOnSwap,
} from "./named-dynamic";
import { commitTag } from "./tag";
import {
	AttributeLiveBinding,
	CommentLiveBinding,
	ContentLiveBinding,
	DynamicAttributeLiveBinding,
	NamedDynamicLiveBinding,
	LiveBinding,
	RawContentLiveBinding,
	SingleValueAttributeLiveBinding,
	TagLiveBinding,
} from "./types";

const NO_SIBLINGS: Array<LiveBinding> = [];

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
		case BINDING.NAMED_DYNAMIC:
			return {
				staticBinding,
				markerComment,
				hostElement,
				valueHash: UNSET_HASH,
				lastValue: undefined,
			};
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
				markerComment: markerComment!,
				valueHash: UNSET_HASH,
			};
	}
};

export const commitLiveBinding = (
	liveBinding: LiveBinding,
	values: Array<unknown>,
	siblings: Array<LiveBinding> = NO_SIBLINGS,
): void => {
	switch (liveBinding.staticBinding.type) {
		case BINDING.TAG:
			return commitTag(liveBinding as TagLiveBinding, values, siblings);
		case BINDING.ATTRIBUTE:
			return commitAttribute(liveBinding as AttributeLiveBinding, values);
		case BINDING.SINGLE_VALUE_ATTRIBUTE:
			return commitSingleValue(
				liveBinding as SingleValueAttributeLiveBinding,
				values,
			);
		case BINDING.DYNAMIC_ATTRIBUTE:
			return commitDynamic(liveBinding as DynamicAttributeLiveBinding, values);
		case BINDING.NAMED_DYNAMIC:
			return commitNamedDynamic(
				liveBinding as NamedDynamicLiveBinding,
				values,
			);
		case BINDING.CONTENT:
			return commitContent(liveBinding as ContentLiveBinding, values);
		case BINDING.RAW_CONTENT:
			return commitRawContent(liveBinding as RawContentLiveBinding, values);
		case BINDING.COMMENT:
			return commitComment(liveBinding as CommentLiveBinding, values);
	}
};

export const seedLiveBinding = (
	liveBinding: LiveBinding,
	values: Array<unknown>,
): void => {
	switch (liveBinding.staticBinding.type) {
		case BINDING.NAMED_DYNAMIC:
			return commitLiveBinding(liveBinding, values);
		case BINDING.SINGLE_VALUE_ATTRIBUTE:
			return seedOrCommitSingleValue(
				liveBinding as SingleValueAttributeLiveBinding,
				values,
			);
		case BINDING.DYNAMIC_ATTRIBUTE:
			return seedDynamic(liveBinding as DynamicAttributeLiveBinding, values);
		case BINDING.CONTENT:
			return seedContentByAdoption(liveBinding as ContentLiveBinding, values);
		case BINDING.ATTRIBUTE: {
			const attribute = liveBinding as AttributeLiveBinding;
			attribute.lastComposedName = composeParts(
				attribute.staticBinding.nameParts,
				values,
			);
			attribute.valueHash = computeGateHash(liveBinding, values);
			return;
		}
		default:
			(liveBinding as { valueHash: number }).valueHash = computeGateHash(
				liveBinding,
				values,
			);
	}
};

const computeGateHash = (
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

export const reapplyOnSwap = (
	liveBinding:
		| SingleValueAttributeLiveBinding
		| DynamicAttributeLiveBinding
		| NamedDynamicLiveBinding,
	element: Element,
	values: Array<unknown>,
): void => {
	//todo: should be a switch statement
	if (liveBinding.staticBinding.type === BINDING.SINGLE_VALUE_ATTRIBUTE)
		reapplySingleValueOnSwap(
			liveBinding as SingleValueAttributeLiveBinding,
			element,
			values,
		);
	else if (liveBinding.staticBinding.type === BINDING.DYNAMIC_ATTRIBUTE)
		reapplyDynamicOnSwap(
			liveBinding as DynamicAttributeLiveBinding,
			element,
			values,
		);
	else reapplyNamedDynamicOnSwap(liveBinding as NamedDynamicLiveBinding, element);
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
			for (const [name, entry] of dynamic.appliedAttributes)
				applyDynamicAttribute(dynamic.hostElement, name, null, entry.value);
			return;
		}
		case BINDING.NAMED_DYNAMIC: {
			const named = liveBinding as NamedDynamicLiveBinding;
			if (named.hostElement !== null)
				applyDynamicAttribute(
					named.hostElement,
					named.staticBinding.name,
					null,
					named.lastValue,
				);
			return;
		}
	}
};
