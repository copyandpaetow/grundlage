import {
	AttributeStaticBinding,
	CommentStaticBinding,
	ContentStaticBinding,
	CssPlan,
	DynamicAttributeStaticBinding,
	NamedDynamicStaticBinding,
	RawContentStaticBinding,
	SingleValueAttributeStaticBinding,
	TagStaticBinding,
} from "../../parser/types";
import { ATTRIBUTE_MODE, CONTENT_KIND } from "../constants";
import { Instance } from "../instance";
import { BaseComponent } from "../../types";
import { ValueOf } from "../../utils/types";

//threaded from the painter through every mount, never derived from the DOM (bindings
//commit while the fragment is detached). hostStyleIsBound disables the css fast path for
//every <style> under this host — a host style attribute write wipes the custom
//properties; the mount counts give duplicate mounts of one plan instance-suffixed names.
export interface Carrier {
	host: BaseComponent;
	hostStyleIsBound: boolean;
	cssPlanMountCounts: Map<CssPlan, number> | null;
}

export interface TagLiveBinding {
	staticBinding: TagStaticBinding;
	markerComment: Comment;
	lastValueHash: number;
}

//anchor is the host element for a host binding, else the marker comment before the target
//element; targetElement discriminates by node type. One field makes "exactly one" unbreakable.
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
	appliedMode: ValueOf<typeof ATTRIBUTE_MODE>;
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

//present iff this instance is on the css fast path; null is the fallback-path discriminator
export interface RawCssState {
	previousGroupHashes: Array<number>;
	groupNames: Array<string>;
	sheetOverride: string | null;
}

export interface RawContentLiveBinding {
	staticBinding: RawContentStaticBinding;
	markerComment: Comment;
	lastValueHash: number;
	cssState: RawCssState | null;
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
	spanStart: ChildNode;
}
