import { Part } from "../parser/types";
import {
	combineOrderedHash,
	hashValue,
	PARTS_HASH_SEED,
} from "../utils/hashing";

const stringifyPart = (value: unknown): string =>
	value == null ? "" : String(value);

export const composeParts = (
	parts: Array<Part>,
	values: Array<unknown>,
): string => {
	let result = "";
	for (let index = 0; index < parts.length; index++) {
		const part = parts[index];
		result += typeof part === "number" ? stringifyPart(values[part]) : part;
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

export const claimHashChange = (
	gate: { lastValueHash: number },
	hash: number,
): boolean => {
	if (hash === gate.lastValueHash) return false;
	gate.lastValueHash = hash;
	return true;
};
