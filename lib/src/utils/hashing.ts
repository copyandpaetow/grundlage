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
		//we reinterpret the float's 64 bits as two int32s
		//equal floats share bit patterns, so we can hash equal numbers equally without stringifying
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
			//name is always a string here, so we can skip the typeof dispatch in hashValue
			hash =
				(Math.imul(hash, 31) +
					stringHash(name) +
					hashValue(value[name as keyof typeof value])) |
				0;
		}
		return hash;
	}

	/*
	for anything else (Map, Set, class instances, functions, …) we can't cheaply look at the contents — and even if we could, function closures hide state we'd never see
	walking blindly would be expensive and still inaccurate, so we'd be stuck choosing between stale renders and unnecessary ones
	=> we hash by reference identity instead: every fresh object gets a unique counter id that we keep in a WeakMap, so as long as the user passes the same reference we report it as unchanged
	the trade-off: an inline `onClick={() => ...}` is a fresh function on every render, so its hash always differs and the listener gets reapplied each time
	*/
	if (references.has(value)) {
		return references.get(value)!;
	}
	counter++;
	references.set(value, counter);

	return counter;
};
