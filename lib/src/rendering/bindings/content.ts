import { isTemplate, TemplateValue } from "../../template";
import { assertPrimitiveString } from "../../utils/guards";
import { hashValue } from "../../utils/hashing";
import { hasHashChanged } from "../compose";
import { ValueOf } from "../../utils/types";
import { CONTENT_KIND, UNSET_HASH } from "../constants";
import {
	assertNestable,
	hydrateInstance,
	reconcileInstance,
	releaseContent,
	releaseInstance,
} from "../instance";
import { forEachInRange } from "../range";
import { hydrateListItems, patchListContent } from "./content-list";
import {
	BranchContentState,
	Carrier,
	ContentLiveBinding,
	ContentState,
	TextContentState,
	UnresolvedContentState,
} from "./types";

//no mutable fields and only ever replaced, never written — one frozen instance is shared
export const UNRESOLVED_CONTENT: UnresolvedContentState = Object.freeze({
	kind: CONTENT_KIND.UNRESOLVED,
});

const contentKindOf = (value: unknown): ValueOf<typeof CONTENT_KIND> => {
	if (isTemplate(value)) return CONTENT_KIND.BRANCH;
	if (Array.isArray(value)) return CONTENT_KIND.LIST;
	return CONTENT_KIND.TEXT;
};

const freshContentState = (
	contentKind: ValueOf<typeof CONTENT_KIND>,
): ContentState => {
	switch (contentKind) {
		case CONTENT_KIND.TEXT:
			return { kind: CONTENT_KIND.TEXT, lastValueHash: UNSET_HASH };
		case CONTENT_KIND.BRANCH:
			return { kind: CONTENT_KIND.BRANCH, instance: null };
		case CONTENT_KIND.LIST:
			return {
				kind: CONTENT_KIND.LIST,
				items: [],
				aggregateHash: UNSET_HASH,
				itemHashes: [],
			};
		default:
			return UNRESOLVED_CONTENT;
	}
};

const switchContentKind = (
	liveBinding: ContentLiveBinding,
	contentKind: ValueOf<typeof CONTENT_KIND>,
): void => {
	forEachInRange(
		liveBinding.startMarker.nextSibling,
		liveBinding.endMarker,
		(node) => node.remove(),
	);
	releaseContent(liveBinding.content);
	liveBinding.content = freshContentState(contentKind);
};

const coerceToText = (value: unknown): string =>
	value === null || value === undefined ? "" : assertPrimitiveString(value);

const patchText = (liveBinding: ContentLiveBinding, value: unknown): void => {
	const textState = liveBinding.content as TextContentState;
	if (!hasHashChanged(textState, hashValue(value))) return;
	const text = coerceToText(value);
	const existing = liveBinding.startMarker.nextSibling;
	if (existing === liveBinding.endMarker)
		liveBinding.startMarker.after(document.createTextNode(text));
	else (existing as Text).data = text;
};

const patchBranch = (
	liveBinding: ContentLiveBinding,
	value: TemplateValue,
	carrier: Carrier,
): void => {
	assertNestable(value);
	const branch = liveBinding.content as BranchContentState;
	const mounted = reconcileInstance(branch.instance, value, carrier);
	if (mounted === null) return;
	if (branch.instance !== null) releaseInstance(branch.instance);
	forEachInRange(
		liveBinding.startMarker.nextSibling,
		liveBinding.endMarker,
		(node) => node.remove(),
	);
	liveBinding.startMarker.after(mounted.fragment);
	branch.instance = mounted.instance;
};

export const commitContent = (
	liveBinding: ContentLiveBinding,
	values: Array<unknown>,
	carrier: Carrier,
): void => {
	const value = values[liveBinding.staticBinding.valueIndex];
	const contentKind = contentKindOf(value);
	if (contentKind !== liveBinding.content.kind)
		switchContentKind(liveBinding, contentKind);
	switch (liveBinding.content.kind) {
		case CONTENT_KIND.TEXT:
			return patchText(liveBinding, value);
		case CONTENT_KIND.BRANCH:
			return patchBranch(liveBinding, value as TemplateValue, carrier);
		case CONTENT_KIND.LIST:
			return patchListContent(liveBinding, value as Array<unknown>, carrier);
	}
};

export const hydrateContent = (
	liveBinding: ContentLiveBinding,
	values: Array<unknown>,
	carrier: Carrier,
): void => {
	const value = values[liveBinding.staticBinding.valueIndex];
	const kind = contentKindOf(value);
	liveBinding.content = freshContentState(kind);
	switch (kind) {
		case CONTENT_KIND.TEXT:
			(liveBinding.content as TextContentState).lastValueHash =
				hashValue(value);
			return;
		case CONTENT_KIND.BRANCH:
			assertNestable(value as TemplateValue);
			(liveBinding.content as BranchContentState).instance = hydrateInstance(
				value as TemplateValue,
				liveBinding.startMarker,
				carrier,
			);
			return;
		case CONTENT_KIND.LIST:
			return hydrateListItems(liveBinding, value as Array<unknown>, carrier);
	}
};
