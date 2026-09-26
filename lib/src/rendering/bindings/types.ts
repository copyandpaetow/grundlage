import { BINDING } from "../../parser/constants";
import {
	AttributeStaticBinding,
	CommentStaticBinding,
	ContentStaticBinding,
	DynamicAttributeStaticBinding,
	ParsedTemplate,
	RawContentStaticBinding,
	TagStaticBinding,
} from "../../parser/types";
import { CONTENT_KIND } from "../constants";

export interface Instance {
	parsed: ParsedTemplate;
	liveBindings: Array<LiveBinding>;
	moveState: StyleSheetMoveState;
}

export interface StyleSheetMoveState {
	needsStyleSheetRefreshOnMove: boolean;
}

export interface TagLiveBinding {
	staticBinding: TagStaticBinding;
	openMarker: Comment;
	lastValueHash: number;
}

export interface AttributeLiveBinding {
	staticBinding: AttributeStaticBinding;
	anchor: Element;
	lastValueHash: number;
	lastComposedName: string;
	lastValue: unknown;
}

export interface AppliedAttribute {
	value: unknown;
	hash: number;
	lastSeenInCommit: number;
}

export interface DynamicAttributeLiveBinding {
	staticBinding: DynamicAttributeStaticBinding;
	anchor: Element;
	appliedAttributes: Map<string, AppliedAttribute>;
	lastValueHash: number;
	//a name not stamped with the current number was dropped by the value and comes off the element
	commitNumber: number;
}

export interface ContentLiveBinding {
	staticBinding: ContentStaticBinding;
	openMarker: Comment;
	closeMarker: Comment;
	content: ContentState;
}

export type ContentState =
	| UnresolvedContentState
	| TextContentState
	| BranchContentState
	| ListContentState;

export interface UnresolvedContentState {
	kind: typeof CONTENT_KIND.UNRESOLVED;
}

export interface TextContentState {
	kind: typeof CONTENT_KIND.TEXT;
	lastValueHash: number;
}

export interface BranchContentState {
	kind: typeof CONTENT_KIND.BRANCH;
	instance: Instance | null;
}

export interface ListContentState {
	kind: typeof CONTENT_KIND.LIST;
	items: Array<ListItem>;
	lastValueHash: number;
	//scratch kept across patches instead of allocated per patch: each patch fills what it reads, and
	//the arrays only grow, so a length is a capacity, never a row count
	itemHashes: Array<number>;
	nextRowWithSameHash: Int32Array;
	subsequenceStarts: Int32Array;
	nextInSubsequence: Int32Array;
	hashAtTableIndex: Int32Array;
	chainHeadAtTableIndex: Int32Array;
	tableIndexShift: number;
	//alternates with items: placeRows returns the array it was given
	spareRows: Array<ListItem | undefined>;
}

export interface StyleSheetState {
	styleElement: HTMLStyleElement;
	declarationValueHashes: Array<number>;
	ruleDeclarations: Array<CSSStyleDeclaration>;
	sheet: CSSStyleSheet | null;
}

export interface RawContentLiveBinding {
	staticBinding: RawContentStaticBinding;
	openMarker: Comment;
	lastValueHash: number;
	styleSheetState: StyleSheetState | null;
}

export interface CommentLiveBinding {
	staticBinding: CommentStaticBinding;
	openMarker: Comment;
	lastValueHash: number;
}

export type LiveBinding =
	| TagLiveBinding
	| AttributeLiveBinding
	| DynamicAttributeLiveBinding
	| ContentLiveBinding
	| RawContentLiveBinding
	| CommentLiveBinding;

export type AttributeLaneLiveBinding =
	AttributeLiveBinding | DynamicAttributeLiveBinding;

//a switch on `staticBinding.type` narrows the static binding and leaves the live binding as the
//whole union, so the kind test lives here once per kind instead of as a cast at every call site
export const isAttributeBinding = (
	liveBinding: LiveBinding,
): liveBinding is AttributeLiveBinding =>
	liveBinding.staticBinding.type === BINDING.ATTRIBUTE;

export const isDynamicAttributeBinding = (
	liveBinding: LiveBinding,
): liveBinding is DynamicAttributeLiveBinding =>
	liveBinding.staticBinding.type === BINDING.DYNAMIC_ATTRIBUTE;

export const isContentBinding = (
	liveBinding: LiveBinding,
): liveBinding is ContentLiveBinding =>
	liveBinding.staticBinding.type === BINDING.CONTENT;

export const isRawContentBinding = (
	liveBinding: LiveBinding,
): liveBinding is RawContentLiveBinding =>
	liveBinding.staticBinding.type === BINDING.RAW_CONTENT;

export interface ListItem {
	tailMarker: Comment;
	instance: Instance;
	itemHash: number;
	shapeOrKeyHash: number;
	startNode: ChildNode;
	placedAtIndex: number;
}
