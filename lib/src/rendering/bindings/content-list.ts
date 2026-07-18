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
import { LIST_MARKER_DATA, NO_KEY } from "../constants";
import {
	assertNestable,
	hydrateRow,
	Instance,
	mountInstance,
	reconcileInstance,
	releaseInstance,
} from "../instance";
import { forEachInRange } from "../range";
import {
	Carrier,
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
	content: ContentLiveBinding,
	values: Array<unknown>,
	carrier: Carrier,
): void => {
	const list = content.content as ListContentState;
	const count = values.length;
	if (list.itemHashes.length < count) list.itemHashes = new Array(count);
	const itemHashes = list.itemHashes;
	let aggregateHash = LIST_HASH_SEED;
	for (let index = 0; index < count; index++) {
		const itemHash = hashValue(values[index]);
		itemHashes[index] = itemHash;
		aggregateHash = combineOrderedHash(aggregateHash, itemHash);
	}
	if (aggregateHash === list.aggregateHash) return;
	list.aggregateHash = aggregateHash;
	reconcileRows(content, list, values, itemHashes, count, carrier);
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
		rows[index].spanStart = boundary.nextSibling!;
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
	content: ContentLiveBinding,
	list: ListContentState,
	values: Array<unknown>,
	itemHashes: Array<number>,
	count: number,
	carrier: Carrier,
): void => {
	const previousByContentHash = groupRowsByContentHash(
		list.items,
		content.startMarker,
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
		const value = coerceToTemplate(values[index]);
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
		patchRowInPlace(reusableRow, value, itemHashes[index], carrier);
		resolvedRows[index] = reusableRow;
	}

	removeUnclaimedRows(leftoverByShapeOrKey);

	list.items = placeRows(content, resolvedRows, values, itemHashes, carrier);
};

const placeRows = (
	content: ContentLiveBinding,
	resolvedRows: Array<ListItem | undefined>,
	values: Array<unknown>,
	itemHashes: Array<number>,
	carrier: Carrier,
): Array<ListItem> => {
	const finalRows: Array<ListItem> = new Array(resolvedRows.length);
	let cursor: ChildNode = content.startMarker;
	for (let index = 0; index < resolvedRows.length; index++) {
		let row = resolvedRows[index];
		if (row === undefined)
			row = mountRowAfter(cursor, values[index], itemHashes[index], carrier);
		else if (cursor.nextSibling !== row.spanStart) moveRowAfter(cursor, row);
		cursor = row.tailMarker;
		finalRows[index] = row;
	}
	return finalRows;
};

const mountRowAfter = (
	after: ChildNode,
	rawValue: unknown,
	itemHash: number,
	carrier: Carrier,
): ListItem => {
	const value = coerceToTemplate(rawValue);
	assertNestable(value);
	const { instance, fragment } = mountInstance(value, carrier);
	const tailMarker = document.createComment(LIST_MARKER_DATA);
	const spanStart = fragment.firstChild ?? tailMarker;
	after.after(fragment, tailMarker);
	const parsed = getParsedTemplate(value.__templateStrings);
	return {
		tailMarker,
		instance,
		itemHash,
		keyHash: keyHashOf(value, parsed),
		spanStart,
	};
};

const patchRowInPlace = (
	row: ListItem,
	value: TemplateValue,
	itemHash: number,
	carrier: Carrier,
): void => {
	assertNestable(value);
	const mounted = reconcileInstance(row.instance, value, carrier);
	if (mounted !== null)
		replaceRowInstance(row, mounted.instance, mounted.fragment);
	row.itemHash = itemHash;
};

const replaceRowInstance = (
	row: ListItem,
	instance: Instance,
	fragment: DocumentFragment,
): void => {
	releaseInstance(row.instance);
	clearRowNodes(row);
	row.spanStart = fragment.firstChild ?? row.tailMarker;
	row.tailMarker.before(fragment);
	row.instance = instance;
};

const moveRowAfter = (after: ChildNode, row: ListItem): void => {
	let anchor = after;
	forEachInRange(row.spanStart, row.tailMarker, (node) => {
		anchor.after(node);
		anchor = node;
	});
	anchor.after(row.tailMarker);
};

const removeRowNodes = (row: ListItem): void => {
	releaseInstance(row.instance);
	forEachInRange(row.spanStart, row.tailMarker, (node) => node.remove());
	row.tailMarker.remove();
};

const clearRowNodes = (row: ListItem): void => {
	forEachInRange(row.spanStart, row.tailMarker, (node) => node.remove());
};

export const hydrateListItems = (
	liveBinding: ContentLiveBinding,
	values: Array<unknown>,
	carrier: Carrier,
): void => {
	const list = liveBinding.content as ListContentState;
	const count = values.length;
	const items: Array<ListItem> = new Array(count);
	if (list.itemHashes.length < count) list.itemHashes = new Array(count);
	const itemHashes = list.itemHashes;
	let aggregateHash = LIST_HASH_SEED;
	let rowStart: Node = liveBinding.startMarker;
	for (let index = 0; index < count; index++) {
		const value = coerceToTemplate(values[index]);
		assertNestable(value);
		const spanStart = rowStart.nextSibling!;
		const { instance, tailMarker } = hydrateRow(value, rowStart, carrier);
		const parsed = getParsedTemplate(value.__templateStrings);
		const itemHash = hashValue(values[index]);
		itemHashes[index] = itemHash;
		aggregateHash = combineOrderedHash(aggregateHash, itemHash);
		items[index] = {
			tailMarker,
			instance,
			itemHash,
			keyHash: keyHashOf(value, parsed),
			spanStart,
		};
		rowStart = tailMarker;
	}
	list.items = items;
	list.aggregateHash = aggregateHash;
};
