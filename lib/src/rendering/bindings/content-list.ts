import { BINDING, NO_KEY_BINDING } from "../../parser/constants";
import { AttributeStaticBinding, ParsedTemplate } from "../../parser/types";
import { getParsedTemplate } from "../../parser/html";
import { coerceToTemplate, TemplateValue } from "../../template";
import {
	combineOrderedHash,
	hashValue,
	LIST_HASH_SEED,
} from "../../utils/hashing";
import { composeParts } from "../compose";
import { NO_KEY } from "../constants";
import { MARKUP } from "../../parser/chars";
import {
	assertNestable,
	hydrateRow,
	Instance,
	mountInstance,
	reconcileInstance,
	refreshStyleSheetsAfterMove,
	releaseInstance,
} from "../instance";
import { forEachNode } from "../markers";
import {
	StyleSheetMoveState,
	ContentLiveBinding,
	ListContentState,
	ListItem,
} from "./types";

const isKeyed = (parsed: ParsedTemplate): boolean =>
	parsed.keyBindingIndex !== NO_KEY_BINDING;

const evaluateKeyHash = (
	value: TemplateValue,
	parsed: ParsedTemplate,
): number => {
	const binding = parsed.bindings[parsed.keyBindingIndex];
	const keyValue =
		binding.type === BINDING.SINGLE_VALUE_ATTRIBUTE
			? value.values[binding.valueIndex]
			: composeParts(
					(binding as AttributeStaticBinding).valueParts,
					value.values,
				);

	return hashValue(keyValue);
};

const keyHashOf = (value: TemplateValue, parsed: ParsedTemplate): number =>
	isKeyed(parsed) ? evaluateKeyHash(value, parsed) : NO_KEY;

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
	reconcileRows(liveBinding, list, itemValues, itemHashes, count, moveState);
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

const reconcileRows = (
	liveBinding: ContentLiveBinding,
	list: ListContentState,
	itemValues: Array<unknown>,
	itemHashes: Array<number>,
	count: number,
	moveState: StyleSheetMoveState,
): void => {
	const previousByContentHash = groupRowsByContentHash(
		list.items,
		liveBinding.startMarker,
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
		const parsed = getParsedTemplate(value.__templateStrings);
		const matchHash = shapeOrKeyHash(
			parsed.templateHash,
			keyHashOf(value, parsed),
		);
		const reusableRow = claimLeftmostUnclaimedRow(
			leftoverByShapeOrKey,
			matchHash,
		);
		if (reusableRow === undefined) continue;
		patchRowInPlace(reusableRow, value, itemHashes[index], moveState);
		resolvedRows[index] = reusableRow;
	}

	removeUnclaimedRows(leftoverByShapeOrKey);

	list.items = placeRows(
		liveBinding,
		resolvedRows,
		itemValues,
		itemHashes,
		moveState,
	);
};

const placeRows = (
	liveBinding: ContentLiveBinding,
	resolvedRows: Array<ListItem | undefined>,
	itemValues: Array<unknown>,
	itemHashes: Array<number>,
	moveState: StyleSheetMoveState,
): Array<ListItem> => {
	const finalRows: Array<ListItem> = new Array(resolvedRows.length);
	let cursor: ChildNode = liveBinding.startMarker;
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
	assertNestable(value);
	const { instance, fragment } = mountInstance(value, moveState);
	const tailMarker = document.createComment(MARKUP.LIST_MARKER_DATA);
	const startNode = fragment.firstChild ?? tailMarker;
	after.after(fragment, tailMarker);
	const parsed = getParsedTemplate(value.__templateStrings);
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
	itemHash: number,
	moveState: StyleSheetMoveState,
): void => {
	assertNestable(value);
	const mounted = reconcileInstance(row.instance, value, moveState);
	if (mounted) replaceRowInstance(row, mounted.instance, mounted.fragment);
	row.itemHash = itemHash;
};

const replaceRowInstance = (
	row: ListItem,
	instance: Instance,
	fragment: DocumentFragment,
): void => {
	releaseInstance(row.instance);
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
	releaseInstance(row.instance);
	forEachNode(row.startNode, row.tailMarker, (node) => node.remove());
	row.tailMarker.remove();
};

export const hydrateListItems = (
	liveBinding: ContentLiveBinding,
	itemValues: Array<unknown>,
	moveState: StyleSheetMoveState,
): void => {
	const list = liveBinding.content as ListContentState;
	const count = itemValues.length;
	const items: Array<ListItem> = new Array(count);
	if (list.itemHashes.length < count) list.itemHashes = new Array(count);
	const itemHashes = list.itemHashes;
	let aggregateHash = LIST_HASH_SEED;
	let rowStart: Node = liveBinding.startMarker;
	for (let index = 0; index < count; index++) {
		const value = coerceToTemplate(itemValues[index]);
		assertNestable(value);
		const startNode = rowStart.nextSibling!;
		const { instance, tailMarker } = hydrateRow(value, rowStart, moveState);
		const parsed = getParsedTemplate(value.__templateStrings);
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
		rowStart = tailMarker;
	}
	list.items = items;
	list.aggregateHash = aggregateHash;
};
