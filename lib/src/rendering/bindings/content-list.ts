import { ParsedTemplate } from "../../parser/types";
import { coerceToTemplate, TemplateValue } from "../../template";
import {
	combineOrderedHash,
	hashValue,
	LIST_HASH_SEED,
} from "../../utils/hashing";
import { combinedPartsHash } from "../compose";
import { NO_KEY } from "../constants";
import { MARKUP } from "../../parser/chars";
import {
	resolveNestedTemplate,
	hydrateInstance,
	Instance,
	isPatchableInPlace,
	mountInstance,
	patchInstance,
	refreshStyleSheetsAfterMove,
} from "../instance";
import { forEachNode, nextListTail } from "../markers";
import {
	StyleSheetMoveState,
	ContentLiveBinding,
	ListContentState,
	ListItem,
} from "./types";

const keyHashOf = (value: TemplateValue, parsed: ParsedTemplate): number =>
	parsed.keyValueParts === null
		? NO_KEY
		: combinedPartsHash(parsed.keyValueParts, value.values);

const shapeOrKeyHash = (templateHash: number, keyHash: number): number =>
	keyHash === NO_KEY ? templateHash : keyHash;

export const patchListContent = (
	liveBinding: ContentLiveBinding,
	itemValues: Array<unknown>,
	moveState: StyleSheetMoveState,
): void => {
	const list = liveBinding.content as ListContentState;
	const count = itemValues.length;
	if (list.itemHashes.length < count) list.itemHashes = new Array(count);
	const itemHashes = list.itemHashes;
	let aggregateHash = LIST_HASH_SEED;
	for (let index = 0; index < count; index++) {
		const itemHash = hashValue(itemValues[index]);
		itemHashes[index] = itemHash;
		aggregateHash = combineOrderedHash(aggregateHash, itemHash);
	}
	if (aggregateHash === list.aggregateHash) return;
	list.aggregateHash = aggregateHash;
	const resolvedRows = matchRowsToPreviousRows(
		liveBinding.startMarker,
		list.items,
		itemValues,
		itemHashes,
		count,
		moveState,
	);
	list.items = placeRows(
		liveBinding.startMarker,
		resolvedRows,
		itemValues,
		itemHashes,
		moveState,
	);
};

type RowsByHash = Map<number, Array<ListItem>>;

const addRowToGroup = (
	groups: RowsByHash,
	hash: number,
	row: ListItem,
): void => {
	const group = groups.get(hash);
	if (group === undefined) groups.set(hash, [row]);
	else group.push(row);
};

const groupRowsByContentHash = (
	rows: Array<ListItem>,
	startMarker: Comment,
): RowsByHash => {
	const groups: RowsByHash = new Map();
	let boundary: ChildNode = startMarker;
	for (let index = 0; index < rows.length; index++) {
		addRowToGroup(groups, rows[index].itemHash, rows[index]);
		rows[index].startNode = boundary.nextSibling!;
		boundary = rows[index].tailMarker;
	}
	return groups;
};

const groupUnclaimedByShapeOrKey = (previous: RowsByHash): RowsByHash => {
	const groups: RowsByHash = new Map();
	for (const group of previous.values())
		for (let index = 0; index < group.length; index++)
			addRowToGroup(
				groups,
				shapeOrKeyHash(
					group[index].instance.parsed.templateHash,
					group[index].keyHash,
				),
				group[index],
			);
	return groups;
};

const claimLeftmostUnclaimedRow = (
	groups: RowsByHash,
	hash: number,
): ListItem | undefined => groups.get(hash)?.shift();

const removeUnclaimedRows = (groups: RowsByHash): void => {
	for (const group of groups.values())
		for (let index = 0; index < group.length; index++)
			removeRowNodes(group[index]);
};

const matchRowsToPreviousRows = (
	startMarker: Comment,
	previousRows: Array<ListItem>,
	itemValues: Array<unknown>,
	itemHashes: Array<number>,
	count: number,
	moveState: StyleSheetMoveState,
): Array<ListItem | undefined> => {
	const previousByContentHash = groupRowsByContentHash(
		previousRows,
		startMarker,
	);
	const resolvedRows: Array<ListItem | undefined> = new Array(count);

	for (let index = 0; index < count; index++)
		resolvedRows[index] = claimLeftmostUnclaimedRow(
			previousByContentHash,
			itemHashes[index],
		);

	const leftoverByShapeOrKey = groupUnclaimedByShapeOrKey(
		previousByContentHash,
	);
	for (let index = 0; index < count; index++) {
		if (resolvedRows[index] !== undefined) continue;
		const value = coerceToTemplate(itemValues[index]);
		const parsed = resolveNestedTemplate(value);
		const matchHash = shapeOrKeyHash(
			parsed.templateHash,
			keyHashOf(value, parsed),
		);
		const reusableRow = claimLeftmostUnclaimedRow(
			leftoverByShapeOrKey,
			matchHash,
		);
		if (reusableRow === undefined) continue;
		patchRowInPlace(reusableRow, value, parsed, itemHashes[index], moveState);
		resolvedRows[index] = reusableRow;
	}

	removeUnclaimedRows(leftoverByShapeOrKey);

	return resolvedRows;
};

const placeRows = (
	startMarker: Comment,
	resolvedRows: Array<ListItem | undefined>,
	itemValues: Array<unknown>,
	itemHashes: Array<number>,
	moveState: StyleSheetMoveState,
): Array<ListItem> => {
	const finalRows: Array<ListItem> = new Array(resolvedRows.length);
	let cursor: ChildNode = startMarker;
	for (let index = 0; index < resolvedRows.length; index++) {
		let row = resolvedRows[index];
		if (row === undefined)
			row = mountRowAfter(
				cursor,
				itemValues[index],
				itemHashes[index],
				moveState,
			);
		else if (cursor.nextSibling !== row.startNode) {
			moveRowAfter(cursor, row);
			refreshStyleSheetsAfterMove(row.instance);
		}
		cursor = row.tailMarker;
		finalRows[index] = row;
	}
	return finalRows;
};

const mountRowAfter = (
	after: ChildNode,
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
		keyHash: keyHashOf(value, parsed),
		startNode,
	};
};

const patchRowInPlace = (
	row: ListItem,
	value: TemplateValue,
	parsed: ParsedTemplate,
	itemHash: number,
	moveState: StyleSheetMoveState,
): void => {
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
	forEachNode(row.startNode, row.tailMarker, (node) => node.remove());
	row.startNode = fragment.firstChild ?? row.tailMarker;
	row.tailMarker.before(fragment);
	row.instance = instance;
};

const moveRowAfter = (after: ChildNode, row: ListItem): void => {
	let anchor = after;
	forEachNode(row.startNode, row.tailMarker, (node) => {
		anchor.after(node);
		anchor = node;
	});
	anchor.after(row.tailMarker);
};

const removeRowNodes = (row: ListItem): void => {
	forEachNode(row.startNode, row.tailMarker, (node) => node.remove());
	row.tailMarker.remove();
};

export const hydrateListItems = (
	liveBinding: ContentLiveBinding,
	itemValues: Array<unknown>,
	moveState: StyleSheetMoveState,
	walker: TreeWalker,
): boolean => {
	const list = liveBinding.content as ListContentState;
	const count = itemValues.length;
	const items: Array<ListItem> = new Array(count);
	if (list.itemHashes.length < count) list.itemHashes = new Array(count);
	const itemHashes = list.itemHashes;
	let aggregateHash = LIST_HASH_SEED;
	for (let index = 0; index < count; index++) {
		const value = coerceToTemplate(itemValues[index]);
		const parsed = resolveNestedTemplate(value);
		const startNode = walker.currentNode.nextSibling!;
		const instance = hydrateInstance(
			walker,
			value,
			parsed,
			liveBinding.endMarker,
			moveState,
		);
		if (instance === null) return false;
		const tailMarker = nextListTail(walker, liveBinding.endMarker);
		if (tailMarker === null) return false;
		const itemHash = hashValue(itemValues[index]);
		itemHashes[index] = itemHash;
		aggregateHash = combineOrderedHash(aggregateHash, itemHash);
		items[index] = {
			tailMarker,
			instance,
			itemHash,
			keyHash: keyHashOf(value, parsed),
			startNode,
		};
	}

	if (walker.currentNode.nextSibling !== liveBinding.endMarker) return false;
	list.items = items;
	list.aggregateHash = aggregateHash;
	return true;
};
