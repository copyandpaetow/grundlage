import { hashTemplate, isTemplate } from "../rendering/template-html";

export const stringHash = (str: string): number => {
	let hash = 0;
	for (let index = 0; index < str.length; index++) {
		hash = (Math.imul(hash, 31) + str.charCodeAt(index)) | 0;
	}
	return hash;
};

//content hash for change detection: equal content hashes equal even across fresh references, so a slot whose value was mutated in place is still seen as changed
//a type tag is mixed into every branch so distinct kinds occupy distinct value spaces (0 vs false, [1,2] vs {0:1,1:2}, a reference id vs a raw int never collide)
//Map and Set are walked for content; functions and other objects hash by reference identity; a depth cap truncates rather than recurses forever on cyclic data
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
	if (numberValue === (numberValue | 0)) return mix(TAG_NUMBER, numberValue | 0);
	//equal floats share bit patterns, so reinterpreting the 64 bits as two int32s hashes equal numbers equally without stringifying
	floatView[0] = numberValue;
	return mix(TAG_NUMBER, mix(floatIntView[0], floatIntView[1]));
};

//property names repeat every frame across a uniform list, so interning their hashes trades a char walk for a map lookup; the key vocabulary is small and bounded
const keyHashes = new Map<string, number>();
const hashKey = (name: string): number => {
	let cached = keyHashes.get(name);
	if (cached === undefined) {
		cached = stringHash(name);
		keyHashes.set(name, cached);
	}
	return cached;
};

//functions and opaque objects hide state we can't cheaply read, so we hash them by reference identity: a fresh object gets a unique counter id kept in a WeakMap, and the same reference reports as unchanged
//the trade-off is that an inline `() => ...` is a fresh function each render, so its hash always differs and the listener gets reapplied
const references = new WeakMap<Object, number>();
let counter = 0;

const referenceId = (value: Object): number => {
	let id = references.get(value);
	if (id === undefined) {
		counter++;
		//spread ids out of the dense low-int range so a reference id can't land on a small raw integer's hash
		id = Math.imul(counter, 0x9e3779b1) | 0;
		references.set(value, id);
	}
	return mix(TAG_REFERENCE, id);
};

//hashes a child without paying a recursive call for the common primitive leaves; hashValue is self-recursive and V8 does not inline self-recursion, so a leaf int or string otherwise costs a full call frame
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
	if (isTemplate(value)) return hashTemplate(value);

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
		//keys() + get() avoids the fresh [key, value] pair that for-of destructuring allocates per entry
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
