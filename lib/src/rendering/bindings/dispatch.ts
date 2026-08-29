import { BINDING } from "../../parser/constants";
import { StaticBinding } from "../../parser/types";
import { Instance } from "../instance";
import { UNSET_HASH } from "../constants";
import { commitAttribute } from "./attribute";
import {
	commitDynamic,
	reapplyOnSwap as reapplyDynamicOnSwap,
} from "./attribute-dynamic";
import {
	commitSingleValue,
	reapplyOnSwap as reapplySingleValueOnSwap,
} from "./attribute-single-value";
import { applyAttributeValue } from "./attribute-write";
import { commitComment } from "./comment";
import { commitContent, UNRESOLVED_CONTENT } from "./content";
import { createStyleSheetState, seedDeclarationValueHashes } from "./css-apply";
import { commitRawContent } from "./content-raw";
import { commitTag } from "./tag";
import {
	AttributeLiveBinding,
	CommentLiveBinding,
	ContentLiveBinding,
	DynamicAttributeLiveBinding,
	LiveBinding,
	RawContentLiveBinding,
	SingleValueAttributeLiveBinding,
	TagLiveBinding,
} from "./types";

const resolveAnchorElement = (anchor: Comment | Element): Element =>
	anchor instanceof Comment ? anchor.nextElementSibling! : anchor;

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
				anchor: resolveAnchorElement(anchor!),
				lastValueHash: UNSET_HASH,
				lastComposedName: "",
			};
		case BINDING.SINGLE_VALUE_ATTRIBUTE:
			return {
				staticBinding,
				anchor: resolveAnchorElement(anchor!),
				lastValueHash: UNSET_HASH,
				lastComposedName: "",
				lastValue: undefined,
			};
		case BINDING.DYNAMIC_ATTRIBUTE:
			return {
				staticBinding,
				anchor: resolveAnchorElement(anchor!),
				appliedAttributes: new Map(),
				lastValueHash: UNSET_HASH,
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
	commitLiveBinding(instance, liveBinding, values);
};

export const reapplyOnSwap = (
	liveBinding: SingleValueAttributeLiveBinding | DynamicAttributeLiveBinding,
	element: Element,
): void =>
	liveBinding.staticBinding.type === BINDING.SINGLE_VALUE_ATTRIBUTE
		? reapplySingleValueOnSwap(
				liveBinding as SingleValueAttributeLiveBinding,
				element,
			)
		: reapplyDynamicOnSwap(
				liveBinding as DynamicAttributeLiveBinding,
				element,
			);

export const revertHostBinding = (liveBinding: LiveBinding): void => {
	switch (liveBinding.staticBinding.type) {
		case BINDING.ATTRIBUTE: {
			const attribute = liveBinding as AttributeLiveBinding;
			if (attribute.lastComposedName !== "")
				attribute.anchor.removeAttribute(attribute.lastComposedName);
			return;
		}
		case BINDING.SINGLE_VALUE_ATTRIBUTE: {
			const single = liveBinding as SingleValueAttributeLiveBinding;
			if (single.lastComposedName !== "")
				applyAttributeValue(
					single.anchor,
					single.lastComposedName,
					null,
					single.lastValue,
				);
			return;
		}
		case BINDING.DYNAMIC_ATTRIBUTE: {
			const dynamic = liveBinding as DynamicAttributeLiveBinding;
			for (const [name, entry] of dynamic.appliedAttributes)
				applyAttributeValue(dynamic.anchor, name, null, entry.value);
			return;
		}
	}
};
