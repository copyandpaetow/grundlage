import { Part } from "../parser/types";
import { combineOrderedHash, PARTS_HASH_SEED } from "../utils/hashing";
import { hashValue } from "./value-hashing";

export const composeParts = (
	parts: ReadonlyArray<Part>,
	values: Array<unknown>,
): string => {
	let result = "";
	for (let index = 0; index < parts.length; index++) {
		const part = parts[index];
		if (typeof part !== "number") {
			result += part;
			continue;
		}
		const value = values[part];
		//booleans read as absent, as in a content hole, so `cond && "active"` by static text drops out
		const readsAsAbsent = value == null || typeof value === "boolean";
		if (!readsAsAbsent) result += String(value);
	}
	return result;
};

export const combinedPartsHash = (
	parts: ReadonlyArray<Part>,
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
