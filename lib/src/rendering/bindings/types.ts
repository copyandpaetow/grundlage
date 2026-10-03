import { BINDING } from "../../parser/constants";
import {
	AttributeStaticBinding,
	CommentStaticBinding,
	CompiledStyleSheet,
	ContentStaticBinding,
	DynamicAttributeStaticBinding,
	ParsedTemplate,
	RawContentStaticBinding,
	TagStaticBinding,
} from "../../parser/types";
import { CONTENT_KIND, STYLE_SHEET_LANE } from "../constants";

export interface Instance {
	parsed: ParsedTemplate;
	//empty slots while the bind walk fills it; the one reader during the walk is the tag swap
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
}

export interface DynamicAttributeLiveBinding {
	staticBinding: DynamicAttributeStaticBinding;
	anchor: Element;
	appliedAttributes: Map<string, AppliedAttribute>;
	lastValueHash: number;
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

export interface BoundStyleSheet {
	sheet: CSSStyleSheet;
	ruleDeclarations: Array<CSSStyleDeclaration>;
}

export interface TextStyleSheetLane {
	kind: typeof STYLE_SHEET_LANE.TEXT;
}

export interface CSSOMStyleSheetLane {
	kind: typeof STYLE_SHEET_LANE.CSSOM;
	compiledStyleSheet: CompiledStyleSheet;
	styleElement: HTMLStyleElement;
	declarationValueHashes: Array<number>;
	//null until a commit finds the element's sheet parsed
	boundSheet: BoundStyleSheet | null;
}

export type StyleSheetLane = TextStyleSheetLane | CSSOMStyleSheetLane;

export interface RawContentLiveBinding {
	staticBinding: RawContentStaticBinding;
	openMarker: Comment;
	lastValueHash: number;
	styleSheetLane: StyleSheetLane;
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
