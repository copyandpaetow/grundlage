import { MARKUP } from "../parser/chars";
import { DEFER_HYDRATION_ATTRIBUTE } from "../rendering/constants";
import { isTemplate } from "../template";
import { Parse, Resolve, Schema } from "../types";
import { libraryMessage } from "../utils/diagnostics";

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
	readonly absenceReadsTrue: boolean;
}

export type NormalizedSchema = ReadonlyMap<string, Prop>;

//a template is excluded because the strings array inside it is the identity the parse cache keys on
const isCopiedPerElement = (fallback: unknown): fallback is object =>
	fallback !== null && typeof fallback === "object" && !isTemplate(fallback);

const assertFallbackIsUsable = (
	propName: string,
	parse: Resolve<unknown>,
	fallback: unknown,
): void => {
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

	if (parse(copy) === undefined)
		throw new TypeError(
			libraryMessage(
				`the fallback for prop "${propName}" is not a value the prop accepts: its function refused it. Pass a fallback the function accepts.`,
			),
		);
};

const assertPropNameIsUsable = (propName: string): void => {
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

//a schema is declared once and read again by every props() call, so it is normalized once for as long
//as it lives
const normalizedSchemasBySchema = new WeakMap<Schema, NormalizedSchema>();

export const normalizeSchema = (schema: Schema): NormalizedSchema => {
	const alreadyNormalized = normalizedSchemasBySchema.get(schema);
	if (alreadyNormalized !== undefined) return alreadyNormalized;

	const props = new Map<string, Prop>();

	for (const propName in schema) {
		assertPropNameIsUsable(propName);

		const definition = schema[propName];
		const [declared, fallback] = (
			Array.isArray(definition) ? definition : [definition, undefined]
		) as [Parse, unknown];
		const parse =
			SHIPPED_RESOLVERS.get(declared) ?? (declared as Resolve<unknown>);

		if (typeof parse !== "function")
			throw new TypeError(
				libraryMessage(
					`prop "${propName}" must be String, Number, BigInt, Boolean, or a function.`,
				),
			);
		if (fallback !== undefined)
			assertFallbackIsUsable(propName, parse, fallback);

		const attributeName = propName.toLowerCase();
		const claimant = props.get(attributeName);
		if (claimant !== undefined)
			throw new TypeError(
				libraryMessage(
					`props "${claimant.propName}" and "${propName}" both map to the attribute "${attributeName}". Attribute names ignore case, so rename one of them.`,
				),
			);

		const mustCopyFallback = isCopiedPerElement(fallback);
		const resolve: Resolve<unknown> =
			fallback === undefined
				? parse
				: (incoming) => {
						if (incoming !== undefined) return parse(incoming);
						return parse(
							mustCopyFallback ? structuredClone(fallback) : fallback,
						);
					};

		props.set(attributeName, {
			propName,
			resolve,
			//[Boolean, true] is the one shape where removing the attribute would read back as the
			//opposite, so reflection writes "false" instead; only the shipped token's absence rule is
			//documented, so a user-supplied boolean function is left out of it
			absenceReadsTrue: parse === resolveBoolean && resolve(undefined) === true,
		});
	}

	normalizedSchemasBySchema.set(schema, props);
	return props;
};

export const assertPropNamesAreAvailable = (
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
