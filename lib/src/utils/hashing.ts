import { HTMLTemplate } from "../rendering/template-html";

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
	if (value === null || value === undefined) return 0;
	if (typeof value === "string") return stringHash(value);
	if (typeof value === "number") return value | 0;
	if (typeof value === "boolean") return value ? 1 : 0;
	if (value instanceof HTMLTemplate) return value.hash;

	if (Array.isArray(value)) {
		let hash = value.length;
		for (const entry of value) {
			hash = (hash * 31 + hashValue(entry)) | 0;
		}
		return hash;
	}

	if (value.constructor === Object) {
		let hash = 0;
		for (const name in value) {
			hash =
				(hash * 31 +
					hashValue(name) +
					hashValue(value[name as keyof typeof value])) |
				0;
		}
		return hash;
	}

	/*
		looking into complex data structures is costly and not very accurate (cant capture function closures), so we are stuck between stale state or unnecessary re-renderings
		=> using a cache like is a compromise, as long as the reference is stable, we assume it doesnt need re-rendering
		downside here is inline event handlers always get reapplied 
	*/
	if (references.has(value)) {
		return references.get(value)!;
	}
	counter++;
	references.set(value, counter);

	return counter;
};
