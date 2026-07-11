import { isTemplate, TemplateValue } from "../../template";
import { assertPrimitiveString } from "../../utils/guards";
import { hashValue } from "../../utils/hashing";
import { hasValueChanged } from "../compose";
import { CONTENT_KIND, UNSET_HASH } from "../constants";
import {
	assertNestable,
	hydrateInstance,
	reconcileInstance,
} from "../instance";
import { clearNodeRange } from "../range";
import { hydrateListItems, patchListContent } from "./content-list";
import {
	BranchContentState,
	ContentLiveBinding,
	ContentState,
	TextContentState,
} from "./types";

const contentKindOf = (value: unknown): number =>
	isTemplate(value)
		? CONTENT_KIND.BRANCH
		: Array.isArray(value)
			? CONTENT_KIND.LIST
			: CONTENT_KIND.TEXT;

const freshContentState = (contentKind: number): ContentState => {
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

const patchText = (liveBinding: ContentLiveBinding, value: unknown): void => {
	const textState = liveBinding.content as TextContentState;
	if (!hasValueChanged(textState, value)) return;
	const text = coerceToText(value);
	const existing = liveBinding.startMarker.nextSibling;
	if (existing === liveBinding.endMarker)
		liveBinding.startMarker.after(document.createTextNode(text));
	else (existing as Text).data = text;
};

const patchBranch = (
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

export const commitContent = (
	liveBinding: ContentLiveBinding,
	values: Array<unknown>,
): void => {
	const value = values[liveBinding.staticBinding.valueIndex];
	const contentKind = contentKindOf(value);
	if (contentKind !== liveBinding.content.kind)
		switchContentKind(liveBinding, contentKind);
	switch (liveBinding.content.kind) {
		case CONTENT_KIND.TEXT:
			return patchText(liveBinding, value);
		case CONTENT_KIND.BRANCH:
			return patchBranch(liveBinding, value as TemplateValue);
		case CONTENT_KIND.LIST:
			return patchListContent(liveBinding, value as Array<unknown>);
	}
};

export const seedContentByAdoption = (
	liveBinding: ContentLiveBinding,
	values: Array<unknown>,
): void => {
	const value = values[liveBinding.staticBinding.valueIndex];
	const kind = contentKindOf(value);
	liveBinding.content = freshContentState(kind);
	switch (kind) {
		case CONTENT_KIND.TEXT:
			(liveBinding.content as TextContentState).lastValueHash = hashValue(value);
			return;
		case CONTENT_KIND.BRANCH:
			assertNestable(value as TemplateValue);
			(liveBinding.content as BranchContentState).instance = hydrateInstance(
				value as TemplateValue,
				liveBinding.startMarker,
			);
			return;
		case CONTENT_KIND.LIST:
			return hydrateListItems(liveBinding, value as Array<unknown>);
	}
};
