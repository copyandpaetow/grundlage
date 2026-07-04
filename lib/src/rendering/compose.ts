import { Part } from "../parser/types";
import { hashValue } from "../utils/hashing";
import { combineOrderedHash, PARTS_HASH_SEED } from "./constants";

export const composeParts = (
	parts: Array<Part>,
	values: Array<unknown>,
): string => {
	let result = "";
	for (let index = 0; index < parts.length; index++) {
		const part = parts[index];
		result += typeof part === "number" ? String(values[part]) : part;
	}
	return result;
};

export const combinedPartsHash = (
	parts: Array<Part>,
	values: Array<unknown>,
): number => {
	let hash = PARTS_HASH_SEED;
	for (let index = 0; index < parts.length; index++) {
		const part = parts[index];
		if (typeof part !== "number") continue;
		hash = combineOrderedHash(hash, hashValue(values[part]));
	}
	return hash;
};

export const hasValueChanged = (
	liveBinding: { lastValueHash: number },
	value: unknown,
): boolean => {
	const valueHash = hashValue(value);
	if (valueHash === liveBinding.lastValueHash) return false;
	liveBinding.lastValueHash = valueHash;
	return true;
};
