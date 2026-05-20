export type ValueOf<T> = T[keyof T];

export const BINDING_TYPES = {
	TAG: 0,
	ATTR: 1,
	CONTENT: 2,
	RAW_CONTENT: 3,
} as const;

//attribute bindings come in several structurally-distinct forms — name/value shape, single vs. concatenated, expandable spread
//classifying once at parse time lets the renderer dispatch through a shape-keyed table instead of re-probing keys/values on every flush
export const ATTRIBUTE_SHAPE = {
	//<div class="card">, <div hidden> — no expressions; only written on initial render or via removeAttributeBinding
	STATIC: 0,
	//<div class="${x}"> — pass-through value supports functions, objects, primitives
	STATIC_NAME_SINGLE_VALUE: 1,
	//<div class="${a} ${b}">, <div class="prefix ${x}"> — value is always stringified via bindingToString
	STATIC_NAME_MULTI_VALUE: 2,
	//<div data-${a}>, <div ${name}-suffix> — concatenated name, no value
	DYNAMIC_NAME_BOOLEAN: 3,
	//<div ${name}="${value}"> — concatenated name with a single pass-through value
	DYNAMIC_NAME_SINGLE_VALUE: 4,
	//<div ${name}="prefix ${value}"> — concatenated name and stringified value
	DYNAMIC_NAME_MULTI_VALUE: 5,
	//<div ${attrs}> — single number key, no value; expression is an object/array/string spread
	EXPANDABLE: 6,
} as const;

export type AttributeBinding = {
	type: typeof BINDING_TYPES.ATTR;
	shape: ValueOf<typeof ATTRIBUTE_SHAPE>;
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
	bindingIndex: number;
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
	hostBindingOffset: number;
};
