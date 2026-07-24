import {
	AttributeStaticBinding,
	CommentStaticBinding,
	ContentStaticBinding,
	DynamicAttributeStaticBinding,
	NamedDynamicStaticBinding,
	RawContentStaticBinding,
	SingleValueAttributeStaticBinding,
	TagStaticBinding,
} from "../../parser/types";
import { ATTRIBUTE_MODE, CONTENT_KIND } from "../constants";
import { Instance } from "../instance";
import { ValueOf } from "../../utils/types";

export interface StyleSheetMoveState {
	needsStyleSheetRefreshOnMove: boolean;
	needsRerenderAfterMove: boolean;
}

export interface TagLiveBinding {
	staticBinding: TagStaticBinding;
	markerComment: Comment;
	lastValueHash: number;
}

//anchor is the host element for a host binding, else the marker comment before the target
//element; resolveTargetElement discriminates by node type. One field makes "exactly one" unbreakable.
export interface AttributeLiveBinding {
	staticBinding: AttributeStaticBinding;
	anchor: Comment | Element;
	lastValueHash: number;
	lastComposedName: string;
}

export interface SingleValueAttributeLiveBinding {
	staticBinding: SingleValueAttributeStaticBinding;
	anchor: Comment | Element;
	lastValueHash: number;
	lastComposedName: string;
	appliedAttributeMode: ValueOf<typeof ATTRIBUTE_MODE>;
}

export interface AppliedAttribute {
	value: unknown;
	hash: number;
}

export interface DynamicAttributeLiveBinding {
	staticBinding: DynamicAttributeStaticBinding;
	anchor: Comment | Element;
	appliedAttributes: Map<string, AppliedAttribute>;
	lastValueHash: number;
}

export interface NamedDynamicLiveBinding {
	staticBinding: NamedDynamicStaticBinding;
	anchor: Comment | Element;
	lastValueHash: number;
	lastValue: unknown;
}

export interface ContentLiveBinding {
	staticBinding: ContentStaticBinding;
	startMarker: Comment;
	endMarker: Comment;
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
	aggregateHash: number;
	itemHashes: Array<number>;
}

export interface StyleSheetState {
	styleElement: HTMLStyleElement;
	declarationValueHashes: Array<number>;
	ruleDeclarations: Array<CSSStyleDeclaration>;
	sheet: CSSStyleSheet | null;
}

export interface RawContentLiveBinding {
	staticBinding: RawContentStaticBinding;
	markerComment: Comment;
	lastValueHash: number;
	styleSheetState: StyleSheetState | null;
}

export interface CommentLiveBinding {
	staticBinding: CommentStaticBinding;
	markerComment: Comment;
	lastValueHash: number;
}

export type LiveBinding =
	| TagLiveBinding
	| AttributeLiveBinding
	| SingleValueAttributeLiveBinding
	| DynamicAttributeLiveBinding
	| NamedDynamicLiveBinding
	| ContentLiveBinding
	| RawContentLiveBinding
	| CommentLiveBinding;

export interface ListItem {
	tailMarker: Comment;
	instance: Instance;
	itemHash: number;
	keyHash: number;
	startNode: ChildNode;
}
