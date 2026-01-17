import { HTMLTemplate } from "./template-html";

export const stringHash = (str: string): number => {
	let hash = 0;
	for (let index = 0; index < str.length; index++) {
		hash = (hash * 31 + str.charCodeAt(index)) | 0;
	}
	return hash;
};

const references = new WeakMap<Object, number>();
let counter = 0;

export const hashValue = (value: unknown): number => {
	if (value == null) return 0;
	if (typeof value === "string") return stringHash(value);
	if (typeof value === "number") return value | 0;
	if (typeof value === "boolean") return value ? 1 : 0;
	if (typeof value === "function") return stringHash(value.toString());
	if (value instanceof HTMLTemplate)
		return value.parsedHTML.templateHash ^ (value.expressionsHash * 31);

	if (references.has(value)) {
		return references.get(value)!;
	}
	counter++;
	references.set(value, counter);

	return counter;
};
