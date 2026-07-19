import { BINDING, PARSE_BINDING } from "./constants";

export interface AttributeBinding {
	type: typeof PARSE_BINDING.ATTRIBUTE;
	isExpandable: boolean;
	values: Array<Part>;
	keys: Array<Part>;
}

export interface ContentBinding {
	type: typeof PARSE_BINDING.CONTENT;
	values: Array<Part>;
}

export interface CommentBinding {
	type: typeof PARSE_BINDING.COMMENT;
	values: Array<Part>;
}

export interface RawContentBinding {
	type: typeof PARSE_BINDING.RAW_CONTENT;
	values: Array<Part>;
	tag: string;
	cssPlan: CssPlan | null;
}

export interface TagBinding {
	type: typeof PARSE_BINDING.TAG;
	values: Array<Part>;
}

export type Binding =
	| TagBinding
	| AttributeBinding
	| ContentBinding
	| CommentBinding
	| RawContentBinding;

export type Part = string | number;

export interface CssValueGroup {
	ordinal: number; //the group's first expression index — the name's tail
	valueParts: Array<Part>;
}

export interface CssPlan {
	namePrefix: string; //"--<templateHash unsigned base36>-"
	groupNames: Array<string>; //base names (namePrefix + ordinal), shared by the first mount per host
	sheetParts: Array<string | number>; //number = group index, resolved to var(--name)
	groups: Array<CssValueGroup>;
}

export interface TagStaticBinding {
	type: typeof BINDING.TAG;
	parts: Array<Part>;
}

export interface AttributeStaticBinding {
	type: typeof BINDING.ATTRIBUTE;
	nameParts: Array<Part>;
	valueParts: Array<Part>;
}

export interface SingleValueAttributeStaticBinding {
	type: typeof BINDING.SINGLE_VALUE_ATTRIBUTE;
	nameParts: Array<Part>;
	valueIndex: number;
}

export interface DynamicAttributeStaticBinding {
	type: typeof BINDING.DYNAMIC_ATTRIBUTE;
	valueIndex: number;
}

export interface NamedDynamicStaticBinding {
	type: typeof BINDING.NAMED_DYNAMIC;
	name: string;
	valueIndex: number;
}

export interface ContentStaticBinding {
	type: typeof BINDING.CONTENT;
	valueIndex: number;
}

export interface RawContentStaticBinding {
	type: typeof BINDING.RAW_CONTENT;
	parts: Array<Part>;
	cssPlan: CssPlan | null;
}

export interface CommentStaticBinding {
	type: typeof BINDING.COMMENT;
	parts: Array<Part>;
}

export type StaticBinding =
	| TagStaticBinding
	| AttributeStaticBinding
	| SingleValueAttributeStaticBinding
	| DynamicAttributeStaticBinding
	| NamedDynamicStaticBinding
	| ContentStaticBinding
	| RawContentStaticBinding
	| CommentStaticBinding;

export interface ParsedTemplate {
	htmlWithMarkers: string;
	bindings: Array<StaticBinding>;
	templateHash: number;
	fragmentCloneSource: DocumentFragment | null;
	hostBindingCount: number;
	keyBindingIndex: number;
	hostStyleIsBound: boolean;
}
