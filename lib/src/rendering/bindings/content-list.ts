import { ParsedTemplate } from "../../parser/types";
import { coerceToTemplate, TemplateValue } from "../../template";
import { combineOrderedHash, LIST_HASH_SEED } from "../../utils/hashing";
import { hashValue } from "../value-hashing";
import { claimHashChange, combinedPartsHash } from "../compose";
import { MARKUP } from "../../parser/chars";
import {
	resolveNestedTemplate,
	hydrateInstance,
	isPatchableInPlace,
	mountInstance,
	patchInstance,
	refreshStyleSheetsAfterMove,
} from "../instance";
import { clearRange, nextListTail } from "../markers";
import {
	StyleSheetMoveState,
	ContentLiveBinding,
	Instance,
	ListContentState,
	ListItem,
} from "./types";

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
	parsed.keyValueParts === null
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
	if (!claimHashChange(list, aggregateHash)) return;
	const previousRows: Array<ListItem | undefined> = list.items;
	list.items = placeRows(
		list,
		liveBinding.openMarker,
		matchRowsToPreviousRows(list, itemValues),
		itemValues,
		moveState,
	);
	//emptied so the removed rows, and their detached DOM, are not kept alive until the next patch
	previousRows.fill(undefined);
	list.spareRows = previousRows;
};

//at most half full, so a probe always reaches an unused entry
const emptyRowHashTableForRows = (
	list: ListContentState,
	rowCount: number,
): void => {
	const indexBitCount = 32 - Math.clz32(rowCount * 2 - 1);
	const capacity = 1 << indexBitCount;
	if (list.chainHeadAtTableIndex.length < capacity) {
		list.hashAtTableIndex = new Int32Array(capacity);
		list.chainHeadAtTableIndex = new Int32Array(capacity);
	}
	list.tableIndexShift = 32 - indexBitCount;
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
	if (list.nextRowWithSameHash.length < list.items.length)
		list.nextRowWithSameHash = new Int32Array(list.items.length);
	emptyRowHashTableForRows(list, end - start);
	for (let previousIndex = end - 1; previousIndex >= start; previousIndex--)
		chainRowByHash(list, previousIndex, list.items[previousIndex].itemHash);
};

const chainUnclaimedRowsByShapeOrKey = (
	list: ListContentState,
	start: number,
	end: number,
): void => {
	emptyRowHashTableForRows(list, end - start);
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
	if (head === UNUSED_TABLE_ENTRY || head === END_OF_CHAIN) return undefined;
	list.chainHeadAtTableIndex[tableIndex] = list.nextRowWithSameHash[head];
	list.nextRowWithSameHash[head] = CLAIMED;
	return list.items[head];
};

const removeUnclaimedRows = (
	list: ListContentState,
	start: number,
	end: number,
): void => {
	for (let previousIndex = start; previousIndex < end; previousIndex++)
		if (list.nextRowWithSameHash[previousIndex] !== CLAIMED)
			removeRowNodes(list.items[previousIndex]);
};

const matchRowsToPreviousRows = (
	list: ListContentState,
	itemValues: Array<unknown>,
): Array<ListItem | undefined> => {
	const { items: previousRows, itemHashes } = list;
	const resolvedRows = list.spareRows;
	resolvedRows.length = itemValues.length;

	//a row whose content still hashes the same at its own index keeps that index: claiming is
	//leftmost-first, so without this the changed index takes the furthest matching row and drags
	//its focus, scroll and input state across the list
	let firstUnsettledIndex = 0;
	let endOfUnsettledIndexes = itemValues.length;
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

	const unsettledPreviousRowCount =
		endOfUnsettledPreviousRows - firstUnsettledIndex;
	if (unsettledPreviousRowCount === 0) return resolvedRows;

	chainRowsByContentHash(list, firstUnsettledIndex, endOfUnsettledPreviousRows);
	let claimedRowCount = 0;
	for (
		let index = firstUnsettledIndex;
		index < endOfUnsettledIndexes;
		index++
	) {
		const row = claimLeftmostUnclaimedRow(list, itemHashes[index]);
		if (row === undefined) continue;
		resolvedRows[index] = row;
		claimedRowCount++;
	}
	if (claimedRowCount === unsettledPreviousRowCount) return resolvedRows;

	chainUnclaimedRowsByShapeOrKey(
		list,
		firstUnsettledIndex,
		endOfUnsettledPreviousRows,
	);
	for (
		let index = firstUnsettledIndex;
		index < endOfUnsettledIndexes;
		index++
	) {
		if (resolvedRows[index] !== undefined) continue;
		const value = coerceToTemplate(itemValues[index]);
		const parsed = resolveNestedTemplate(value);
		const row = claimLeftmostUnclaimedRow(
			list,
			shapeOrKeyHashOf(value, parsed),
		);
		if (row === undefined) continue;
		patchRowInPlace(row, value, parsed, itemHashes[index]);
		resolvedRows[index] = row;
	}

	removeUnclaimedRows(list, firstUnsettledIndex, endOfUnsettledPreviousRows);
	return resolvedRows;
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
	//still the previous rows: patchListContent replaces them with what placeRows returns
	const previousRowCount = list.items.length;
	if (list.nextInSubsequence.length < previousRowCount) {
		list.subsequenceStarts = new Int32Array(previousRowCount);
		list.nextInSubsequence = new Int32Array(previousRowCount);
	}
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
): Array<ListItem> => {
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
		else if (row.placedAtIndex === nextUnmovedPreviousIndex)
			nextUnmovedPreviousIndex = nextInSubsequence[nextUnmovedPreviousIndex];
		else {
			moveRowAfter(cursor, row);
			refreshStyleSheetsAfterMove(row.instance);
		}
		row.placedAtIndex = index;
		cursor = row.tailMarker;
		resolvedRows[index] = row;
	}
	return resolvedRows as Array<ListItem>;
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
	const { instance, fragment } = mountInstance(value, parsed, moveState);
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

const patchRowInPlace = (
	row: ListItem,
	value: TemplateValue,
	parsed: ParsedTemplate,
	itemHash: number,
): void => {
	//every instance in one tree shares the box, so the outgoing row's is the incoming row's
	const { moveState } = row.instance;
	if (isPatchableInPlace(row.instance, parsed))
		patchInstance(row.instance, value.values);
	else {
		const { instance, fragment } = mountInstance(value, parsed, moveState);
		replaceRowInstance(row, instance, fragment);
	}
	row.itemHash = itemHash;
};

const replaceRowInstance = (
	row: ListItem,
	instance: Instance,
	fragment: DocumentFragment,
): void => {
	clearRange(row.startNode, row.tailMarker);
	row.startNode = fragment.firstChild ?? row.tailMarker;
	row.tailMarker.before(fragment);
	row.instance = instance;
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

const removeRowNodes = (row: ListItem): void => {
	clearRange(row.startNode, row.tailMarker);
	row.tailMarker.remove();
};

export const hydrateListItems = (
	liveBinding: ContentLiveBinding,
	list: ListContentState,
	itemValues: Array<unknown>,
	moveState: StyleSheetMoveState,
	walker: TreeWalker,
): boolean => {
	const count = itemValues.length;
	const items: Array<ListItem> = new Array(count);
	let aggregateHash = LIST_HASH_SEED;
	for (let index = 0; index < count; index++) {
		const value = coerceToTemplate(itemValues[index]);
		const parsed = resolveNestedTemplate(value);
		const startNode = walker.currentNode.nextSibling!;
		const instance = hydrateInstance(
			walker,
			value,
			parsed,
			liveBinding.closeMarker,
			moveState,
		);
		if (instance === null) return false;
		const tailMarker = nextListTail(walker, liveBinding.closeMarker);
		if (tailMarker === null) return false;
		const itemHash = hashValue(itemValues[index]);
		aggregateHash = combineOrderedHash(aggregateHash, itemHash);
		items[index] = {
			tailMarker,
			instance,
			itemHash,
			shapeOrKeyHash: shapeOrKeyHashOf(value, parsed),
			startNode,
			placedAtIndex: index,
		};
	}

	if (walker.currentNode.nextSibling !== liveBinding.closeMarker) return false;
	list.items = items;
	list.lastValueHash = aggregateHash;
	return true;
};
