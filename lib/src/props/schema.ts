import * as MARKUP from "../parser/markup";
import { DEFER_HYDRATION_ATTRIBUTE } from "../rendering/constants";
import { isTemplate } from "../template";
import { PropDefinition, Resolve, Schema, StandardSchemaV1 } from "../types";
import { ValueOf } from "../utils/types";
import { libraryMessage } from "../utils/diagnostics";
import * as PROP_KIND from "./prop-kind";
import * as PROP_PRESENCE from "./prop-presence";

const PROP_NAME_PATTERN = /^[a-z][a-zA-Z0-9_-]*$/;

const resolveString: Resolve<string> = (incoming) =>
	incoming === undefined ? undefined : String(incoming);

const resolveNumber: Resolve<number> = (incoming) => {
	if (incoming === undefined || incoming === "") return undefined;
	const parsed = Number(incoming);
	const isUnparsable =
		Number.isNaN(parsed) && String(incoming).trim() !== "NaN";
	if (isUnparsable) return undefined;
	return parsed;
};

const resolveBigInt: Resolve<bigint> = (incoming) => {
	if (incoming === undefined || incoming === "") return undefined;
	try {
		return BigInt(incoming as string);
	} catch {
		//BigInt throws on text it cannot parse, and a resolver refuses with undefined
		return undefined;
	}
};

const resolveBoolean: Resolve<boolean> = (incoming) =>
	typeof incoming === "string" ? incoming !== "false" : Boolean(incoming);

const SHIPPED_RESOLVERS = new Map<unknown, Resolve<unknown>>([
	[String, resolveString],
	[Number, resolveNumber],
	[BigInt, resolveBigInt],
	[Boolean, resolveBoolean],
]);

export interface Prop {
	readonly propName: string;
	readonly resolve: Resolve<unknown>;
	readonly kind: ValueOf<typeof PROP_KIND>;
	readonly isRequired: boolean;
	readonly isTrueWhenAbsent: boolean;
	readonly standardSchema: StandardSchemaV1 | null;
}

export type NormalizedSchema = ReadonlyMap<string, Prop>;

//a template is excluded because the strings array inside it is the identity the parse cache keys on
const isCopiedPerElement = (fallback: unknown): fallback is object =>
	fallback !== null && typeof fallback === "object" && !isTemplate(fallback);

export const issueMessagesOf = (
	standardSchema: StandardSchemaV1,
	value: unknown,
): string => {
	const result = standardSchema["~standard"].validate(value);
	if (result instanceof Promise || result.issues === undefined) return "";
	return result.issues.map((issue) => issue.message).join("; ");
};

const ensureFallbackIsUsable = (
	propName: string,
	definition: PropDefinition<unknown, "fallback">,
	resolveWithoutFallback: Resolve<unknown>,
): void => {
	const fallback = definition.fallback;
	if (fallback === undefined)
		throw new TypeError(
			libraryMessage(
				`the fallback for prop "${propName}" is undefined, which is no fallback. Drop it to make the prop required, or wrap the prop in prop.optional().`,
			),
		);
	let copy = fallback;
	if (isCopiedPerElement(fallback)) {
		try {
			copy = structuredClone(fallback);
		} catch {
			throw new TypeError(
				libraryMessage(
					`the fallback for prop "${propName}" cannot be copied for each element: structuredClone refuses it, as it does anything holding a function, DOM node, symbol or WeakMap. Use a fallback of plain data.`,
				),
			);
		}
		if (Object.getPrototypeOf(copy) !== Object.getPrototypeOf(fallback))
			throw new TypeError(
				libraryMessage(
					`the fallback for prop "${propName}" cannot be copied for each element: structuredClone returns a plain object, so a class instance loses its prototype.`,
				),
			);
	}

	if (resolveWithoutFallback(copy) !== undefined) return;
	if (definition.standardSchema !== null)
		throw new TypeError(
			libraryMessage(
				`the fallback for prop "${propName}" is not a value its schema accepts: ${issueMessagesOf(definition.standardSchema, copy)}. Pass a fallback the schema accepts.`,
			),
		);
	throw new TypeError(
		libraryMessage(
			`the fallback for prop "${propName}" is not a value its parser accepts: the parser returned undefined for it. Pass a fallback the parser accepts.`,
		),
	);
};

//user surface: the entries before prop.attribute() and prop.property() (String, [Number, 7], a
//function) are not objects with a parser
const ensureIsPropDefinition: (
	propName: string,
	definition: unknown,
) => asserts definition is PropDefinition<
	unknown,
	"required" | "fallback" | "optional"
> = (propName, definition) => {
	const isPropDefinition =
		typeof definition === "object" &&
		definition !== null &&
		(definition as Partial<PropDefinition<unknown, "required">>).parser !==
			undefined;
	if (!isPropDefinition)
		throw new TypeError(
			libraryMessage(
				`prop "${propName}" must be declared with prop.attribute(parser) for a value the markup can set, or prop.property<Type>() for a value only JavaScript sets: prop.attribute(Number, 0) instead of [Number, 0].`,
			),
		);
};

const ensurePropNameIsUsable = (propName: string): void => {
	if (!PROP_NAME_PATTERN.test(propName))
		throw new TypeError(
			libraryMessage(
				`prop name "${propName}" must start with a lowercase letter and contain only letters, digits, "_" or "-".`,
			),
		);
	if (propName.startsWith(MARKUP.CUSTOM_EVENT_PREFIX))
		throw new TypeError(
			libraryMessage(
				`prop name "${propName}" is reserved: "${MARKUP.CUSTOM_EVENT_PREFIX}" marks a custom event binding in markup.`,
			),
		);
	if (propName === "host")
		throw new TypeError(
			libraryMessage(
				`"host" is reserved: the props object carries the element under that name.`,
			),
		);
	if (propName === DEFER_HYDRATION_ATTRIBUTE)
		throw new TypeError(
			libraryMessage(
				`"${DEFER_HYDRATION_ATTRIBUTE}" is reserved: it marks a child that must not hydrate before its parent has supplied its values.`,
			),
		);
};

//a schema is declared once and read again by every prop.read() call, so it is normalized once for as long
//as it lives
const normalizedSchemasBySchema = new WeakMap<Schema, NormalizedSchema>();

export const normalizeSchema = (schema: Schema): NormalizedSchema => {
	const alreadyNormalized = normalizedSchemasBySchema.get(schema);
	if (alreadyNormalized !== undefined) return alreadyNormalized;

	const props = new Map<string, Prop>();

	for (const propName in schema) {
		ensurePropNameIsUsable(propName);

		const definition: unknown = schema[propName];
		ensureIsPropDefinition(propName, definition);
		//every shipped token is in the map, so what falls through is the user's function
		const resolveWithoutFallback = (SHIPPED_RESOLVERS.get(definition.parser) ??
			definition.parser) as Resolve<unknown>;
		if (typeof resolveWithoutFallback !== "function")
			throw new TypeError(
				libraryMessage(
					`prop "${propName}": prop.attribute() takes String, Number, BigInt, Boolean, or a function.`,
				),
			);
		const hasFallback = definition.presence === PROP_PRESENCE.FALLBACK;
		if (hasFallback)
			ensureFallbackIsUsable(
				propName,
				//its presence just said it carries a fallback
				definition as PropDefinition<unknown, "fallback">,
				resolveWithoutFallback,
			);

		const attributeName = propName.toLowerCase();
		const claimant = props.get(attributeName);
		if (claimant !== undefined)
			throw new TypeError(
				libraryMessage(
					`props "${claimant.propName}" and "${propName}" both map to the attribute "${attributeName}". Attribute names ignore case, so rename one of them.`,
				),
			);

		const fallback = definition.fallback;
		const mustCopyFallback = isCopiedPerElement(fallback);
		const resolve: Resolve<unknown> = !hasFallback
			? resolveWithoutFallback
			: (incoming) => {
					if (incoming !== undefined) return resolveWithoutFallback(incoming);
					return resolveWithoutFallback(
						mustCopyFallback ? structuredClone(fallback) : fallback,
					);
				};

		props.set(attributeName, {
			propName,
			resolve,
			kind: definition.kind,
			isRequired: definition.presence === PROP_PRESENCE.REQUIRED,
			//prop.attribute(Boolean, true) is the one shape where removing the attribute would read back as the
			//opposite, so reflection writes "false" instead; only the shipped token's absence rule is
			//documented, so a user-supplied boolean function is left out of it
			isTrueWhenAbsent:
				resolveWithoutFallback === resolveBoolean &&
				resolve(undefined) === true,
			standardSchema: definition.standardSchema,
		});
	}

	normalizedSchemasBySchema.set(schema, props);
	return props;
};

export const ensurePropNamesAreAvailable = (
	elementPrototype: object,
	props: NormalizedSchema,
): void => {
	for (const prop of props.values())
		if (prop.propName in elementPrototype)
			throw new TypeError(
				libraryMessage(
					`prop "${prop.propName}" is already a property on the element. Rename the prop.`,
				),
			);
};
