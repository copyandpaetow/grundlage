import type {
	Parser,
	ParsedValueOf,
	PropDefinition,
	PropKind,
	Resolve,
	StandardSchemaOutput,
	StandardSchemaV1,
} from "../types";
import { libraryMessage } from "../utils/diagnostics";
import * as PROP_KIND from "./prop-kind";
import * as PROP_PRESENCE from "./prop-presence";

const takeAsIs: Resolve<unknown> = (incoming) => incoming;

//user surface: ArkType's schemas are callable, so a function can be a schema too
const isStandardSchema = (value: unknown): value is StandardSchemaV1 =>
	(typeof value === "object" || typeof value === "function") &&
	value !== null &&
	"~standard" in value;

const resolverOfStandardSchema =
	(standardSchema: StandardSchemaV1): Resolve<unknown> =>
	(incoming) => {
		const result = standardSchema["~standard"].validate(incoming);
		if (result instanceof Promise)
			throw new TypeError(
				libraryMessage(
					"a prop's schema validated asynchronously; a prop is written synchronously, so use a schema without async refinements.",
				),
			);
		return result.issues === undefined ? result.value : undefined;
	};

export function property<DeclaredStandardSchema extends StandardSchemaV1>(
	standardSchema: DeclaredStandardSchema,
): PropDefinition<
	StandardSchemaOutput<DeclaredStandardSchema>,
	"required",
	"property"
>;
export function property<DeclaredStandardSchema extends StandardSchemaV1>(
	standardSchema: DeclaredStandardSchema,
	fallback: StandardSchemaOutput<DeclaredStandardSchema>,
): PropDefinition<
	StandardSchemaOutput<DeclaredStandardSchema>,
	"fallback",
	"property"
>;
export function property<Value>(): PropDefinition<
	Value,
	"required",
	"property"
>;
export function property<Value>(
	fallback: Value,
): PropDefinition<Value, "fallback", "property">;
export function property(
	...schemaAndFallback: Array<unknown>
): PropDefinition<unknown, "required" | "fallback", "property"> {
	const standardSchema = isStandardSchema(schemaAndFallback[0])
		? schemaAndFallback[0]
		: null;
	const fallbackPart =
		standardSchema === null ? schemaAndFallback : schemaAndFallback.slice(1);
	return {
		kind: PROP_KIND.PROPERTY,
		presence:
			fallbackPart.length > 0 ? PROP_PRESENCE.FALLBACK : PROP_PRESENCE.REQUIRED,
		parser:
			standardSchema === null
				? takeAsIs
				: resolverOfStandardSchema(standardSchema),
		standardSchema,
		fallback: fallbackPart[0],
	};
}

export function attribute<DeclaredParser extends Parser>(
	parser: DeclaredParser,
): PropDefinition<
	ParsedValueOf<DeclaredParser>,
	DeclaredParser extends BooleanConstructor ? "fallback" : "required",
	"attribute"
>;
export function attribute<DeclaredParser extends Parser>(
	parser: DeclaredParser,
	fallback: ParsedValueOf<DeclaredParser>,
): PropDefinition<ParsedValueOf<DeclaredParser>, "fallback", "attribute">;
export function attribute(
	parser: Parser,
	...fallbackPart: Array<unknown>
): PropDefinition<unknown, "required" | "fallback", "attribute"> {
	//an absent boolean attribute is false, so a boolean always has a value
	const isImplicitlyFalse = parser === Boolean && fallbackPart.length === 0;
	return {
		kind: PROP_KIND.ATTRIBUTE,
		presence:
			fallbackPart.length > 0 || isImplicitlyFalse
				? PROP_PRESENCE.FALLBACK
				: PROP_PRESENCE.REQUIRED,
		parser,
		standardSchema: null,
		fallback: isImplicitlyFalse ? false : fallbackPart[0],
	};
}

export const optional = <Value, Kind extends PropKind>(
	definition: PropDefinition<Value, "required", Kind>,
): PropDefinition<Value, "optional", Kind> => {
	if (definition.presence !== PROP_PRESENCE.REQUIRED)
		throw new TypeError(
			libraryMessage(
				"prop.optional() takes a prop without a fallback, and only once: a fallback already makes the prop optional for the caller.",
			),
		);
	//the phantom value type moves from required to optional, which the spread cannot express
	return {
		...definition,
		presence: PROP_PRESENCE.OPTIONAL,
	} as PropDefinition<Value, "optional", Kind>;
};

export const unreflected = <
	Value,
	PresenceKind extends "required" | "fallback",
>(
	definition: PropDefinition<Value, PresenceKind, "attribute">,
): PropDefinition<Value, PresenceKind, "attribute"> => {
	if (definition.kind !== PROP_KIND.ATTRIBUTE)
		throw new TypeError(
			libraryMessage(
				"prop.unreflected() takes a prop.attribute(…): a prop.property() never reflects anyway.",
			),
		);
	if (definition.presence === PROP_PRESENCE.OPTIONAL)
		throw new TypeError(
			libraryMessage(
				"prop.unreflected() goes inside prop.optional(): write prop.optional(prop.unreflected(prop.attribute(…))).",
			),
		);
	return { ...definition, kind: PROP_KIND.UNREFLECTED_ATTRIBUTE };
};

export const oneOf =
	<const Values extends ReadonlyArray<string>>(
		...values: Values
	): Resolve<Values[number]> =>
	(incoming) =>
		values.includes(incoming as string)
			? //includes() just narrowed it to one of the values
				(incoming as Values[number])
			: undefined;
