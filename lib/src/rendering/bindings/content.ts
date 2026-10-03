import { isTemplate, TemplateValue } from "../../template";
import { stringifyPrimitive } from "../../utils/guards";
import { hashValue } from "../value-hashing";
import { ValueOf } from "../../utils/types";
import { CONTENT_KIND, UNSET_HASH } from "../constants";
import {
	HYDRATION_MISMATCH,
	parseNestedTemplate,
	hydrateInstance,
	isPatchableInPlace,
	cloneTemplateFragment,
	mountInstance,
	patchInstance,
} from "../instance";
import { clearRange, warnOnRejectedServerRange } from "../markers";
import {
	aggregateHashOfItems,
	EMPTY_LIST_SCRATCH,
	hydrateListItems,
	commitList,
} from "./content-list";
import {
	ContentLiveBinding,
	ContentState,
	StyleSheetMoveState,
	TextContentState,
	UnresolvedContentState,
} from "./types";
import { assertDuringDevelopment } from "../../utils/diagnostics";

export const UNRESOLVED_CONTENT: Readonly<UnresolvedContentState> = {
	kind: CONTENT_KIND.UNRESOLVED,
};

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
	return isAbsentContent ? "" : stringifyPrimitive(value);
};

const commitText = (
	liveBinding: ContentLiveBinding,
	textState: TextContentState,
	value: unknown,
): void => {
	const hash = hashValue(value);
	if (hash === textState.lastValueHash) return;
	textState.lastValueHash = hash;
	const text = coerceToText(value);
	const existing = liveBinding.openMarker.nextSibling;
	if (existing !== liveBinding.closeMarker) {
		assertDuringDevelopment(
			existing instanceof Text,
			"a text range holds nothing or one text node",
		);
		if (existing.data !== text) existing.data = text;
		return;
	}
	if (text !== "") liveBinding.openMarker.after(document.createTextNode(text));
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
			commitText(liveBinding, content, value);
			break;
		case CONTENT_KIND.BRANCH: {
			const template = value as TemplateValue;
			const parsed = parseNestedTemplate(template);
			if (isPatchableInPlace(content.instance, parsed)) {
				patchInstance(content.instance, template.values);
				break;
			}
			const fragment = cloneTemplateFragment(parsed);
			const instance = mountInstance(fragment, template, parsed, moveState);
			clearRange(liveBinding.openMarker.nextSibling, liveBinding.closeMarker);
			liveBinding.openMarker.after(fragment);
			content.instance = instance;
			break;
		}
		case CONTENT_KIND.LIST:
			commitList(liveBinding, content, value as Array<unknown>, moveState);
			break;
		default:
			return content satisfies never;
	}
};

//one text write destroys nothing, so an adoptable text range is repaired by commitText rather than
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
			if (isAdoptableTextRange(liveBinding)) {
				commitText(liveBinding, content, value);
				return;
			}
			break;
		case CONTENT_KIND.BRANCH: {
			const template = value as TemplateValue;
			const hydrated = hydrateInstance(
				walker,
				template,
				parseNestedTemplate(template),
				liveBinding.closeMarker,
				moveState,
			);
			if (hydrated === HYDRATION_MISMATCH) break;
			content.instance = hydrated;
			return;
		}
		case CONTENT_KIND.LIST: {
			const hydratedItems = hydrateListItems(
				liveBinding,
				value as Array<unknown>,
				moveState,
				walker,
			);
			if (hydratedItems === HYDRATION_MISMATCH) break;
			content.items = hydratedItems;
			content.lastValueHash = aggregateHashOfItems(hydratedItems);
			return;
		}
		default:
			return content satisfies never;
	}

	warnOnRejectedServerRange();
	clearRange(liveBinding.openMarker.nextSibling, liveBinding.closeMarker);
	commitContent(liveBinding, values, moveState);
};
