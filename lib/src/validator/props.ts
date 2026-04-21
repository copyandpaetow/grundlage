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

export const props = <Type extends Schema>(
	element: HTMLElement,
	schema: Type,
): InferSchema<Type> => {
	const result: Record<string, unknown> = {};

	for (const key in schema) {
		const entry = schema[key] as SchemaDefinition;
		const isArrayEntry = Array.isArray(entry);
		let constructorValue = entry;
		let defaultValue = undefined;
		let hasDefault = false;

		if (isArrayEntry) {
			constructorValue = entry[0];
			defaultValue = entry[1];
			hasDefault = entry.length > 1;
		}

		let value: unknown;

		if (constructorValue === Boolean) {
			if (element.hasAttribute(key)) {
				value = true;
			} else if (hasDefault) {
				value = defaultValue;
			} else {
				value = false;
			}
		} else if (constructorValue === String || constructorValue === Number) {
			const raw = element.getAttribute(key);
			if (raw !== null) {
				value = (constructorValue as StringableValue)(raw);
				if (constructorValue === Number && Number.isNaN(value)) {
					throw new Error(
						`Invalid number value for attribute "${key}": "${raw}"`,
					);
				}
			} else {
				value = element[key as keyof typeof element] ?? undefined;
			}
		} else {
			value = element[key as keyof typeof element] ?? undefined;
		}

		if (constructorValue === Boolean) {
			result[key] = value;
		} else if (value !== undefined) {
			result[key] = value;
		} else if (hasDefault) {
			result[key] = defaultValue;
		} else if (isArrayEntry) {
			result[key] = undefined;
		} else {
			throw new Error(`Missing required prop: "${key}"`);
		}
	}

	return result as InferSchema<Type>;
};
