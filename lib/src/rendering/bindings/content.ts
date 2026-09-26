import { isTemplate, TemplateValue } from "../../template";
import { assertPrimitiveString } from "../../utils/guards";
import { hashValue } from "../value-hashing";
import { claimHashChange } from "../compose";
import { ValueOf } from "../../utils/types";
import { CONTENT_KIND, UNSET_HASH } from "../constants";
import {
	resolveNestedTemplate,
	hydrateInstance,
	isPatchableInPlace,
	mountInstance,
	patchInstance,
} from "../instance";
import { clearRange, warnOnRejectedServerRange } from "../markers";
import {
	EMPTY_LIST_SCRATCH,
	hydrateListItems,
	patchListContent,
} from "./content-list";
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

type ResolvedContentKind = Exclude<
	ValueOf<typeof CONTENT_KIND>,
	typeof CONTENT_KIND.UNRESOLVED
>;

type ResolvedContentState = Exclude<ContentState, UnresolvedContentState>;

const contentKindOf = (value: unknown): ResolvedContentKind => {
	if (isTemplate(value)) return CONTENT_KIND.BRANCH;
	if (Array.isArray(value)) return CONTENT_KIND.LIST;
	return CONTENT_KIND.TEXT;
};

const createContentState = (
	contentKind: ResolvedContentKind,
): ResolvedContentState => {
	switch (contentKind) {
		case CONTENT_KIND.TEXT:
			return { kind: CONTENT_KIND.TEXT, lastValueHash: UNSET_HASH };
		case CONTENT_KIND.BRANCH:
			return { kind: CONTENT_KIND.BRANCH, instance: null };
		case CONTENT_KIND.LIST:
			return {
				kind: CONTENT_KIND.LIST,
				items: [],
				lastValueHash: UNSET_HASH,
				itemHashes: [],
				nextRowWithSameHash: EMPTY_LIST_SCRATCH,
				subsequenceStarts: EMPTY_LIST_SCRATCH,
				nextInSubsequence: EMPTY_LIST_SCRATCH,
				hashAtTableIndex: EMPTY_LIST_SCRATCH,
				chainHeadAtTableIndex: EMPTY_LIST_SCRATCH,
				tableIndexShift: 0,
				spareRows: [],
			};
		default:
			return contentKind satisfies never;
	}
};

const coerceToText = (value: unknown): string => {
	const isAbsentContent =
		value === null || value === undefined || typeof value === "boolean";
	return isAbsentContent ? "" : assertPrimitiveString(value);
};

const patchText = (
	liveBinding: ContentLiveBinding,
	textState: TextContentState,
	value: unknown,
): void => {
	if (!claimHashChange(textState, hashValue(value))) return;
	const text = coerceToText(value);
	const existing = liveBinding.openMarker.nextSibling;
	if (existing !== liveBinding.closeMarker) {
		const textNode = existing as Text;
		if (textNode.data !== text) textNode.data = text;
		return;
	}
	if (text !== "") liveBinding.openMarker.after(document.createTextNode(text));
};

const patchBranch = (
	liveBinding: ContentLiveBinding,
	branch: BranchContentState,
	value: TemplateValue,
	moveState: StyleSheetMoveState,
): void => {
	const parsed = resolveNestedTemplate(value);
	if (isPatchableInPlace(branch.instance, parsed)) {
		patchInstance(branch.instance, value.values);
		return;
	}
	const { instance, fragment } = mountInstance(value, parsed, moveState);
	clearRange(liveBinding.openMarker.nextSibling, liveBinding.closeMarker);
	liveBinding.openMarker.after(fragment);
	branch.instance = instance;
};

export const commitContent = (
	liveBinding: ContentLiveBinding,
	values: Array<unknown>,
	moveState: StyleSheetMoveState,
): void => {
	const value = values[liveBinding.staticBinding.valueIndex];
	const contentKind = contentKindOf(value);
	let content = liveBinding.content;
	if (content.kind !== contentKind) {
		clearRange(liveBinding.openMarker.nextSibling, liveBinding.closeMarker);
		content = createContentState(contentKind);
		liveBinding.content = content;
	}
	switch (content.kind) {
		case CONTENT_KIND.TEXT:
			return patchText(liveBinding, content, value);
		case CONTENT_KIND.BRANCH: {
			const template = value as TemplateValue;
			return patchBranch(liveBinding, content, template, moveState);
		}
		case CONTENT_KIND.LIST: {
			const rows = value as Array<unknown>;
			return patchListContent(liveBinding, content, rows, moveState);
		}
		default:
			return content satisfies never;
	}
};

//one text write destroys nothing, so an adoptable text range is repaired by patchText rather than
//rejected; anything else in the range means the server rendered a different kind and it is not ours
const isAdoptableTextRange = ({
	openMarker,
	closeMarker,
}: ContentLiveBinding): boolean => {
	const serverNode = openMarker.nextSibling;
	return (
		serverNode === closeMarker ||
		(serverNode instanceof Text && serverNode.nextSibling === closeMarker)
	);
};

const hydrateBranch = (
	liveBinding: ContentLiveBinding,
	branch: BranchContentState,
	value: TemplateValue,
	moveState: StyleSheetMoveState,
	walker: TreeWalker,
): boolean => {
	const instance = hydrateInstance(
		walker,
		value,
		resolveNestedTemplate(value),
		liveBinding.closeMarker,
		moveState,
	);
	if (instance === null) return false;
	branch.instance = instance;
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
	const content = createContentState(kind);
	liveBinding.content = content;

	switch (content.kind) {
		case CONTENT_KIND.TEXT:
			if (isAdoptableTextRange(liveBinding))
				return patchText(liveBinding, content, value);
			break;
		case CONTENT_KIND.BRANCH: {
			const template = value as TemplateValue;
			if (hydrateBranch(liveBinding, content, template, moveState, walker))
				return;
			break;
		}
		case CONTENT_KIND.LIST: {
			const rows = value as Array<unknown>;
			if (hydrateListItems(liveBinding, content, rows, moveState, walker))
				return;
			break;
		}
		default:
			return content satisfies never;
	}

	warnOnRejectedServerRange();
	clearRange(liveBinding.openMarker.nextSibling, liveBinding.closeMarker);
	liveBinding.content = createContentState(kind);
	commitContent(liveBinding, values, moveState);
};
