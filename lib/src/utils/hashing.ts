import { getParsedTemplate } from "../parser/html";
import { isTemplate, TemplateValue } from "../template";

export const combineOrderedHash = (
	accumulator: number,
	valueHash: number,
): number => (Math.imul(accumulator, 31) + valueHash) | 0;

export const PARTS_HASH_SEED = 0x811c9dc5 | 0;
export const LIST_HASH_SEED = 0x27d4eb2f | 0;

export const stringHash = (str: string): number => {
	let hash = 0;
	for (let index = 0; index < str.length; index++) {
		hash = combineOrderedHash(hash, str.charCodeAt(index));
	}
	return hash;
};

const TAG = {
	NULLISH: 1,
	STRING: 2,
	NUMBER: 3,
	BOOLEAN: 4,
	ARRAY: 5,
	OBJECT: 6,
	MAP: 7,
	SET: 8,
	REFERENCE: 9,
	TRUNCATED: 10,
} as const;

const MAX_DEPTH = 64;

const floatView = new Float64Array(1);
const floatIntView = new Int32Array(floatView.buffer);

const hashNumber = (numberValue: number): number => {
	if (numberValue === (numberValue | 0))
		return combineOrderedHash(TAG.NUMBER, numberValue | 0);
	floatView[0] = numberValue;
	return combineOrderedHash(
		TAG.NUMBER,
		combineOrderedHash(floatIntView[0], floatIntView[1]),
	);
};

const keyHashes = new Map<string, number>();
const hashKey = (name: string): number => {
	let cached = keyHashes.get(name);
	if (cached === undefined) {
		cached = stringHash(name);
		keyHashes.set(name, cached);
	}
	return cached;
};

//program-wide identity registry: reference ids must stay stable across every render,
//so the map and its counter outlive any single frame
const references = new WeakMap<Object, number>();
let counter = 0;

const referenceId = (value: Object): number => {
	let id = references.get(value);
	if (id === undefined) {
		counter++;
		id = Math.imul(counter, 0x9e3779b1) | 0;
		references.set(value, id);
	}
	return combineOrderedHash(TAG.REFERENCE, id);
};

const hashTemplateValue = (value: TemplateValue): number => {
	const values = value.values;
	let hash = values.length;
	for (let index = 0; index < values.length; index++) {
		hash = combineOrderedHash(hash, hashValue(values[index]));
	}
	return combineOrderedHash(
		getParsedTemplate(value.__templateStrings).templateHash,
		hash,
	);
};

const hashChild = (child: unknown, depth: number): number => {
	const type = typeof child;
	if (type === "string")
		return combineOrderedHash(TAG.STRING, stringHash(child as string));
	if (type === "number") return hashNumber(child as number);
	return hashValue(child, depth);
};

export const hashValue = (value: unknown, depth: number = 0): number => {
	if (value === null || value === undefined) return TAG.NULLISH;

	const type = typeof value;
	if (type === "string")
		return combineOrderedHash(TAG.STRING, stringHash(value as string));
	if (type === "number") return hashNumber(value as number);
	if (type === "boolean") return combineOrderedHash(TAG.BOOLEAN, value ? 1 : 0);
	if (type === "function") return referenceId(value as Object);
	if (isTemplate(value)) return hashTemplateValue(value);

	if (depth >= MAX_DEPTH) return TAG.TRUNCATED;
	const childDepth = depth + 1;

	if (Array.isArray(value)) {
		let hash = combineOrderedHash(TAG.ARRAY, value.length);
		for (let index = 0; index < value.length; index++) {
			hash = combineOrderedHash(hash, hashChild(value[index], childDepth));
		}
		return hash;
	}

	const constructor = (value as Object).constructor;

	if (constructor === Object) {
		let hash: number = TAG.OBJECT;
		for (const name in value) {
			hash = combineOrderedHash(
				combineOrderedHash(hash, hashKey(name)),
				hashChild(value[name as keyof typeof value], childDepth),
			);
		}
		return hash;
	}

	if (constructor === Map) {
		const map = value as Map<unknown, unknown>;
		let hash = combineOrderedHash(TAG.MAP, map.size);
		for (const key of map.keys()) {
			hash = combineOrderedHash(
				combineOrderedHash(hash, hashChild(key, childDepth)),
				hashChild(map.get(key), childDepth),
			);
		}
		return hash;
	}

	if (constructor === Set) {
		const set = value as Set<unknown>;
		let hash = combineOrderedHash(TAG.SET, set.size);
		for (const member of set) {
			hash = combineOrderedHash(hash, hashChild(member, childDepth));
		}
		return hash;
	}

	return referenceId(value as Object);
};
