type SchemaEntry = abstract new (...args: any[]) => any;
type SchemaDefinition = SchemaEntry | [SchemaEntry] | [SchemaEntry, any];

export type Schema = Record<string, SchemaDefinition>;

type InferEntry<Type extends SchemaDefinition> = Type extends [
	infer Constructor,
	infer Default,
]
	? Primitive<Constructor> | (Default extends undefined ? undefined : never)
	: Type extends [infer Constructor]
		? Primitive<Constructor> | undefined
		: Type extends SchemaEntry
			? Primitive<Type>
			: unknown;

type Primitive<Type> = Type extends StringConstructor
	? string
	: Type extends NumberConstructor
		? number
		: Type extends BooleanConstructor
			? boolean
			: Type extends abstract new (...args: any[]) => infer Result
				? Result
				: unknown;

type InferSchema<Type extends Schema> = {
	[Key in keyof Type]: InferEntry<Type[Key]>;
};

type StringableValue = StringConstructor | NumberConstructor;

type ResolvedSchemaEntry = {
	constructorValue: SchemaEntry;
	defaultValue: unknown;
	hasDefault: boolean;
	isOptional: boolean;
};

const resolveSchemaEntry = (entry: SchemaDefinition): ResolvedSchemaEntry => {
	if (Array.isArray(entry)) {
		return {
			constructorValue: entry[0],
			defaultValue: entry.length > 1 ? entry[1] : undefined,
			hasDefault: entry.length > 1,
			isOptional: true,
		};
	}
	return {
		constructorValue: entry,
		defaultValue: undefined,
		hasDefault: false,
		isOptional: false,
	};
};

const readBooleanProp = (
	element: HTMLElement,
	key: string,
	valueWhenAbsent: unknown,
): unknown => {
	if (element.hasAttribute(key)) return true;
	if (Object.hasOwn(element, key))
		return Boolean(element[key as keyof typeof element]);
	return valueWhenAbsent;
};

const readStringableProp = (
	element: HTMLElement,
	key: string,
	constructorValue: StringableValue,
): unknown => {
	const raw = element.getAttribute(key);
	const isAbsent = raw === null || (constructorValue === Number && raw === "");
	if (isAbsent) {
		if (!Object.hasOwn(element, key)) return undefined;
		return element[key as keyof typeof element] ?? undefined;
	}
	const coerced = constructorValue(raw);
	if (constructorValue === Number && Number.isNaN(coerced)) {
		throw new Error(
			`grundlage: Invalid number value for attribute "${key}": "${raw}"`,
		);
	}
	return coerced;
};

export const props = <Type extends Schema>(
	element: HTMLElement,
	schema: Type,
): InferSchema<Type> => {
	const result: Record<string, unknown> = {};

	for (const key in schema) {
		const { constructorValue, defaultValue, hasDefault, isOptional } =
			resolveSchemaEntry(schema[key] as SchemaDefinition);

		if (constructorValue === Boolean) {
			result[key] = readBooleanProp(
				element,
				key,
				hasDefault ? defaultValue : false,
			);
			continue;
		}

		const value =
			constructorValue === String || constructorValue === Number
				? readStringableProp(element, key, constructorValue as StringableValue)
				: (element[key as keyof typeof element] ?? undefined);

		if (value !== undefined) {
			result[key] = value;
		} else if (hasDefault) {
			result[key] = defaultValue;
		} else if (isOptional) {
			result[key] = undefined;
		} else {
			throw new Error(`grundlage: Missing required prop: "${key}"`);
		}
	}

	return result as InferSchema<Type>;
};
