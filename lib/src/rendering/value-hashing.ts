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

const HASH_DEPTH_LIMIT = 64;

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

//a template adds no level: nesting templates is written in source, and a cycle through one still
//passes a container that does
const hashTemplateValue = (value: TemplateValue, depth: number): number => {
	const values = value.values;
	let hash = values.length;
	for (let index = 0; index < values.length; index++) {
		hash = combineOrderedHash(hash, hashValue(values[index], depth));
	}
	return combineOrderedHash(
		getParsedTemplate(value.__templateStrings).templateHash,
		hash,
	);
};

//exact constructors: subclasses and null-prototype objects are hashed by reference
const isPlainObject = (value: {}): value is Record<string, unknown> =>
	value.constructor === Object;
const isExactlyMap = (value: {}): value is Map<unknown, unknown> =>
	value.constructor === Map;
const isExactlySet = (value: {}): value is Set<unknown> =>
	value.constructor === Set;

export const hashValue = (value: unknown, depth: number = 0): number => {
	if (value === null || value === undefined) return TAG.NULLISH;

	if (typeof value === "string")
		return combineOrderedHash(TAG.STRING, stringHash(value));
	if (typeof value === "number") return hashNumber(value);
	if (typeof value === "bigint")
		return combineOrderedHash(TAG.BIGINT, stringHash(String(value)));
	if (typeof value === "boolean")
		return combineOrderedHash(TAG.BOOLEAN, value ? 1 : 0);
	if (typeof value === "function") return referenceId(value);
	if (isTemplate(value)) return hashTemplateValue(value, depth);

	if (depth >= HASH_DEPTH_LIMIT) return TAG.TRUNCATED;
	const childDepth = depth + 1;

	if (Array.isArray(value)) {
		let hash = combineOrderedHash(TAG.ARRAY, value.length);
		for (let index = 0; index < value.length; index++) {
			hash = combineOrderedHash(hash, hashValue(value[index], childDepth));
		}
		return hash;
	}

	if (isPlainObject(value)) {
		let hash: number = TAG.OBJECT;
		for (const name in value) {
			hash = combineOrderedHash(
				combineOrderedHash(hash, stringHash(name)),
				hashValue(value[name], childDepth),
			);
		}
		return hash;
	}

	if (isExactlyMap(value)) {
		let hash = combineOrderedHash(TAG.MAP, value.size);
		for (const key of value.keys()) {
			hash = combineOrderedHash(
				combineOrderedHash(hash, hashValue(key, childDepth)),
				hashValue(value.get(key), childDepth),
			);
		}
		return hash;
	}

	if (isExactlySet(value)) {
		let hash = combineOrderedHash(TAG.SET, value.size);
		for (const member of value) {
			hash = combineOrderedHash(hash, hashValue(member, childDepth));
		}
		return hash;
	}

	//walking class instances, Date, typed arrays and null-prototype objects costs every render for
	//values that are rarely mutated in place; an in-place change to one of them is not noticed
	return referenceId(value);
};
