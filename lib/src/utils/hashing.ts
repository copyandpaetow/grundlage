import { getParsedTemplate } from "../parser/html";
import { isTemplate, TemplateValue } from "../template";

//a multiplier smaller than the values it mixes lets two digits trade places: with 31,
//`31*65 + 97` and `31*66 + 66` are the same number, so "Aa" and "BB" hash alike and the
//gate reports unchanged for a value that changed
const HASH_MULTIPLIER = 0x9e3779b1 | 0;

export const combineOrderedHash = (
	accumulator: number,
	valueHash: number,
): number => (Math.imul(accumulator, HASH_MULTIPLIER) + valueHash) | 0;

export const PARTS_HASH_SEED = 0x811c9dc5 | 0;
export const LIST_HASH_SEED = 0x27d4eb2f | 0;

//h*m^4 folded into one multiply so four characters cost one link of the dependency
//chain instead of four; the result is bit-identical to the character-at-a-time form
const HASH_MULTIPLIER_SQUARED = Math.imul(HASH_MULTIPLIER, HASH_MULTIPLIER) | 0;
const HASH_MULTIPLIER_CUBED =
	Math.imul(HASH_MULTIPLIER_SQUARED, HASH_MULTIPLIER) | 0;
const HASH_MULTIPLIER_FOURTH =
	Math.imul(HASH_MULTIPLIER_CUBED, HASH_MULTIPLIER) | 0;

export const stringHash = (str: string): number => {
	const length = str.length;
	let hash = 0;
	let index = 0;
	for (const blockEnd = length - 3; index < blockEnd; index += 4) {
		hash =
			(Math.imul(hash, HASH_MULTIPLIER_FOURTH) +
				Math.imul(str.charCodeAt(index), HASH_MULTIPLIER_CUBED) +
				Math.imul(str.charCodeAt(index + 1), HASH_MULTIPLIER_SQUARED) +
				Math.imul(str.charCodeAt(index + 2), HASH_MULTIPLIER) +
				str.charCodeAt(index + 3)) |
			0;
	}
	for (; index < length; index++) {
		hash = combineOrderedHash(hash, str.charCodeAt(index));
	}
	return hash;
};

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
				combineOrderedHash(hash, hashKey(name)),
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
