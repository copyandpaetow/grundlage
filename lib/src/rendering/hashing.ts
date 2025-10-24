import { HTMLTemplate } from "./template";

export const stringHash = (str: string): number => {
	let hash = 0;
	for (let index = 0; index < str.length; index++) {
		hash = (hash * 31 + str.charCodeAt(index)) | 0;
	}
	return hash;
};

export const hashValue = (value: unknown): number => {
	if (value == null) return 0;
	if (typeof value === "string") return stringHash(value);
	if (typeof value === "number") return value | 0;
	if (typeof value === "boolean") return value ? 1 : 0;
	if (value instanceof HTMLTemplate)
		return value.templateResult.templateHash ?? 0;
	if (Array.isArray(value)) {
		let hash = 0;
		for (let index = 0; index < value.length; index++) {
			hash = (hash * 31 + hashValue(value[index])) | 0;
		}
		return hash;
	}
	return 0;
};
