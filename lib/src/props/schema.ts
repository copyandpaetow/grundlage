import { MARKUP } from "../parser/chars";
import { DEFER_HYDRATION_ATTRIBUTE } from "../rendering/constants";
import { isTemplate } from "../template";
import { Parse, Resolve, Schema } from "../types";

const PROP_NAME_PATTERN = /^[a-z][a-zA-Z0-9_-]*$/;

const resolveString: Resolve<string> = (incoming) =>
	incoming === undefined ? undefined : String(incoming);

const resolveNumber: Resolve<number> = (incoming) => {
	if (incoming === undefined || incoming === "") return undefined;
	const parsed = Number(incoming);
	if (Number.isNaN(parsed) && String(incoming).trim() !== "NaN")
		return undefined;
	return parsed;
};

const resolveBigInt: Resolve<bigint> = (incoming) => {
	if (incoming === undefined || incoming === "") return undefined;
	try {
		return BigInt(incoming as string);
	} catch {
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
	propName: string;
	resolve: Resolve<unknown>;
	absenceReadsTrue: boolean;
}

export type NormalizedSchema = Map<string, Prop>;

//a template is excluded because the strings array inside it is the identity the parse cache keys on
const isCopiedPerElement = (fallback: unknown): fallback is object =>
	fallback !== null && typeof fallback === "object" && !isTemplate(fallback);

const copyOf = (fallback: unknown): unknown =>
	isCopiedPerElement(fallback) ? structuredClone(fallback) : fallback;

const assertFallbackIsUsable = (
	propName: string,
	parse: Resolve<unknown>,
	fallback: unknown,
): void => {
	if (isCopiedPerElement(fallback)) {
		//structuredClone strips a class prototype and returns a plain object
		let copy: unknown;
		try {
			copy = structuredClone(fallback);
		} catch {
			copy = undefined;
		}
		if (
			copy === undefined ||
			Object.getPrototypeOf(copy) !== Object.getPrototypeOf(fallback)
		)
			throw new TypeError(
				`grundlage: the fallback for prop "${propName}" cannot be copied for each element.`,
			);
	}

	if (parse(copyOf(fallback)) === undefined)
		throw new TypeError(
			`grundlage: the fallback for prop "${propName}" is not a value the prop accepts: its function refused it.`,
		);
};

const assertPropNameIsUsable = (propName: string): void => {
	if (!PROP_NAME_PATTERN.test(propName))
		throw new TypeError(
			`grundlage: prop name "${propName}" must start with a lowercase letter and contain only letters, digits, "_" or "-".`,
		);
	if (propName.startsWith(MARKUP.CUSTOM_EVENT_PREFIX))
		throw new TypeError(
			`grundlage: prop name "${propName}" is reserved: "${MARKUP.CUSTOM_EVENT_PREFIX}" marks a custom event binding in markup.`,
		);
	if (propName === "host")
		throw new TypeError(
			`grundlage: "host" is reserved: the props object carries the element under that name.`,
		);
	if (propName === DEFER_HYDRATION_ATTRIBUTE)
		throw new TypeError(
			`grundlage: "${DEFER_HYDRATION_ATTRIBUTE}" is reserved: it marks a child that must not hydrate before its parent has supplied its values.`,
		);
};

const normalizedSchemasBySchema = new WeakMap<Schema, NormalizedSchema>();

export const normalizeSchema = (schema: Schema): NormalizedSchema => {
	const alreadyNormalized = normalizedSchemasBySchema.get(schema);
	if (alreadyNormalized !== undefined) return alreadyNormalized;

	const props: NormalizedSchema = new Map();

	for (const propName in schema) {
		assertPropNameIsUsable(propName);

		const definition = schema[propName];
		const declared = (
			Array.isArray(definition) ? definition[0] : definition
		) as Parse;
		const fallback = Array.isArray(definition) ? definition[1] : undefined;
		const parse =
			SHIPPED_RESOLVERS.get(declared) ?? (declared as Resolve<unknown>);

		if (typeof parse !== "function")
			throw new TypeError(
				`grundlage: prop "${propName}" must be String, Number, BigInt, Boolean, or a function.`,
			);
		if (fallback !== undefined)
			assertFallbackIsUsable(propName, parse, fallback);

		const attributeName = propName.toLowerCase();
		const claimant = props.get(attributeName);
		if (claimant !== undefined)
			throw new TypeError(
				`grundlage: props "${claimant.propName}" and "${propName}" both map to the attribute "${attributeName}".`,
			);

		const resolve: Resolve<unknown> =
			fallback === undefined
				? parse
				: (incoming) =>
						parse(incoming === undefined ? copyOf(fallback) : incoming);

		props.set(attributeName, {
			propName,
			resolve,
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
				`grundlage: prop "${prop.propName}" is already a property on the element.`,
			);
};
