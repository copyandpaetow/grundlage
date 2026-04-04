type SchemaEntry = abstract new (...args: any[]) => any;
type SchemaDefinition = SchemaEntry | [SchemaEntry] | [SchemaEntry, any];

export type Schema = Record<string, SchemaDefinition>;

type InferEntry<T extends SchemaDefinition> = T extends [infer C, infer D]
	? Primitive<C> | (D extends undefined ? undefined : never)
	: T extends [infer C]
		? Primitive<C> | undefined
		: T extends SchemaEntry
			? Primitive<T>
			: unknown;

type Primitive<T> = T extends StringConstructor
	? string
	: T extends NumberConstructor
		? number
		: T extends BooleanConstructor
			? boolean
			: T extends abstract new (...args: any[]) => infer R
				? R
				: unknown;

type InferSchema<T extends Schema> = {
	[K in keyof T]: InferEntry<T[K]>;
};

type StringableValue = StringConstructor | NumberConstructor;

const STRINGABLE = new Set([String, Number, Boolean]);

export const props = <T extends Schema>(
	element: HTMLElement,
	schema: T,
): InferSchema<T> => {
	const result: Record<string, unknown> = {};

	for (const key in schema) {
		const entry = schema[key] as SchemaDefinition;
		let constructorValue = entry;
		let defaultValue = undefined;
		let hasDefault = false;

		if (Array.isArray(entry)) {
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
		} else if (STRINGABLE.has(constructorValue as StringableValue)) {
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
		} else if (Array.isArray(entry)) {
			result[key] = undefined;
		} else {
			throw new Error(`Missing required prop: "${key}"`);
		}
	}

	return result as InferSchema<T>;
};
