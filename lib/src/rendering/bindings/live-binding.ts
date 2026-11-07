import { STYLE_SHEET_NOT_COMPILED } from "../../parser/constants";
import * as BINDING from "../../parser/binding";
import {
	AttributeStaticBinding,
	ContentStaticBinding,
	DynamicAttributeStaticBinding,
	StaticBinding,
} from "../../parser/types";
import { NO_ATTRIBUTE_WRITTEN, UNSET_HASH } from "../constants";
import * as STYLE_SHEET_LANE from "../style-sheet-lane";
import { elementAfterMarker } from "../markers";
import { commitAttribute, removeWrittenAttribute } from "./attribute";
import { commitDynamic } from "./attribute-dynamic";
import { applyAttributeValue } from "./attribute-apply";
import { commitComment } from "./comment";
import { commitContent, UNRESOLVED_CONTENT } from "./content";
import {
	createCSSOMStyleSheetLane,
	seedDeclarationValueHashes,
	TEXT_STYLE_SHEET_LANE,
} from "./style-sheet";
import { commitRawContent } from "./content-raw";
import { commitTag } from "./tag";
import {
	commitTemplateContent,
	hydrateTemplateContent,
} from "./content-template";
import {
	AttributeLaneLiveBinding,
	AttributeLiveBinding,
	CommentLiveBinding,
	ContentLiveBinding,
	DynamicAttributeLiveBinding,
	Instance,
	isAttributeBinding,
	isRawContentBinding,
	isTemplateContentBinding,
	LiveBinding,
	RawContentLiveBinding,
	TagLiveBinding,
	TemplateContentLiveBinding,
} from "./types";
import { assertDuringDevelopment } from "../../utils/diagnostics";

export const createAttributeLaneLiveBinding = (
	staticBinding: AttributeStaticBinding | DynamicAttributeStaticBinding,
	anchor: Element,
): AttributeLaneLiveBinding => {
	switch (staticBinding.type) {
		case BINDING.ATTRIBUTE:
			return {
				staticBinding,
				anchor,
				lastValueHash: UNSET_HASH,
				lastComposedName: NO_ATTRIBUTE_WRITTEN,
				lastValue: undefined,
			};
		case BINDING.DYNAMIC_ATTRIBUTE:
			return {
				staticBinding,
				anchor,
				appliedAttributes: new Map(),
				lastValueHash: UNSET_HASH,
			};
		default:
			return staticBinding satisfies never;
	}
};

export const createContentLiveBinding = (
	staticBinding: ContentStaticBinding,
	openMarker: Comment,
	closeMarker: Comment,
): ContentLiveBinding => ({
	staticBinding,
	openMarker,
	closeMarker,
	content: UNRESOLVED_CONTENT,
});

//every kind but content: those need only their open marker
export const createMarkedLiveBinding = (
	staticBinding: Exclude<StaticBinding, ContentStaticBinding>,
	openMarker: Comment,
): LiveBinding => {
	switch (staticBinding.type) {
		case BINDING.TAG:
			return { staticBinding, openMarker, lastValueHash: UNSET_HASH };
		case BINDING.COMMENT:
			return { staticBinding, openMarker, lastValueHash: UNSET_HASH };
		case BINDING.TEMPLATE_CONTENT:
			return { staticBinding, openMarker, lastValueHash: UNSET_HASH };
		case BINDING.ATTRIBUTE:
		case BINDING.DYNAMIC_ATTRIBUTE:
			return createAttributeLaneLiveBinding(
				staticBinding,
				elementAfterMarker(openMarker),
			);
		case BINDING.RAW_CONTENT: {
			const { compiledStyleSheet } = staticBinding;
			return {
				staticBinding,
				openMarker,
				lastValueHash: UNSET_HASH,
				styleSheetLane:
					compiledStyleSheet === STYLE_SHEET_NOT_COMPILED
						? TEXT_STYLE_SHEET_LANE
						: createCSSOMStyleSheetLane(
								compiledStyleSheet,
								//the parser compiles a sheet only for a <style>
								elementAfterMarker(openMarker) as HTMLStyleElement,
							),
			};
		}
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
			commitTag(liveBinding as TagLiveBinding, values, instance.liveBindings);
			break;
		case BINDING.ATTRIBUTE:
			commitAttribute(
				liveBinding as AttributeLiveBinding,
				values,
				instance.treeState,
			);
			break;
		case BINDING.DYNAMIC_ATTRIBUTE:
			commitDynamic(
				liveBinding as DynamicAttributeLiveBinding,
				values,
				instance.treeState,
			);
			break;
		case BINDING.CONTENT:
			commitContent(
				liveBinding as ContentLiveBinding,
				values,
				instance.treeState,
			);
			break;
		case BINDING.RAW_CONTENT:
			commitRawContent(liveBinding as RawContentLiveBinding, values);
			break;
		case BINDING.COMMENT:
			commitComment(liveBinding as CommentLiveBinding, values);
			break;
		case BINDING.TEMPLATE_CONTENT:
			commitTemplateContent(liveBinding as TemplateContentLiveBinding, values);
			break;
		default:
			return liveBinding.staticBinding satisfies never;
	}
};

export const hydrateLiveBinding = (
	instance: Instance,
	liveBinding: LiveBinding,
	values: Array<unknown>,
): void => {
	if (isTemplateContentBinding(liveBinding)) {
		hydrateTemplateContent(liveBinding, values);
		return;
	}
	//the server sheet text already carries these values, so seeding here is what makes the first
	//CSSOM bind inside the commit below find every declaration unchanged
	if (
		isRawContentBinding(liveBinding) &&
		liveBinding.styleSheetLane.kind === STYLE_SHEET_LANE.CSSOM
	)
		seedDeclarationValueHashes(liveBinding.styleSheetLane, values);
	commitLiveBinding(instance, liveBinding, values);
};

export const revertHostBinding = (
	liveBinding: AttributeLaneLiveBinding,
): void => {
	if (isAttributeBinding(liveBinding)) {
		assertDuringDevelopment(
			liveBinding.lastComposedName !== NO_ATTRIBUTE_WRITTEN,
			"a host binding is committed before its instance is stored",
		);
		removeWrittenAttribute(liveBinding, liveBinding.lastComposedName);
		return;
	}
	for (const [name, entry] of liveBinding.appliedAttributes)
		applyAttributeValue(liveBinding.anchor, name, undefined, entry.value);
};
