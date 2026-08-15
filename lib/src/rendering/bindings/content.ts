import { isTemplate, TemplateValue } from "../../template";
import { assertPrimitiveString } from "../../utils/guards";
import { hashValue } from "../../utils/hashing";
import { hasHashChanged } from "../compose";
import { ValueOf } from "../../utils/types";
import { CONTENT_KIND, UNSET_HASH } from "../constants";
import {
	resolveNestedTemplate,
	hydrateInstance,
	isPatchableInPlace,
	mountInstance,
	patchInstance,
} from "../instance";
import { forEachNode, warnOnRejectedServerRange } from "../markers";
import { hydrateListItems, patchListContent } from "./content-list";
import {
	BranchContentState,
	ContentLiveBinding,
	ContentState,
	StyleSheetMoveState,
	TextContentState,
	UnresolvedContentState,
} from "./types";

export const UNRESOLVED_CONTENT: UnresolvedContentState = Object.freeze({
	kind: CONTENT_KIND.UNRESOLVED,
});

const contentKindOf = (value: unknown): ValueOf<typeof CONTENT_KIND> => {
	if (isTemplate(value)) return CONTENT_KIND.BRANCH;
	if (Array.isArray(value)) return CONTENT_KIND.LIST;
	return CONTENT_KIND.TEXT;
};

const createContentState = (
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
	forEachNode(
		liveBinding.startMarker.nextSibling,
		liveBinding.endMarker,
		(node) => node.remove(),
	);
	liveBinding.content = createContentState(contentKind);
};

const coerceToText = (value: unknown): string => {
	const isAbsentContent =
		value === null || value === undefined || typeof value === "boolean";
	return isAbsentContent ? "" : assertPrimitiveString(value);
};

const patchText = (liveBinding: ContentLiveBinding, value: unknown): void => {
	const textState = liveBinding.content as TextContentState;
	if (!hasHashChanged(textState, hashValue(value))) return;
	const text = coerceToText(value);
	const existing = liveBinding.startMarker.nextSibling;
	if (existing !== liveBinding.endMarker) {
		const textNode = existing as Text;
		if (textNode.data !== text) textNode.data = text;
		return;
	}
	if (text !== "") liveBinding.startMarker.after(document.createTextNode(text));
};

const patchBranch = (
	liveBinding: ContentLiveBinding,
	value: TemplateValue,
	moveState: StyleSheetMoveState,
): void => {
	const parsed = resolveNestedTemplate(value);
	const branch = liveBinding.content as BranchContentState;
	if (isPatchableInPlace(branch.instance, parsed)) {
		patchInstance(branch.instance, value.values);
		return;
	}
	const { instance, fragment } = mountInstance(value, moveState);
	forEachNode(
		liveBinding.startMarker.nextSibling,
		liveBinding.endMarker,
		(node) => node.remove(),
	);
	liveBinding.startMarker.after(fragment);
	branch.instance = instance;
};

export const commitContent = (
	liveBinding: ContentLiveBinding,
	values: Array<unknown>,
	moveState: StyleSheetMoveState,
): void => {
	const value = values[liveBinding.staticBinding.valueIndex];
	const contentKind = contentKindOf(value);
	if (contentKind !== liveBinding.content.kind)
		switchContentKind(liveBinding, contentKind);
	switch (liveBinding.content.kind) {
		case CONTENT_KIND.TEXT:
			return patchText(liveBinding, value);
		case CONTENT_KIND.BRANCH:
			return patchBranch(liveBinding, value as TemplateValue, moveState);
		case CONTENT_KIND.LIST:
			return patchListContent(liveBinding, value as Array<unknown>, moveState);
	}
};

//one text write destroys nothing, so an adoptable text range is repaired by patchText rather than
//rejected; anything else in the range means the server rendered a different kind and it is not ours
const isAdoptableTextRange = ({
	startMarker,
	endMarker,
}: ContentLiveBinding): boolean => {
	const serverNode = startMarker.nextSibling;
	return (
		serverNode === endMarker ||
		(serverNode instanceof Text && serverNode.nextSibling === endMarker)
	);
};

const hydrateBranch = (
	liveBinding: ContentLiveBinding,
	value: TemplateValue,
	moveState: StyleSheetMoveState,
	walker: TreeWalker,
): boolean => {
	resolveNestedTemplate(value);
	const instance = hydrateInstance(
		walker,
		value,
		liveBinding.endMarker,
		moveState,
	);
	if (instance === null) return false;
	(liveBinding.content as BranchContentState).instance = instance;
	return true;
};

export const hydrateContent = (
	liveBinding: ContentLiveBinding,
	values: Array<unknown>,
	moveState: StyleSheetMoveState,
	walker: TreeWalker,
): void => {
	const value = values[liveBinding.staticBinding.valueIndex];
	const kind = contentKindOf(value);
	liveBinding.content = createContentState(kind);

	switch (kind) {
		case CONTENT_KIND.TEXT:
			if (isAdoptableTextRange(liveBinding))
				return patchText(liveBinding, value);
			break;
		case CONTENT_KIND.BRANCH:
			if (hydrateBranch(liveBinding, value as TemplateValue, moveState, walker))
				return;
			break;
		case CONTENT_KIND.LIST:
			if (
				hydrateListItems(
					liveBinding,
					value as Array<unknown>,
					moveState,
					walker,
				)
			)
				return;
	}

	warnOnRejectedServerRange();
	switchContentKind(liveBinding, CONTENT_KIND.UNRESOLVED);
	commitContent(liveBinding, values, moveState);
};
