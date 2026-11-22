import * as BINDING from "../../parser/binding";
import {
	AttributeStaticBinding,
	CommentStaticBinding,
	ContentStaticBinding,
	DynamicAttributeStaticBinding,
	ParsedTemplate,
	RawContentStaticBinding,
	TagStaticBinding,
	TemplateContentStaticBinding,
} from "../../parser/types";
import * as CONTENT_KIND from "../content-kind";

export interface Instance {
	parsed: ParsedTemplate;
	//holes while the bind walk fills it; the one reader during the walk is the tag swap
	liveBindings: Array<LiveBinding>;
	treeState: TreeState;
}

/** Shared by every instance of one mounted tree: the root template's, each nested value's and each row's. */
export interface TreeState {
	readonly isTemplateContent: boolean;
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
	hashAtTableIndex: Float64Array;
	chainHeadAtTableIndex: Int32Array;
	tableIndexShift: number;
	//alternates with items: a patch builds the new rows here, and the old array becomes the spare
	spareRows: Array<ListItem | undefined>;
}

export interface RawContentLiveBinding {
	staticBinding: RawContentStaticBinding;
	openMarker: Comment;
	lastValueHash: number;
}

export interface CommentLiveBinding {
	staticBinding: CommentStaticBinding;
	openMarker: Comment;
	lastValueHash: number;
}

export interface TemplateContentLiveBinding {
	staticBinding: TemplateContentStaticBinding;
	openMarker: Comment;
	lastValueHash: number;
}

export type LiveBinding =
	| TagLiveBinding
	| AttributeLiveBinding
	| DynamicAttributeLiveBinding
	| ContentLiveBinding
	| RawContentLiveBinding
	| CommentLiveBinding
	| TemplateContentLiveBinding;

export type AttributeLaneLiveBinding = AttributeLiveBinding | DynamicAttributeLiveBinding;

//a switch on `staticBinding.type` narrows the static binding and leaves the live binding as the
//whole union, so the kind test lives here once per kind instead of as a cast at every call site
export const isAttributeBinding = (liveBinding: LiveBinding): liveBinding is AttributeLiveBinding =>
	liveBinding.staticBinding.type === BINDING.ATTRIBUTE;

export const isDynamicAttributeBinding = (
	liveBinding: LiveBinding,
): liveBinding is DynamicAttributeLiveBinding =>
	liveBinding.staticBinding.type === BINDING.DYNAMIC_ATTRIBUTE;

export const isTemplateContentBinding = (
	liveBinding: LiveBinding,
): liveBinding is TemplateContentLiveBinding =>
	liveBinding.staticBinding.type === BINDING.TEMPLATE_CONTENT;

export interface ListItem {
	tailMarker: Comment;
	instance: Instance;
	itemHash: number;
	shapeOrKeyHash: number;
	startNode: ChildNode;
	placedAtIndex: number;
}
