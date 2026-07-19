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
	compiledStyleSheet: CompiledStyleSheet | null;
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

export interface CustomProperty {
	nameSuffix: number;
	valueParts: Array<Part>;
}

export interface CompiledStyleSheet {
	customPropertyPrefix: string;
	customPropertyNames: Array<string>;
	sheetParts: Array<string | number>;
	customProperties: Array<CustomProperty>;
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
	compiledStyleSheet: CompiledStyleSheet | null;
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
