import type { LoadRequest } from "./load";
import type * as PROP_KIND from "./props/prop-kind";
import type * as PROP_PRESENCE from "./props/prop-presence";
import type { ValueOf } from "./utils/types";

declare const templateMarker: unique symbol;

export interface Template {
	readonly [templateMarker]: never;
}

export interface BaseComponent extends HTMLElement {
	update(): Promise<void>;
	setProp(name: string, value: unknown, oldValue?: unknown): void;
	internals?: ElementInternals | null;
}

//undefined is the refusal: the previous value stays and the element keeps showing it. Boolean
//never refuses, which is why an absent boolean is a value and not a gap
export type Resolve<Value> = (incoming: unknown) => Value | undefined;

export type ShippedToken =
	| StringConstructor
	| NumberConstructor
	| BigIntConstructor
	| BooleanConstructor;

export type Parser = ShippedToken | Resolve<unknown>;

//the Standard Schema interface (standardschema.dev), inlined: Zod, Valibot and ArkType implement it
export interface StandardSchemaV1<Input = unknown, Output = Input> {
	readonly "~standard": {
		readonly version: 1;
		readonly vendor: string;
		readonly validate: (
			value: unknown,
		) => StandardSchemaResult<Output> | Promise<StandardSchemaResult<Output>>;
		readonly types?:
			{ readonly input: Input; readonly output: Output } | undefined;
	};
}

export type StandardSchemaResult<Output> =
	| { readonly value: Output; readonly issues?: undefined }
	| { readonly issues: ReadonlyArray<{ readonly message: string }> };

export type StandardSchemaOutput<
	DeclaredStandardSchema extends StandardSchemaV1,
> = NonNullable<DeclaredStandardSchema["~standard"]["types"]>["output"];

export type ParsedValueOf<DeclaredParser> =
	DeclaredParser extends StringConstructor
		? string
		: DeclaredParser extends NumberConstructor
			? number
			: DeclaredParser extends BigIntConstructor
				? bigint
				: DeclaredParser extends BooleanConstructor
					? boolean
					: DeclaredParser extends (incoming: never) => infer Value
						? Exclude<Value, undefined>
						: never;

//type-level only: who must supply the value (Presence) and whether the markup can (Kind) decide which
//wrappers a definition accepts and which keys a caller may leave out
export type Presence = "required" | "fallback" | "optional";
export type PropKind = "attribute" | "property";
declare const propValueType: unique symbol;

export interface PropDefinition<
	Value,
	PresenceKind extends Presence,
	Kind extends PropKind = PropKind,
> {
	readonly kind: ValueOf<typeof PROP_KIND>;
	readonly presence: ValueOf<typeof PROP_PRESENCE>;
	readonly parser: Parser;
	//kept beside its parser so a refusal can name the schema's own issue
	readonly standardSchema: StandardSchemaV1 | null;
	readonly fallback: unknown;
	readonly [propValueType]?: [Value, PresenceKind, Kind];
}

type AnyPropDefinition = PropDefinition<any, Presence>;

export type Schema = Record<string, AnyPropDefinition>;

type ValueOfDefinition<Definition> =
	Definition extends PropDefinition<infer Value, Presence> ? Value : never;

type KeysWithPresence<DeclaredSchema, PresenceKind extends Presence> = {
	[Name in keyof DeclaredSchema]: DeclaredSchema[Name] extends PropDefinition<
		any,
		PresenceKind
	>
		? Name
		: never;
}[keyof DeclaredSchema];

type Flatten<Shape> = { [Name in keyof Shape]: Shape[Name] } & {};

//the body's view: only an optional prop can be missing
export type PropsOf<DeclaredSchema> = Flatten<
	{
		[
			Name in Exclude<
				keyof DeclaredSchema,
				KeysWithPresence<DeclaredSchema, "optional">
			>
		]: ValueOfDefinition<DeclaredSchema[Name]>;
	} & {
		[Name in KeysWithPresence<DeclaredSchema, "optional">]?: ValueOfDefinition<
			DeclaredSchema[Name]
		>;
	}
>;

//a snapshot read from an element: a required prop nothing has set yet is undefined
export type ReadPropsOf<DeclaredSchema> = Flatten<
	Omit<
		PropsOf<DeclaredSchema>,
		KeysWithPresence<DeclaredSchema, "required">
	> & {
		[Name in KeysWithPresence<DeclaredSchema, "required">]:
			ValueOfDefinition<DeclaredSchema[Name]> | undefined;
	}
>;

//the element's view: every declared prop is an accessor on it, so every key exists
type HostPropsOf<DeclaredSchema> = {
	[Name in keyof DeclaredSchema]: DeclaredSchema[Name] extends PropDefinition<
		infer Value,
		infer PresenceKind
	>
		? PresenceKind extends "optional"
			? Value | undefined
			: Value
		: never;
};

//the caller's view: only a required prop must be passed
export type PassedPropsOf<DeclaredSchema> = Flatten<
	{
		[Name in KeysWithPresence<DeclaredSchema, "required">]: ValueOfDefinition<
			DeclaredSchema[Name]
		>;
	} & {
		[
			Name in Exclude<
				keyof DeclaredSchema,
				KeysWithPresence<DeclaredSchema, "required">
			>
		]?: ValueOfDefinition<DeclaredSchema[Name]>;
	}
>;

export type ComponentProps<DeclaredSchema extends Schema = Schema> = Readonly<
	PropsOf<DeclaredSchema>
> & {
	host: BaseComponent & HostPropsOf<DeclaredSchema>;
};

//partial: every ShadowRootInit field has a default, and any option passed overrides its default
export type ComponentOptions<DeclaredSchema extends Schema = Schema> =
	Partial<ShadowRootInit> & {
		formAssociated?: boolean;
		clonable?: boolean;
		props?: DeclaredSchema;
	};

//a promise resumes the generator with its value, a template paints once, an update generator re-runs
//on every update, and a load request is the one `yield* load(…)` makes
export type YieldableValue<DeclaredSchema extends Schema = Schema> =
	Template | Promise<unknown> | UpdateGenerator<DeclaredSchema> | LoadRequest;

export type Cleanup = () => void;

//a run's return value is what the body's yield of it evaluates to, unless it is a function: that is
//the run's cleanup
export type UpdateGenerator<DeclaredSchema extends Schema = Schema> = (
	componentProps: ComponentProps<DeclaredSchema>,
) => Generator<YieldableValue<DeclaredSchema>, unknown, unknown>;

export type ComponentGenerator<DeclaredSchema extends Schema = Schema> = (
	componentProps: ComponentProps<DeclaredSchema>,
) => Generator<YieldableValue<DeclaredSchema>, Cleanup | void, unknown>;

export type ComponentConstructor<DeclaredSchema extends Schema = Schema> =
	new () => BaseComponent & HostPropsOf<DeclaredSchema>;
