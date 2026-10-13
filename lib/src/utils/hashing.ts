//a multiplier smaller than the values it mixes lets digits trade places: with 31, "Aa" and "BB"
//hash alike (`31*65 + 97` = `31*66 + 66`) and the gate reports unchanged for a changed value
export const HASH_MULTIPLIER = 0x9e3779b1 | 0;

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

export const stringHash = (text: string): number => {
	const length = text.length;
	let hash = 0;
	let index = 0;
	for (const blockEnd = length - 3; index < blockEnd; index += 4) {
		hash =
			(Math.imul(hash, HASH_MULTIPLIER_FOURTH) +
				Math.imul(text.charCodeAt(index), HASH_MULTIPLIER_CUBED) +
				Math.imul(text.charCodeAt(index + 1), HASH_MULTIPLIER_SQUARED) +
				Math.imul(text.charCodeAt(index + 2), HASH_MULTIPLIER) +
				text.charCodeAt(index + 3)) |
			0;
	}
	for (; index < length; index++) {
		hash = combineOrderedHash(hash, text.charCodeAt(index));
	}
	return hash;
};

export const stringListHash = (strings: ReadonlyArray<string>): number => {
	let hash = strings.length;
	for (let index = 0; index < strings.length; index++)
		hash = combineOrderedHash(hash, stringHash(strings[index]));
	return hash;
};
