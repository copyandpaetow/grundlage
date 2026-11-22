export interface TemplateValue {
	__templateStrings: TemplateStringsArray;
	values: Array<unknown>;
}

export const html = (
	templateStrings: TemplateStringsArray,
	...values: Array<unknown>
): TemplateValue => ({ __templateStrings: templateStrings, values });

//user surface: the brand is a field, read across bundled copies. Only a tagged template's strings
//array carries `raw`, and JSON or structuredClone cannot make one, so data never paints as markup
export const isTemplate = (value: unknown): value is TemplateValue =>
	typeof value === "object" &&
	value !== null &&
	"__templateStrings" in value &&
	Array.isArray(value.__templateStrings) &&
	Object.hasOwn(value.__templateStrings, "raw");

export const coerceToTemplate = (value: unknown): TemplateValue =>
	isTemplate(value) ? value : html`${value}`;
