export const UNSET_HASH = Number.NaN;

export const PARTS_HASH_SEED = 0x811c9dc5 | 0;
export const LIST_HASH_SEED = 0x27d4eb2f | 0;

export const CONTENT_KIND = {
	UNRESOLVED: 0,
	TEXT: 1,
	BRANCH: 2,
	LIST: 3,
} as const;

export const ATTR_MODE = { ABSENT: 0, ATTRIBUTE: 1, PROPERTY: 2 } as const;

export const NO_KEY_BINDING = -1;
export const NO_KEY = 0;

export const LIST_MARKER_DATA = "*.*";

export const combineOrderedHash = (
	accumulator: number,
	valueHash: number,
): number => (Math.imul(accumulator, 31) + valueHash) | 0;
