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
import { CONTENT_KIND } from "../constants";
import { Instance } from "../instance";

export interface TagLiveBinding {
	staticBinding: TagStaticBinding;
	markerComment: Comment;
	valueHash: number;
}

export interface AttributeLiveBinding {
	staticBinding: AttributeStaticBinding;
	markerComment: Comment | null;
	hostElement: Element | null;
	valueHash: number;
	lastComposedName: string;
}

export interface SingleValueAttributeLiveBinding {
	staticBinding: SingleValueAttributeStaticBinding;
	markerComment: Comment | null;
	hostElement: Element | null;
	valueHash: number;
	lastComposedName: string;
	appliedMode: number;
}

export interface AppliedAttribute {
	value: unknown;
	hash: number;
}

export interface DynamicAttributeLiveBinding {
	staticBinding: DynamicAttributeStaticBinding;
	markerComment: Comment | null;
	hostElement: Element | null;
	appliedAttributes: Map<string, AppliedAttribute>;
	lastValueHash: number;
}

export interface NamedDynamicLiveBinding {
	staticBinding: NamedDynamicStaticBinding;
	markerComment: Comment | null;
	hostElement: Element | null;
	valueHash: number;
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

export interface RawContentLiveBinding {
	staticBinding: RawContentStaticBinding;
	markerComment: Comment;
	valueHash: number;
}

export interface CommentLiveBinding {
	staticBinding: CommentStaticBinding;
	markerComment: Comment;
	valueHash: number;
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
	spanStart: ChildNode;
}
