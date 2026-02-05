export type ValueOf<T> = T[keyof T];

export const BINDING_TYPES = {
	TAG: 0,
	ATTR: 1,
	CONTENT: 2,
	RAW_CONTENT: 3,
} as const;

export type AttributeDescriptor = {
	type: typeof BINDING_TYPES.ATTR;
	values: Array<number | string>;
	keys: Array<number | string>;
};

export type ContentDescriptor = {
	type: typeof BINDING_TYPES.CONTENT;
	values: Array<number | string>;
};

export type RawContentDescriptor = {
	type: typeof BINDING_TYPES.RAW_CONTENT;
	values: Array<number | string>;
};

export type TagDescriptor = {
	type: typeof BINDING_TYPES.TAG;
	values: Array<number | string>;
	endValues: Array<number | string>;
	relatedAttributes: Array<number>;
};

export type Descriptor =
	| TagDescriptor
	| AttributeDescriptor
	| ContentDescriptor
	| RawContentDescriptor;

export type ParsedHTML = {
	expressionToDescriptor: Array<number>;
	descriptors: Array<Descriptor>;
	fragment: DocumentFragment;
	templateHash: number;
};
