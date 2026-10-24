import { ReadPropsOf, Schema } from "../types";
import * as PROP_KIND from "./prop-kind";
import { normalizeSchema } from "./schema";
import { PropValues, claimPropValueChange } from "./values";

export const read = <DeclaredSchema extends Schema>(
	element: HTMLElement,
	schema: DeclaredSchema,
): ReadPropsOf<DeclaredSchema> => {
	const normalized = normalizeSchema(schema);
	//Element has no index signature; props are read by their runtime name
	const record = element as unknown as Record<string, unknown>;
	const values: PropValues = {};

	for (const prop of normalized.values())
		values[prop.propName] = prop.resolve(undefined);

	for (const [attributeName, prop] of normalized) {
		const isOwnProperty = Object.hasOwn(record, prop.propName);
		const isAbsent =
			!isOwnProperty &&
			(prop.kind === PROP_KIND.PROPERTY ||
				!element.hasAttribute(attributeName));
		if (isAbsent) continue;
		claimPropValueChange(
			values,
			prop,
			isOwnProperty
				? record[prop.propName]
				: element.getAttribute(attributeName),
		);
	}

	//filled under every declared prop name above
	return values as ReadPropsOf<DeclaredSchema>;
};
