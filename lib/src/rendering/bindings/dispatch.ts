import { BINDING } from "../../parser/constants";
import { StaticBinding } from "../../parser/types";
import { Instance } from "../instance";
import { ATTRIBUTE_MODE, UNSET_HASH } from "../constants";
import { commitAttribute } from "./attribute";
import {
	applyDynamicAttribute,
	commitDynamic,
	reapplyOnSwap as reapplyDynamicOnSwap,
} from "./attribute-dynamic";
import {
	commitSingleValue,
	reapplyOnSwap as reapplySingleValueOnSwap,
	clearAppliedAttribute,
} from "./attribute-single-value";
import { commitComment } from "./comment";
import { commitContent, UNRESOLVED_CONTENT } from "./content";
import { createStyleSheetState, seedDeclarationValueHashes } from "./css-apply";
import { commitRawContent } from "./content-raw";
import {
	commitNamedDynamic,
	reapplyOnSwap as reapplyNamedDynamicOnSwap,
} from "./attribute-named-dynamic";
import { commitTag } from "./tag";
import {
	AttributeLiveBinding,
	CommentLiveBinding,
	ContentLiveBinding,
	DynamicAttributeLiveBinding,
	LiveBinding,
	NamedDynamicLiveBinding,
	RawContentLiveBinding,
	SingleValueAttributeLiveBinding,
	TagLiveBinding,
} from "./types";

export const createLiveBinding = (
	staticBinding: StaticBinding,
	anchor: Comment | Element | null,
	endMarker: Comment | null = null,
): LiveBinding => {
	switch (staticBinding.type) {
		case BINDING.TAG:
			return {
				staticBinding,
				markerComment: anchor as Comment,
				lastValueHash: UNSET_HASH,
			};
		case BINDING.ATTRIBUTE:
			return {
				staticBinding,
				anchor: anchor!,
				lastValueHash: UNSET_HASH,
				lastComposedName: "",
			};
		case BINDING.SINGLE_VALUE_ATTRIBUTE:
			return {
				staticBinding,
				anchor: anchor!,
				lastValueHash: UNSET_HASH,
				lastComposedName: "",
				appliedAttributeMode: ATTRIBUTE_MODE.ABSENT,
			};
		case BINDING.DYNAMIC_ATTRIBUTE:
			return {
				staticBinding,
				anchor: anchor!,
				appliedAttributes: new Map(),
				lastValueHash: UNSET_HASH,
			};
		case BINDING.NAMED_DYNAMIC:
			return {
				staticBinding,
				anchor: anchor!,
				lastValueHash: UNSET_HASH,
				lastValue: undefined,
			};
		case BINDING.CONTENT:
			return {
				staticBinding,
				startMarker: anchor as Comment,
				endMarker: endMarker!,
				content: UNRESOLVED_CONTENT,
			};
		case BINDING.RAW_CONTENT: {
			const markerComment = anchor as Comment;
			const styleSheetState =
				staticBinding.compiledStyleSheet === null
					? null
					: createStyleSheetState(
							staticBinding.compiledStyleSheet,
							markerComment.nextElementSibling as HTMLStyleElement,
						);
			return {
				staticBinding,
				markerComment,
				lastValueHash: UNSET_HASH,
				styleSheetState,
			};
		}
		case BINDING.COMMENT:
			return {
				staticBinding,
				markerComment: anchor as Comment,
				lastValueHash: UNSET_HASH,
			};
	}
};

export const commitLiveBinding = (
	instance: Instance,
	liveBinding: LiveBinding,
	values: Array<unknown>,
): void => {
	switch (liveBinding.staticBinding.type) {
		case BINDING.TAG:
			return commitTag(
				liveBinding as TagLiveBinding,
				values,
				instance.liveBindings,
			);
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
			return commitNamedDynamic(liveBinding as NamedDynamicLiveBinding, values);
		case BINDING.CONTENT:
			return commitContent(
				liveBinding as ContentLiveBinding,
				values,
				instance.moveState,
			);
		case BINDING.RAW_CONTENT:
			return commitRawContent(liveBinding as RawContentLiveBinding, values);
		case BINDING.COMMENT:
			return commitComment(liveBinding as CommentLiveBinding, values);
	}
};

export const hydrateLiveBinding = (
	instance: Instance,
	liveBinding: LiveBinding,
	values: Array<unknown>,
): void => {
	const { type } = liveBinding.staticBinding;
	//the server sheet text already carries these values, so seeding here is what makes the first
	//CSSOM bind inside the commit below find every declaration unchanged
	if (type === BINDING.RAW_CONTENT) {
		const rawContent = liveBinding as RawContentLiveBinding;
		if (rawContent.styleSheetState)
			seedDeclarationValueHashes(rawContent, values);
	}
	//every other lane skips an unchanged write and repairs a diverged one, which is what adopting
	//server output means; commit is the seeding pass, not a second one
	commitLiveBinding(instance, liveBinding, values);
};

export const reapplyOnSwap = (
	liveBinding:
		| SingleValueAttributeLiveBinding
		| DynamicAttributeLiveBinding
		| NamedDynamicLiveBinding,
	element: Element,
	values: Array<unknown>,
): void => {
	switch (liveBinding.staticBinding.type) {
		case BINDING.SINGLE_VALUE_ATTRIBUTE:
			return reapplySingleValueOnSwap(
				liveBinding as SingleValueAttributeLiveBinding,
				element,
				values,
			);
		case BINDING.DYNAMIC_ATTRIBUTE:
			return reapplyDynamicOnSwap(
				liveBinding as DynamicAttributeLiveBinding,
				element,
				values,
			);
		default:
			return reapplyNamedDynamicOnSwap(
				liveBinding as NamedDynamicLiveBinding,
				element,
			);
	}
};

export const revertHostBinding = (liveBinding: LiveBinding): void => {
	switch (liveBinding.staticBinding.type) {
		case BINDING.ATTRIBUTE: {
			const attribute = liveBinding as AttributeLiveBinding;
			const { anchor } = attribute;
			if (anchor instanceof Element && attribute.lastComposedName !== "")
				anchor.removeAttribute(attribute.lastComposedName);
			return;
		}
		case BINDING.SINGLE_VALUE_ATTRIBUTE: {
			const single = liveBinding as SingleValueAttributeLiveBinding;
			if (single.anchor instanceof Element)
				clearAppliedAttribute(single.anchor, single);
			return;
		}
		case BINDING.DYNAMIC_ATTRIBUTE: {
			const dynamic = liveBinding as DynamicAttributeLiveBinding;
			const { anchor } = dynamic;
			if (!(anchor instanceof Element)) return;
			for (const [name, entry] of dynamic.appliedAttributes)
				applyDynamicAttribute(anchor, name, null, entry.value);
			return;
		}
		case BINDING.NAMED_DYNAMIC: {
			const named = liveBinding as NamedDynamicLiveBinding;
			if (named.anchor instanceof Element)
				applyDynamicAttribute(
					named.anchor,
					named.staticBinding.name,
					null,
					named.lastValue,
				);
			return;
		}
	}
};
