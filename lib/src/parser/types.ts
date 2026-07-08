export type ValueOf<T> = T[keyof T];

export const COMMENT_IDENTIFIER = "^.^";

export const BINDING_TYPES = {
	TAG: 0,
	ATTR: 1,
	CONTENT: 2,
	RAW_CONTENT: 3,
} as const;

export const ATTRIBUTE_SHAPE = {
	STATIC: 0,
	STATIC_NAME_SINGLE_VALUE: 1,
	STATIC_NAME_MULTI_VALUE: 2,
	DYNAMIC_NAME_BOOLEAN: 3,
	DYNAMIC_NAME_SINGLE_VALUE: 4,
	DYNAMIC_NAME_MULTI_VALUE: 5,
	EXPANDABLE: 6,
} as const;

export const ATTRIBUTE_NAME_KIND = {
	UNKNOWN: 0,
	PLAIN: 1,
	NATIVE_EVENT: 2,
	EXPLICIT_EVENT: 3,
} as const;

export type AttributeBinding = {
	type: typeof BINDING_TYPES.ATTR;
	shape: ValueOf<typeof ATTRIBUTE_SHAPE>;
	values: Array<number | string>;
	keys: Array<number | string>;
	nameKind: ValueOf<typeof ATTRIBUTE_NAME_KIND>;
	eventName: string;
};

export type ContentBinding = {
	type: typeof BINDING_TYPES.CONTENT;
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
	| RawContentBinding;

export type ParsedHTML = {
	expressionToBinding: Array<number>;
	bindings: Array<Binding>;
	result: string;
	fragment: DocumentFragment | null;
	templateHash: number;
	hostBindingOffset: number;
	keyBindingIndex: number;
};

export const BINDING = {
	TAG: 0,
	ATTRIBUTE: 1,
	DYNAMIC_ATTRIBUTE: 2,
	EVENT: 3,
	CONTENT: 4,
	RAW_CONTENT: 5,
	COMMENT: 6,
	SINGLE_VALUE_ATTRIBUTE: 7,
} as const;

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

export interface EventStaticBinding {
	type: typeof BINDING.EVENT;
	eventType: string;
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
	| EventStaticBinding
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
