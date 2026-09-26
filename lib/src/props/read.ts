import { DeclaredProps, Schema } from "../types";
import { normalizeSchema } from "./schema";
import { PropValues, writeProp } from "./values";

export const props = <DeclaredSchema extends Schema>(
	element: HTMLElement,
	schema: DeclaredSchema,
): DeclaredProps<DeclaredSchema> => {
	const normalized = normalizeSchema(schema);
	const record = element as unknown as Record<string, unknown>;
	const values: PropValues = {};

	for (const prop of normalized.values())
		values[prop.propName] = prop.resolve(undefined);

	for (const [attributeName, prop] of normalized) {
		const incoming = Object.hasOwn(record, prop.propName)
			? record[prop.propName]
			: element.getAttribute(attributeName);
		writeProp(values, prop, incoming);
	}

	return values as DeclaredProps<DeclaredSchema>;
};
