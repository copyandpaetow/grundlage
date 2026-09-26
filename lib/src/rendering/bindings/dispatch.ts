import { BINDING } from "../../parser/constants";
import { StaticBinding } from "../../parser/types";
import { UNSET_HASH } from "../constants";
import { elementAfterMarker } from "../markers";
import { commitAttribute, removeWrittenAttribute } from "./attribute";
import { commitDynamic } from "./attribute-dynamic";
import { applyAttributeValue } from "./attribute-write";
import { commitComment } from "./comment";
import { commitContent, UNRESOLVED_CONTENT } from "./content";
import { createStyleSheetState, seedDeclarationValueHashes } from "./css-apply";
import { commitRawContent } from "./content-raw";
import { commitTag } from "./tag";
import {
	AttributeLaneLiveBinding,
	AttributeLiveBinding,
	CommentLiveBinding,
	ContentLiveBinding,
	DynamicAttributeLiveBinding,
	Instance,
	isAttributeBinding,
	isRawContentBinding,
	LiveBinding,
	RawContentLiveBinding,
	TagLiveBinding,
} from "./types";

const resolveAnchorElement = (anchor: Comment | Element): Element =>
	anchor instanceof Comment ? elementAfterMarker(anchor) : anchor;

export const createLiveBinding = (
	staticBinding: StaticBinding,
	anchor: Comment | Element | null,
	closeMarker: Comment | null = null,
): LiveBinding => {
	switch (staticBinding.type) {
		case BINDING.TAG:
			return {
				staticBinding,
				openMarker: anchor as Comment,
				lastValueHash: UNSET_HASH,
			};
		case BINDING.ATTRIBUTE:
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
				commitNumber: 0,
			};
		case BINDING.CONTENT:
			return {
				staticBinding,
				openMarker: anchor as Comment,
				closeMarker: closeMarker!,
				content: UNRESOLVED_CONTENT,
			};
		case BINDING.RAW_CONTENT: {
			const openMarker = anchor as Comment;
			const styleSheetState =
				staticBinding.compiledStyleSheet === null
					? null
					: createStyleSheetState(
							staticBinding.compiledStyleSheet,
							elementAfterMarker(openMarker) as HTMLStyleElement,
						);
			return {
				staticBinding,
				openMarker,
				lastValueHash: UNSET_HASH,
				styleSheetState,
			};
		}
		case BINDING.COMMENT:
			return {
				staticBinding,
				openMarker: anchor as Comment,
				lastValueHash: UNSET_HASH,
			};
		default:
			return staticBinding satisfies never;
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
		default:
			return liveBinding.staticBinding satisfies never;
	}
};

export const hydrateLiveBinding = (
	instance: Instance,
	liveBinding: LiveBinding,
	values: Array<unknown>,
): void => {
	//the server sheet text already carries these values, so seeding here is what makes the first
	//CSSOM bind inside the commit below find every declaration unchanged
	if (isRawContentBinding(liveBinding) && liveBinding.styleSheetState)
		seedDeclarationValueHashes(liveBinding, values);
	commitLiveBinding(instance, liveBinding, values);
};

//every host binding is committed before its instance is stored, so each one here holds the name it
//wrote and the last branch is the only kind left
export const revertHostBinding = (
	liveBinding: AttributeLaneLiveBinding,
): void => {
	if (isAttributeBinding(liveBinding))
		return removeWrittenAttribute(liveBinding, liveBinding.lastComposedName);
	for (const [name, entry] of liveBinding.appliedAttributes)
		applyAttributeValue(liveBinding.anchor, name, null, entry.value);
};
