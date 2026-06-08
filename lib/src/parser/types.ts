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

//how the attribute's name relates to event-listener handling, decided once at parse time so the per-write path in applyAttributeBinding skips the charCode/toLowerCase cascade
export const ATTRIBUTE_NAME_KIND = {
	//dynamic or spread name — not known at parse time, so the write path must still probe the resolved key
	UNKNOWN: 0,
	//static name that is not an on* handler — can never be a listener; the write path skips event handling entirely
	PLAIN: 1,
	//static on<name> — a listener iff the matching IDL property exists on the element (gated at write time)
	NATIVE_EVENT: 2,
	//static on-<name> — always a listener, no IDL gate; eventName is fully resolved at parse time
	EXPLICIT_EVENT: 3,
} as const;

export type AttributeBinding = {
	type: typeof BINDING_TYPES.ATTR;
	shape: ValueOf<typeof ATTRIBUTE_SHAPE>;
	values: Array<number | string>;
	keys: Array<number | string>;
	//parse-time event classification of a static name; UNKNOWN for dynamic/spread names
	nameKind: ValueOf<typeof ATTRIBUTE_NAME_KIND>;
	//pre-resolved listener name (lowercase, prefix stripped) for NATIVE_EVENT/EXPLICIT_EVENT; "" otherwise
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
	//the document-free parse output: an HTML string seed the rendering layer materializes via buildFragment.
	//retained (not freed) because the html compiler and string-based SSR reuse it directly.
	result: string;
	//null until the first setup() materializes it through buildFragment and caches it here; later instances clone.
	//the parser itself never touches the DOM, so it always returns null (ADR-0010).
	fragment: DocumentFragment | null;
	templateHash: number;
	hostBindingOffset: number;
};
