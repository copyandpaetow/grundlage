import { getParsedTemplate } from "../parser/html";
import { isTemplate, TemplateValue } from "../template";
import {
	combineOrderedHash,
	HASH_MULTIPLIER,
	stringHash,
} from "../utils/hashing";

const TAG = {
	NULLISH: 1,
	STRING: 2,
	NUMBER: 3,
	BOOLEAN: 4,
	BIGINT: 5,
	ARRAY: 6,
	OBJECT: 7,
	MAP: 8,
	SET: 9,
	REFERENCE: 10,
	TRUNCATED: 11,
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

//program-wide identity registry: reference ids must stay stable across every render,
//so the map and its counter outlive any single frame
const references = new WeakMap<Object, number>();
let counter = 0;

const referenceId = (value: Object): number => {
	let id = references.get(value);
	if (id === undefined) {
		counter++;
		id = Math.imul(counter, HASH_MULTIPLIER) | 0;
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

export const hashValue = (value: unknown, depth: number = 0): number => {
	if (value === null || value === undefined) return TAG.NULLISH;

	const type = typeof value;
	if (type === "string")
		return combineOrderedHash(TAG.STRING, stringHash(value as string));
	if (type === "number") return hashNumber(value as number);
	if (type === "bigint")
		return combineOrderedHash(TAG.BIGINT, stringHash(String(value)));
	if (type === "boolean") return combineOrderedHash(TAG.BOOLEAN, value ? 1 : 0);
	if (type === "function") return referenceId(value as Object);
	if (isTemplate(value)) return hashTemplateValue(value);

	if (depth >= MAX_DEPTH) return TAG.TRUNCATED;
	const childDepth = depth + 1;

	if (Array.isArray(value)) {
		let hash = combineOrderedHash(TAG.ARRAY, value.length);
		for (let index = 0; index < value.length; index++) {
			hash = combineOrderedHash(hash, hashValue(value[index], childDepth));
		}
		return hash;
	}

	const constructor = (value as Object).constructor;

	if (constructor === Object) {
		let hash: number = TAG.OBJECT;
		for (const name in value) {
			hash = combineOrderedHash(
				combineOrderedHash(hash, stringHash(name)),
				hashValue(value[name as keyof typeof value], childDepth),
			);
		}
		return hash;
	}

	if (constructor === Map) {
		const map = value as Map<unknown, unknown>;
		let hash = combineOrderedHash(TAG.MAP, map.size);
		for (const key of map.keys()) {
			hash = combineOrderedHash(
				combineOrderedHash(hash, hashValue(key, childDepth)),
				hashValue(map.get(key), childDepth),
			);
		}
		return hash;
	}

	if (constructor === Set) {
		const set = value as Set<unknown>;
		let hash = combineOrderedHash(TAG.SET, set.size);
		for (const member of set) {
			hash = combineOrderedHash(hash, hashValue(member, childDepth));
		}
		return hash;
	}

	return referenceId(value as Object);
};
