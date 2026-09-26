export interface TemplateValue {
	__templateStrings: TemplateStringsArray;
	values: Array<unknown>;
}

export const html = (
	templateStrings: TemplateStringsArray,
	...values: Array<unknown>
): TemplateValue => ({ __templateStrings: templateStrings, values });

//user surface: the value comes from the app's own `html` call, so the brand is the field rather than
//an internal marker
export const isTemplate = (value: unknown): value is TemplateValue =>
	typeof value === "object" && value !== null && "__templateStrings" in value;

export const coerceToTemplate = (value: unknown): TemplateValue =>
	isTemplate(value) ? value : html`${value}`;
