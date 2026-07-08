import { getParsedTemplate } from "../parser/html";
import { isTemplate, TemplateValue } from "../template";

export const stringHash = (str: string): number => {
	let hash = 0;
	for (let index = 0; index < str.length; index++) {
		hash = (Math.imul(hash, 31) + str.charCodeAt(index)) | 0;
	}
	return hash;
};

const TAG_NULLISH = 1;
const TAG_STRING = 2;
const TAG_NUMBER = 3;
const TAG_BOOLEAN = 4;
const TAG_ARRAY = 5;
const TAG_OBJECT = 6;
const TAG_MAP = 7;
const TAG_SET = 8;
const TAG_REFERENCE = 9;
const TAG_TRUNCATED = 10;

const MAX_DEPTH = 64;

const mix = (hash: number, value: number): number =>
	((hash << 5) - hash + value) | 0;

const floatView = new Float64Array(1);
const floatIntView = new Int32Array(floatView.buffer);

const hashNumber = (numberValue: number): number => {
	if (numberValue === (numberValue | 0))
		return mix(TAG_NUMBER, numberValue | 0);
	floatView[0] = numberValue;
	return mix(TAG_NUMBER, mix(floatIntView[0], floatIntView[1]));
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

const references = new WeakMap<Object, number>();
let counter = 0;

const referenceId = (value: Object): number => {
	let id = references.get(value);
	if (id === undefined) {
		counter++;
		id = Math.imul(counter, 0x9e3779b1) | 0;
		references.set(value, id);
	}
	return mix(TAG_REFERENCE, id);
};

const hashTemplateValue = (value: TemplateValue): number => {
	const values = value.values;
	let hash = values.length;
	for (let index = 0; index < values.length; index++) {
		hash = (Math.imul(hash, 31) + hashValue(values[index])) | 0;
	}
	return getParsedTemplate(value.__templateStrings).templateHash ^ Math.imul(hash, 31);
};

const hashChild = (child: unknown, depth: number): number => {
	const type = typeof child;
	if (type === "string") return mix(TAG_STRING, stringHash(child as string));
	if (type === "number") return hashNumber(child as number);
	return hashValue(child, depth);
};

export const hashValue = (value: unknown, depth: number = 0): number => {
	if (value === null || value === undefined) return TAG_NULLISH;

	const type = typeof value;
	if (type === "string") return mix(TAG_STRING, stringHash(value as string));
	if (type === "number") return hashNumber(value as number);
	if (type === "boolean") return mix(TAG_BOOLEAN, value ? 1 : 0);
	if (type === "function") return referenceId(value as Object);
	if (isTemplate(value)) return hashTemplateValue(value);

	if (depth >= MAX_DEPTH) return TAG_TRUNCATED;
	const childDepth = depth + 1;

	if (Array.isArray(value)) {
		let hash = mix(TAG_ARRAY, value.length);
		for (let index = 0; index < value.length; index++) {
			hash = mix(hash, hashChild(value[index], childDepth));
		}
		return hash;
	}

	const constructor = (value as Object).constructor;

	if (constructor === Object) {
		let hash = TAG_OBJECT;
		for (const name in value) {
			hash = mix(
				mix(hash, hashKey(name)),
				hashChild(value[name as keyof typeof value], childDepth),
			);
		}
		return hash;
	}

	if (constructor === Map) {
		const map = value as Map<unknown, unknown>;
		let hash = mix(TAG_MAP, map.size);
		for (const key of map.keys()) {
			hash = mix(
				mix(hash, hashChild(key, childDepth)),
				hashChild(map.get(key), childDepth),
			);
		}
		return hash;
	}

	if (constructor === Set) {
		const set = value as Set<unknown>;
		let hash = mix(TAG_SET, set.size);
		for (const member of set) {
			hash = mix(hash, hashChild(member, childDepth));
		}
		return hash;
	}

	return referenceId(value as Object);
};
