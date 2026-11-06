//a hash is a whole number below 2^53, exact in a double, so `===` compares it. 32 bits are too few:
//matching a 10,000-row list against the rows it replaces would falsely match in about 2% of replaces
const FIRST_LANE_MULTIPLIER = 0x9e3779b1 | 0;
const SECOND_LANE_MULTIPLIER = 0x5f356495 | 0;
const ACCUMULATOR_MULTIPLIER = 0x85ebca77 | 0;
const LOW_WORD_SIZE = 2 ** 32;
const HIGH_WORD_MASK = 2 ** 21 - 1;

export const FIRST_LANE_SEED = 0xdeadbeef | 0;
export const SECOND_LANE_SEED = 0x41c6ce57 | 0;
export const PARTS_HASH_SEED = 0x811c9dc5 | 0;
export const LIST_HASH_SEED = 0x27d4eb2f | 0;

export const lowWordOf = (hash: number): number => hash | 0;
export const highWordOf = (hash: number): number => (hash / LOW_WORD_SIZE) | 0;

//each step is a bijection, so sequences that differ in one word never reach the same lanes. A multiply
//carries a difference only upward; the fold brings high bits down, where the next multiply spreads them
export const mixWordIntoLanes = (lanes: Int32Array, word: number): void => {
	const firstProduct = Math.imul(lanes[0] ^ word, FIRST_LANE_MULTIPLIER);
	const secondProduct = Math.imul(lanes[1] ^ word, SECOND_LANE_MULTIPLIER);
	lanes[0] = firstProduct ^ (firstProduct >>> 16);
	lanes[1] = secondProduct ^ (secondProduct >>> 16);
};

//two UTF-16 code units per step halve the multiplies. Each step is written out: through a shared
//helper, a 10k-object walk took 40 % longer in Firefox
export const mixTextIntoLanes = (
	lanes: Int32Array,
	lengthWord: number,
	text: string,
): void => {
	let firstLane = Math.imul(lanes[0] ^ lengthWord, FIRST_LANE_MULTIPLIER);
	firstLane ^= firstLane >>> 16;
	let secondLane = Math.imul(lanes[1] ^ lengthWord, SECOND_LANE_MULTIPLIER);
	secondLane ^= secondLane >>> 16;
	let index = 0;
	for (
		const lastPairStart = text.length - 1;
		index < lastPairStart;
		index += 2
	) {
		const word = text.charCodeAt(index) | (text.charCodeAt(index + 1) << 16);
		firstLane = Math.imul(firstLane ^ word, FIRST_LANE_MULTIPLIER);
		firstLane ^= firstLane >>> 16;
		secondLane = Math.imul(secondLane ^ word, SECOND_LANE_MULTIPLIER);
		secondLane ^= secondLane >>> 16;
	}
	if (index < text.length) {
		const word = text.charCodeAt(index);
		firstLane = Math.imul(firstLane ^ word, FIRST_LANE_MULTIPLIER);
		firstLane ^= firstLane >>> 16;
		secondLane = Math.imul(secondLane ^ word, SECOND_LANE_MULTIPLIER);
		secondLane ^= secondLane >>> 16;
	}
	lanes[0] = firstLane;
	lanes[1] = secondLane;
};

//every step is a bijection and every word reaches the top bits of both lanes, so the whole first lane
//and the top 21 bits of the second already tell two sequences apart
export const hashOfLanes = (firstLane: number, secondLane: number): number =>
	(secondLane >>> 11) * LOW_WORD_SIZE + (firstLane >>> 0);

//each lane xors the value in before a multiply, and the low lane multiplies the accumulator first:
//either argument alone changes the result, order counts, and a nested value cannot cancel out
export const combineOrderedHash = (
	accumulator: number,
	valueHash: number,
): number => {
	const lowWord = Math.imul(
		Math.imul(accumulator, ACCUMULATOR_MULTIPLIER) ^ valueHash,
		FIRST_LANE_MULTIPLIER,
	);
	const highWord =
		Math.imul(
			highWordOf(accumulator) ^ highWordOf(valueHash),
			SECOND_LANE_MULTIPLIER,
		) & HIGH_WORD_MASK;
	return highWord * LOW_WORD_SIZE + (lowWord >>> 0);
};

//its own lanes: a template parsed during a value walk hashes its strings without touching the walk's
const textLanes = new Int32Array(2);

export const stringHash = (text: string): number => {
	textLanes[0] = FIRST_LANE_SEED;
	textLanes[1] = SECOND_LANE_SEED;
	mixTextIntoLanes(textLanes, text.length, text);
	return hashOfLanes(textLanes[0], textLanes[1]);
};

export const stringListHash = (strings: ReadonlyArray<string>): number => {
	let hash = strings.length;
	for (let index = 0; index < strings.length; index++)
		hash = combineOrderedHash(hash, stringHash(strings[index]));
	return hash;
};
