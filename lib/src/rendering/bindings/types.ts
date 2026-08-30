import {
	AttributeStaticBinding,
	CommentStaticBinding,
	ContentStaticBinding,
	DynamicAttributeStaticBinding,
	RawContentStaticBinding,
	SingleValueAttributeStaticBinding,
	TagStaticBinding,
} from "../../parser/types";
import { CONTENT_KIND } from "../constants";
import { Instance } from "../instance";

export interface StyleSheetMoveState {
	needsStyleSheetRefreshOnMove: boolean;
}

export interface TagLiveBinding {
	staticBinding: TagStaticBinding;
	markerComment: Comment;
	lastValueHash: number;
}

export interface AttributeLiveBinding {
	staticBinding: AttributeStaticBinding;
	anchor: Element;
	lastValueHash: number;
	lastComposedName: string;
}

export interface SingleValueAttributeLiveBinding {
	staticBinding: SingleValueAttributeStaticBinding;
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
