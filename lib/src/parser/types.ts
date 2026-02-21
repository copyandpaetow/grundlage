export type ValueOf<T> = T[keyof T];

export const BINDING_TYPES = {
	TAG: 0,
	ATTR: 1,
	CONTENT: 2,
	RAW_CONTENT: 3,
} as const;

export type AttributeBinding = {
	type: typeof BINDING_TYPES.ATTR;
	values: Array<number | string>;
	keys: Array<number | string>;
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
	endValues: Array<number | string>;
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
	fragment: DocumentFragment;
	templateHash: number;
};
