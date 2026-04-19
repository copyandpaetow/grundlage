import { HTMLTemplate } from "../rendering/template-html";

export const stringHash = (str: string): number => {
	let hash = 0;
	for (let index = 0; index < str.length; index++) {
		hash = (Math.imul(hash, 31) + str.charCodeAt(index)) | 0;
	}
	return hash;
};

const floatView = new Float64Array(1);
const floatIntView = new Int32Array(floatView.buffer);

const references = new WeakMap<Object, number>();
let counter = 0;

export const hashValue = (value: unknown): number => {
	if (value === null || value === undefined) return 0;
	if (typeof value === "string") return stringHash(value);
	if (typeof value === "number") {
		if (value === (value | 0)) return value | 0;
		floatView[0] = value;
		return (Math.imul(floatIntView[0], 31) + floatIntView[1]) | 0;
	}
	if (typeof value === "boolean") return value ? 1 : 0;
	if (value instanceof HTMLTemplate) return value.hash;

	if (Array.isArray(value)) {
		let hash = value.length;
		for (let index = 0; index < value.length; index++) {
			hash = (Math.imul(hash, 31) + hashValue(value[index])) | 0;
		}
		return hash;
	}

	if (value.constructor === Object) {
		let hash = 0;
		for (const name in value) {
			// name is always a string — skip the typeof dispatch in hashValue.
			hash =
				(Math.imul(hash, 31) +
					stringHash(name) +
					hashValue(value[name as keyof typeof value])) |
				0;
		}
		return hash;
	}

	/*
		looking into complex data structures is costly and not very accurate (cant capture function closures), so we are stuck between stale state or unnecessary re-renderings
		=> using a cache is a compromise, as long as the reference is stable, we assume it doesnt need re-rendering
		The downside here is inline event handlers always get reapplied
	*/
	if (references.has(value)) {
		return references.get(value)!;
	}
	counter++;
	references.set(value, counter);

	return counter;
};
