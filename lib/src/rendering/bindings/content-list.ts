import { ParsedTemplate } from "../../parser/types";
import { coerceToTemplate, TemplateValue } from "../../template";
import { combineOrderedHash, LIST_HASH_SEED } from "../../utils/hashing";
import { hashValue } from "../value-hashing";
import { combinedPartsHash } from "../compose";
import { MARKUP } from "../../parser/chars";
import { NO_KEY } from "../../parser/constants";
import {
	HYDRATION_MISMATCH,
	resolveNestedTemplate,
	hydrateInstance,
	isPatchableInPlace,
	cloneTemplateFragment,
	mountInstance,
	patchInstance,
	refreshStyleSheetsAfterMove,
} from "../instance";
import { clearRange, NO_LIST_TAIL, nextListTail } from "../markers";
import {
	StyleSheetMoveState,
	ContentLiveBinding,
	ListContentState,
	ListItem,
} from "./types";
import { assertDuringDevelopment } from "../../utils/diagnostics";

const END_OF_CHAIN = -1;
//a claimed row has left its chain, so its link entry is free to say so
const CLAIMED = -2;
const UNUSED_TABLE_ENTRY = -3;
//the table index is taken from the high bits: combineOrderedHash is imul plus add, whose low bits
//depend only on the low bits of its inputs
const FIBONACCI_MULTIPLIER = 0x9e3779b1 | 0;
const END_OF_SUBSEQUENCE = -1;

//one instance for every list: at length zero nothing can be written into it, and each pass regrows
//it before its first write
export const EMPTY_LIST_SCRATCH = new Int32Array(0);

const shapeOrKeyHashOf = (
	value: TemplateValue,
	parsed: ParsedTemplate,
): number =>
	parsed.keyValueParts === NO_KEY
		? parsed.templateHash
		: combinedPartsHash(parsed.keyValueParts, value.values);

export const patchListContent = (
	liveBinding: ContentLiveBinding,
	list: ListContentState,
	itemValues: Array<unknown>,
	moveState: StyleSheetMoveState,
): void => {
	const count = itemValues.length;
	if (list.itemHashes.length < count) list.itemHashes = new Array(count);
	const itemHashes = list.itemHashes;
	let aggregateHash = LIST_HASH_SEED;
	for (let index = 0; index < count; index++) {
		const itemHash = hashValue(itemValues[index]);
		itemHashes[index] = itemHash;
		aggregateHash = combineOrderedHash(aggregateHash, itemHash);
	}
	if (aggregateHash === list.lastValueHash) return;
	list.lastValueHash = aggregateHash;
	const previousRows = list.items;
	const resolvedRows = list.spareRows;
	resolvedRows.length = count;

	//a row still equal at its own index keeps it: claiming is leftmost-first, so a changed index would
	//take the furthest match and drag its focus, scroll and input state across the list
	let firstUnsettledIndex = 0;
	let endOfUnsettledIndexes = count;
	let endOfUnsettledPreviousRows = previousRows.length;
	while (
		firstUnsettledIndex < endOfUnsettledIndexes &&
		firstUnsettledIndex < endOfUnsettledPreviousRows &&
		previousRows[firstUnsettledIndex].itemHash ===
			itemHashes[firstUnsettledIndex]
	) {
		resolvedRows[firstUnsettledIndex] = previousRows[firstUnsettledIndex];
		firstUnsettledIndex++;
	}
	while (
		endOfUnsettledIndexes > firstUnsettledIndex &&
		endOfUnsettledPreviousRows > firstUnsettledIndex &&
		previousRows[endOfUnsettledPreviousRows - 1].itemHash ===
			itemHashes[endOfUnsettledIndexes - 1]
	) {
		endOfUnsettledIndexes--;
		endOfUnsettledPreviousRows--;
		resolvedRows[endOfUnsettledIndexes] =
			previousRows[endOfUnsettledPreviousRows];
	}
	if (endOfUnsettledPreviousRows > firstUnsettledIndex) {
		matchUnsettledRows(
			list,
			itemValues,
			firstUnsettledIndex,
			endOfUnsettledIndexes,
			endOfUnsettledPreviousRows,
		);
		removeUnclaimedRows(list, firstUnsettledIndex, endOfUnsettledPreviousRows);
	}

	placeRows(list, liveBinding.openMarker, resolvedRows, itemValues, moveState);
	//placeRows mounted a row into every index the match left empty
	list.items = resolvedRows as Array<ListItem>;
	//emptied so the removed rows, and their detached DOM, are not kept alive until the next patch
	const spareRows: Array<ListItem | undefined> = previousRows;
	spareRows.fill(undefined);
	list.spareRows = spareRows;
};

const emptyRowHashTable = (list: ListContentState): void => {
	const capacity = 1 << (32 - list.tableIndexShift);
	list.chainHeadAtTableIndex.fill(UNUSED_TABLE_ENTRY, 0, capacity);
};

//an exhausted chain keeps its entry as END_OF_CHAIN: probing stops at the first unused entry, so
//freeing one would hide every hash that probed past it
const tableIndexOfHash = (list: ListContentState, hash: number): number => {
	const { hashAtTableIndex, chainHeadAtTableIndex, tableIndexShift } = list;
	const lastTableIndex = (1 << (32 - tableIndexShift)) - 1;
	let tableIndex = Math.imul(hash, FIBONACCI_MULTIPLIER) >>> tableIndexShift;
	while (
		chainHeadAtTableIndex[tableIndex] !== UNUSED_TABLE_ENTRY &&
		hashAtTableIndex[tableIndex] !== hash
	)
		tableIndex = (tableIndex + 1) & lastTableIndex;
	return tableIndex;
};

//called from the last row back, so each chain starts at its leftmost row
const chainRowByHash = (
	list: ListContentState,
	previousIndex: number,
	hash: number,
): void => {
	const tableIndex = tableIndexOfHash(list, hash);
	const currentHead = list.chainHeadAtTableIndex[tableIndex];
	list.nextRowWithSameHash[previousIndex] =
		currentHead === UNUSED_TABLE_ENTRY ? END_OF_CHAIN : currentHead;
	list.hashAtTableIndex[tableIndex] = hash;
	list.chainHeadAtTableIndex[tableIndex] = previousIndex;
};

const chainRowsByContentHash = (
	list: ListContentState,
	start: number,
	end: number,
): void => {
	emptyRowHashTable(list);
	for (let previousIndex = end - 1; previousIndex >= start; previousIndex--)
		chainRowByHash(list, previousIndex, list.items[previousIndex].itemHash);
};

const chainUnclaimedRowsByShapeOrKey = (
	list: ListContentState,
	start: number,
	end: number,
): void => {
	emptyRowHashTable(list);
	for (let previousIndex = end - 1; previousIndex >= start; previousIndex--) {
		if (list.nextRowWithSameHash[previousIndex] === CLAIMED) continue;
		chainRowByHash(
			list,
			previousIndex,
			list.items[previousIndex].shapeOrKeyHash,
		);
	}
};

const claimLeftmostUnclaimedRow = (
	list: ListContentState,
	hash: number,
): ListItem | undefined => {
	const tableIndex = tableIndexOfHash(list, hash);
	const head = list.chainHeadAtTableIndex[tableIndex];
	const hasNoUnclaimedRow =
		head === UNUSED_TABLE_ENTRY || head === END_OF_CHAIN;
	if (hasNoUnclaimedRow) return undefined;
	list.chainHeadAtTableIndex[tableIndex] = list.nextRowWithSameHash[head];
	list.nextRowWithSameHash[head] = CLAIMED;
	return list.items[head];
};

const removeUnclaimedRows = (
	list: ListContentState,
	start: number,
	end: number,
): void => {
	for (let previousIndex = start; previousIndex < end; previousIndex++) {
		if (list.nextRowWithSameHash[previousIndex] === CLAIMED) continue;
		const row = list.items[previousIndex];
		clearRange(row.startNode, row.tailMarker);
		row.tailMarker.remove();
	}
};

//fills the unsettled indexes of the spare rows with previous rows, first by equal content and then
//by equal shape or key; an index left empty gets a new row
const matchUnsettledRows = (
	list: ListContentState,
	itemValues: Array<unknown>,
	start: number,
	endOfIndexes: number,
	endOfPreviousRows: number,
): void => {
	const { itemHashes, spareRows: resolvedRows } = list;
	const unsettledPreviousRowCount = endOfPreviousRows - start;

	//at most half full, so a probe always reaches an unused entry
	const indexBitCount = 32 - Math.clz32(unsettledPreviousRowCount * 2 - 1);
	const tableCapacity = 1 << indexBitCount;
	if (list.chainHeadAtTableIndex.length < tableCapacity) {
		list.hashAtTableIndex = new Int32Array(tableCapacity);
		list.chainHeadAtTableIndex = new Int32Array(tableCapacity);
	}
	list.tableIndexShift = 32 - indexBitCount;
	if (list.nextRowWithSameHash.length < list.items.length)
		list.nextRowWithSameHash = new Int32Array(list.items.length);

	chainRowsByContentHash(list, start, endOfPreviousRows);
	let claimedRowCount = 0;
	for (let index = start; index < endOfIndexes; index++) {
		const row = claimLeftmostUnclaimedRow(list, itemHashes[index]);
		if (row === undefined) continue;
		resolvedRows[index] = row;
		claimedRowCount++;
	}
	if (claimedRowCount === unsettledPreviousRowCount) return;

	chainUnclaimedRowsByShapeOrKey(list, start, endOfPreviousRows);
	for (let index = start; index < endOfIndexes; index++) {
		if (resolvedRows[index] !== undefined) continue;
		const value = coerceToTemplate(itemValues[index]);
		const row = claimLeftmostUnclaimedRow(
			list,
			shapeOrKeyHashOf(value, resolveNestedTemplate(value)),
		);
		if (row !== undefined) resolvedRows[index] = row;
	}
};

//starts fall as the length grows, so the lengths a row can precede are a prefix of them
const longestSubsequenceItCanPrecede = (
	subsequenceStarts: Int32Array,
	longestLength: number,
	previousIndex: number,
): number => {
	let low = 0;
	let high = longestLength;
	while (low < high) {
		const middle = (low + high) >> 1;
		if (subsequenceStarts[middle] > previousIndex) low = middle + 1;
		else high = middle;
	}
	return low;
};

//rows on the longest increasing subsequence stay put, so moving only the others is the fewest
//moves possible. Scanning from the last row back makes every link point forward, as placeRows walks
const findLongestIncreasingSubsequence = (
	list: ListContentState,
	resolvedRows: Array<ListItem | undefined>,
): number => {
	const { subsequenceStarts, nextInSubsequence } = list;
	let longestLength = 0;
	for (let index = resolvedRows.length - 1; index >= 0; index--) {
		const row = resolvedRows[index];
		if (row === undefined) continue;
		const previousIndex = row.placedAtIndex;
		const precededLength = longestSubsequenceItCanPrecede(
			subsequenceStarts,
			longestLength,
			previousIndex,
		);
		nextInSubsequence[previousIndex] =
			precededLength === 0
				? END_OF_SUBSEQUENCE
				: subsequenceStarts[precededLength - 1];
		subsequenceStarts[precededLength] = previousIndex;
		if (precededLength === longestLength) longestLength++;
	}
	return longestLength === 0
		? END_OF_SUBSEQUENCE
		: subsequenceStarts[longestLength - 1];
};

const placeRows = (
	list: ListContentState,
	openMarker: Comment,
	resolvedRows: Array<ListItem | undefined>,
	itemValues: Array<unknown>,
	moveState: StyleSheetMoveState,
): void => {
	//still the previous rows: patchListContent replaces them once this has placed the new ones
	const previousRowCount = list.items.length;
	if (list.nextInSubsequence.length < previousRowCount) {
		list.subsequenceStarts = new Int32Array(previousRowCount);
		list.nextInSubsequence = new Int32Array(previousRowCount);
	}
	let nextUnmovedPreviousIndex = findLongestIncreasingSubsequence(
		list,
		resolvedRows,
	);
	const { itemHashes, nextInSubsequence } = list;
	let cursor: ChildNode = openMarker;
	for (let index = 0; index < resolvedRows.length; index++) {
		let row = resolvedRows[index];
		if (row === undefined)
			row = mountRowAfter(
				cursor,
				index,
				itemValues[index],
				itemHashes[index],
				moveState,
			);
		else {
			//every other row the match found was already equal in content
			if (row.itemHash !== itemHashes[index]) {
				const value = coerceToTemplate(itemValues[index]);
				const parsed = resolveNestedTemplate(value);
				row.itemHash = itemHashes[index];
				if (isPatchableInPlace(row.instance, parsed))
					patchInstance(row.instance, value.values);
				else {
					const fragment = cloneTemplateFragment(parsed);
					const instance = mountInstance(fragment, value, parsed, moveState);
					clearRange(row.startNode, row.tailMarker);
					row.startNode = fragment.firstChild ?? row.tailMarker;
					row.tailMarker.before(fragment);
					row.instance = instance;
				}
			}
			if (row.placedAtIndex === nextUnmovedPreviousIndex)
				nextUnmovedPreviousIndex = nextInSubsequence[nextUnmovedPreviousIndex];
			else {
				moveRowAfter(cursor, row);
				refreshStyleSheetsAfterMove(row.instance);
			}
		}
		row.placedAtIndex = index;
		cursor = row.tailMarker;
		resolvedRows[index] = row;
	}
};

const mountRowAfter = (
	after: ChildNode,
	placedAtIndex: number,
	rawValue: unknown,
	itemHash: number,
	moveState: StyleSheetMoveState,
): ListItem => {
	const value = coerceToTemplate(rawValue);
	const parsed = resolveNestedTemplate(value);
	const fragment = cloneTemplateFragment(parsed);
	const instance = mountInstance(fragment, value, parsed, moveState);
	const tailMarker = document.createComment(MARKUP.LIST_MARKER_DATA);
	const startNode = fragment.firstChild ?? tailMarker;
	after.after(fragment, tailMarker);
	return {
		tailMarker,
		instance,
		itemHash,
		shapeOrKeyHash: shapeOrKeyHashOf(value, parsed),
		startNode,
		placedAtIndex,
	};
};

const moveRowAfter = (after: ChildNode, row: ListItem): void => {
	let anchor = after;
	let current: ChildNode | null = row.startNode;
	while (current && current !== row.tailMarker) {
		const next: ChildNode | null = current.nextSibling;
		anchor.after(current);
		anchor = current;
		current = next;
	}
	anchor.after(row.tailMarker);
};

export const aggregateHashOfItems = (items: Array<ListItem>): number => {
	let aggregateHash = LIST_HASH_SEED;
	for (let index = 0; index < items.length; index++)
		aggregateHash = combineOrderedHash(aggregateHash, items[index].itemHash);
	return aggregateHash;
};

export const hydrateListItems = (
	liveBinding: ContentLiveBinding,
	itemValues: Array<unknown>,
	moveState: StyleSheetMoveState,
	walker: TreeWalker,
): Array<ListItem> | typeof HYDRATION_MISMATCH => {
	const count = itemValues.length;
	const items: Array<ListItem> = new Array(count);
	for (let index = 0; index < count; index++) {
		const value = coerceToTemplate(itemValues[index]);
		const parsed = resolveNestedTemplate(value);
		const startNode = walker.currentNode.nextSibling;
		assertDuringDevelopment(
			startNode !== null,
			"a list row starts before the list's close marker",
		);
		const instance = hydrateInstance(
			walker,
			value,
			parsed,
			liveBinding.closeMarker,
			moveState,
		);
		if (instance === HYDRATION_MISMATCH) return HYDRATION_MISMATCH;
		const tailMarker = nextListTail(walker, liveBinding.closeMarker);
		if (tailMarker === NO_LIST_TAIL) return HYDRATION_MISMATCH;
		items[index] = {
			tailMarker,
			instance,
			itemHash: hashValue(itemValues[index]),
			shapeOrKeyHash: shapeOrKeyHashOf(value, parsed),
			startNode,
			placedAtIndex: index,
		};
	}

	if (walker.currentNode.nextSibling !== liveBinding.closeMarker)
		return HYDRATION_MISMATCH;
	return items;
};
