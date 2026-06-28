export type ValueOf<T> = T[keyof T];

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
	relatedAttributes: Array<number>;
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
};
