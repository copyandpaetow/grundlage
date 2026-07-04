import {
	AttributeStaticBinding,
	CommentStaticBinding,
	ContentStaticBinding,
	DynamicAttributeStaticBinding,
	EventStaticBinding,
	RawContentStaticBinding,
	SingleValueAttributeStaticBinding,
	TagStaticBinding,
} from "../parser/types";
import { getParsedTemplate } from "../parser/html";
import { TemplateValue } from "../template-value";
import { commitLiveBinding } from "./commit";
import { CONTENT_KIND } from "./constants";
import { mountInstance } from "./mount-hydrate";

export interface Instance {
	templateHash: number;
	liveBindings: Array<LiveBinding>;
}

export interface TagLiveBinding {
	staticBinding: TagStaticBinding;
	markerComment: Comment;
	relatedLiveBindings: Array<LiveBinding>;
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

export interface DynamicAttributeLiveBinding {
	staticBinding: DynamicAttributeStaticBinding;
	markerComment: Comment | null;
	hostElement: Element | null;
	appliedAttributes: Map<string, unknown>;
	lastValueHash: number;
}

export interface EventLiveBinding {
	staticBinding: EventStaticBinding;
	markerComment: Comment | null;
	hostElement: Element | null;
	eventHandler: EventListener | null;
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
}

export interface RawContentLiveBinding {
	staticBinding: RawContentStaticBinding;
	markerComment: Comment;
	valueHash: number;
}

export interface CommentLiveBinding {
	staticBinding: CommentStaticBinding;
	startMarker: Comment;
	endMarker: Comment;
	valueHash: number;
}

export type LiveBinding =
	| TagLiveBinding
	| AttributeLiveBinding
	| SingleValueAttributeLiveBinding
	| DynamicAttributeLiveBinding
	| EventLiveBinding
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

export const patchInstance = (
	instance: Instance,
	values: Array<unknown>,
): void => {
	const { liveBindings } = instance;
	for (let index = 0; index < liveBindings.length; index++)
		commitLiveBinding(liveBindings[index], values);
};

export const reconcileInstance = (
	current: Instance | null,
	value: TemplateValue,
): { instance: Instance; fragment: DocumentFragment } | null => {
	const parsed = getParsedTemplate(value.__templateStrings);
	if (current !== null && current.templateHash === parsed.templateHash) {
		patchInstance(current, value.values);
		return null;
	}
	return mountInstance(value);
};
