import { ATTRIBUTE_SHAPE, BINDING, BINDING_TYPES } from "./constants";

export type ValueOf<T> = T[keyof T];

export type AttributeBinding = {
	type: typeof BINDING_TYPES.ATTRIBUTE;
	shape: ValueOf<typeof ATTRIBUTE_SHAPE>;
	values: Array<number | string>;
	keys: Array<number | string>;
};

export type ContentBinding = {
	type: typeof BINDING_TYPES.CONTENT;
	values: Array<number | string>;
};

export type CommentBinding = {
	type: typeof BINDING_TYPES.COMMENT;
	values: Array<number | string>;
};

export type RawContentBinding = {
	type: typeof BINDING_TYPES.RAW_CONTENT;
	values: Array<number | string>;
};

export type TagBinding = {
	type: typeof BINDING_TYPES.TAG;
	values: Array<number | string>;
};

export type Binding =
	| TagBinding
	| AttributeBinding
	| ContentBinding
	| CommentBinding
	| RawContentBinding;

export type Part = string | number;

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
}
