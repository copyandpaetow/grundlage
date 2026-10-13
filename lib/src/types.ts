import { TemplateValue } from "./template";

declare const templateMarker: unique symbol;

export interface Template {
	readonly [templateMarker]: never;
}

export interface BaseComponent extends HTMLElement {
	update(): Promise<void>;
	setProp(name: string, value: unknown, oldValue?: unknown): void;
	internals?: ElementInternals | null;
}

//undefined is the refusal: the previous value stays and the element keeps rendering it. Boolean
//never refuses, which is why an absent boolean is a value and not a gap
export type Resolve<Value> = (incoming: unknown) => Value | undefined;

export type ShippedToken =
	| StringConstructor
	| NumberConstructor
	| BigIntConstructor
	| BooleanConstructor;

export type PropEntry = ShippedToken | Resolve<unknown>;
export type SchemaDefinition = PropEntry | readonly [PropEntry, unknown];
export type Schema = Record<string, SchemaDefinition>;

type ParsedValueOf<Declared> = Declared extends StringConstructor
	? string
	: Declared extends NumberConstructor
		? number
		: Declared extends BigIntConstructor
			? bigint
			: Declared extends BooleanConstructor
				? boolean
				: Declared extends (incoming: never) => infer Value
					? Value
					: never;

export type InferProp<Definition> = Definition extends readonly [
	infer Declared,
	unknown,
]
	? Exclude<ParsedValueOf<Declared>, undefined>
	: Definition extends BooleanConstructor
		? boolean
		: ParsedValueOf<Definition> | undefined;

export type DeclaredProps<DeclaredSchema extends Schema = Schema> = {
	-readonly [Name in keyof DeclaredSchema]: InferProp<DeclaredSchema[Name]>;
};

export type ComponentProps<DeclaredSchema extends Schema = Schema> = Readonly<
	DeclaredProps<DeclaredSchema>
> & {
	host: BaseComponent & DeclaredProps<DeclaredSchema>;
};

//partial: every ShadowRootInit field has a default, and any option passed overrides its default
export type ComponentOptions<DeclaredSchema extends Schema = Schema> =
	Partial<ShadowRootInit> & {
		formAssociated?: boolean;
		clonable?: boolean;
		props?: DeclaredSchema;
	};

//what a content position accepts: the same rulebook as a content hole, one level deep — array
//items are validated where they are committed, not here
export type ContentValue =
	| Template
	| TemplateValue
	| string
	| number
	| bigint
	| boolean
	| null
	| undefined
	| Array<ContentValue>;

export type RenderFunction<DeclaredSchema extends Schema = Schema> = (
	componentProps: ComponentProps<DeclaredSchema>,
) =>
	| ContentValue
	| ComponentGenerator<DeclaredSchema>
	| Promise<ContentValue | ComponentGenerator<DeclaredSchema>>;

export type YieldableValue<DeclaredSchema extends Schema = Schema> =
	| ContentValue
	| object
	| void
	| ((componentProps: ComponentProps<DeclaredSchema>) => unknown);

export type Cleanup = () => void;

export type ComponentGenerator<DeclaredSchema extends Schema = Schema> = (
	componentProps: ComponentProps<DeclaredSchema>,
) =>
	| Generator<YieldableValue<DeclaredSchema>, Cleanup | void, any>
	| AsyncGenerator<YieldableValue<DeclaredSchema>, Cleanup | void, any>;

export type ComponentConstructor<DeclaredSchema extends Schema = Schema> =
	new () => BaseComponent & DeclaredProps<DeclaredSchema>;
