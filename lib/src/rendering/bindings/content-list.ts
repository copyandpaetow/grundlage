import { BINDING, NO_KEY_BINDING } from "../../parser/constants";
import { AttributeStaticBinding, ParsedTemplate } from "../../parser/types";
import { getParsedTemplate } from "../../parser/html";
import { coerceToTemplate, TemplateValue } from "../../template";
import { hashValue, stringHash } from "../../utils/hashing";
import { composeParts } from "../compose";
import {
	combineOrderedHash,
	LIST_HASH_SEED,
	LIST_MARKER_DATA,
	NO_KEY,
} from "../constants";
import {
	assertNestable,
	hydrateRow,
	Instance,
	mountInstance,
	reconcileInstance,
} from "../instance";
import { forEachRowNode } from "../range";
import { ContentLiveBinding, ListContentState, ListItem } from "./types";

const isKeyed = (parsed: ParsedTemplate): boolean =>
	parsed.keyBindingIndex !== NO_KEY_BINDING;

const evaluateKeyHash = (value: TemplateValue, parsed: ParsedTemplate): number => {
	const binding = parsed.bindings[parsed.keyBindingIndex];
	const rendered =
		binding.type === BINDING.SINGLE_VALUE_ATTRIBUTE
			? String(value.values[binding.valueIndex])
			: composeParts((binding as AttributeStaticBinding).valueParts, value.values);
	return stringHash(rendered);
};

const keyHashOf = (value: TemplateValue, parsed: ParsedTemplate): number =>
	isKeyed(parsed) ? evaluateKeyHash(value, parsed) : NO_KEY;

const shapeOrKeyHash = (templateHash: number, keyHash: number): number =>
	keyHash === NO_KEY ? templateHash : keyHash;

const foldOrderedContentHashes = (values: Array<unknown>): number => {
	let aggregateHash = LIST_HASH_SEED;
	for (let index = 0; index < values.length; index++)
		aggregateHash = combineOrderedHash(aggregateHash, hashValue(values[index]));
	return aggregateHash;
};

export const patchListContent = (
	content: ContentLiveBinding,
	values: Array<unknown>,
): void => {
	const list = content.content as ListContentState;
	const aggregateHash = foldOrderedContentHashes(values);
	if (aggregateHash === list.aggregateHash) return;
	list.aggregateHash = aggregateHash;
	reconcileRows(content, list, values);
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

const groupRowsByShapeOrKey = (rows: Array<ListItem>): RowsByHash => {
	const groups: RowsByHash = new Map();
	for (let index = 0; index < rows.length; index++)
		addRowToGroup(
			groups,
			shapeOrKeyHash(rows[index].instance.templateHash, rows[index].keyHash),
			rows[index],
		);
	return groups;
};

const claimLeftmostUnclaimedRow = (
	groups: RowsByHash,
	hash: number,
): ListItem | undefined => groups.get(hash)?.shift();

const unclaimedRows = (groups: RowsByHash): Array<ListItem> => {
	const remaining: Array<ListItem> = [];
	for (const group of groups.values())
		for (let index = 0; index < group.length; index++) remaining.push(group[index]);
	return remaining;
};

const reconcileRows = (
	content: ContentLiveBinding,
	list: ListContentState,
	values: Array<unknown>,
): void => {
	const previousByContentHash = groupRowsByContentHash(
		list.items,
		content.startMarker,
	);
	const resolvedRows: Array<ListItem | undefined> = new Array(values.length);
	const newHashes: Array<number> = new Array(values.length);

	for (let index = 0; index < values.length; index++) {
		const itemHash = hashValue(values[index]);
		newHashes[index] = itemHash;
		resolvedRows[index] = claimLeftmostUnclaimedRow(
			previousByContentHash,
			itemHash,
		);
	}

	const leftoverByShapeOrKey = groupRowsByShapeOrKey(
		unclaimedRows(previousByContentHash),
	);
	for (let index = 0; index < values.length; index++) {
		if (resolvedRows[index] !== undefined) continue;
		const value = coerceToTemplate(values[index]);
		const parsed = getParsedTemplate(value.__templateStrings);
		const matchHash = shapeOrKeyHash(
			parsed.templateHash,
			keyHashOf(value, parsed),
		);
		const reusableRow = claimLeftmostUnclaimedRow(leftoverByShapeOrKey, matchHash);
		if (reusableRow === undefined) continue;
		patchRowInPlace(reusableRow, value, newHashes[index]);
		resolvedRows[index] = reusableRow;
	}

	for (const removedRow of unclaimedRows(leftoverByShapeOrKey))
		removeRowNodes(removedRow);

	list.items = placeRows(content, resolvedRows, values, newHashes);
};

const placeRows = (
	content: ContentLiveBinding,
	resolvedRows: Array<ListItem | undefined>,
	values: Array<unknown>,
	newHashes: Array<number>,
): Array<ListItem> => {
	const finalRows: Array<ListItem> = new Array(resolvedRows.length);
	let cursor: ChildNode = content.startMarker;
	for (let index = 0; index < resolvedRows.length; index++) {
		let row = resolvedRows[index];
		if (row === undefined)
			row = mountRowAfter(cursor, values[index], newHashes[index]);
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
): ListItem => {
	const value = coerceToTemplate(rawValue);
	assertNestable(value);
	const { instance, fragment } = mountInstance(value);
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
): void => {
	assertNestable(value);
	const mounted = reconcileInstance(row.instance, value);
	if (mounted !== null)
		replaceRowInstance(row, mounted.instance, mounted.fragment);
	row.itemHash = itemHash;
};

const replaceRowInstance = (
	row: ListItem,
	instance: Instance,
	fragment: DocumentFragment,
): void => {
	clearRowNodes(row);
	row.spanStart = fragment.firstChild ?? row.tailMarker;
	row.tailMarker.before(fragment);
	row.instance = instance;
};

const moveRowAfter = (after: ChildNode, row: ListItem): void => {
	let anchor = after;
	forEachRowNode(row, (node) => {
		anchor.after(node);
		anchor = node;
	});
	anchor.after(row.tailMarker);
};

const removeRowNodes = (row: ListItem): void => {
	forEachRowNode(row, (node) => node.remove());
	row.tailMarker.remove();
};

const clearRowNodes = (row: ListItem): void => {
	forEachRowNode(row, (node) => node.remove());
};

export const hydrateListItems = (
	liveBinding: ContentLiveBinding,
	values: Array<unknown>,
): void => {
	const list = liveBinding.content as ListContentState;
	const items: Array<ListItem> = new Array(values.length);
	let rowStart: Node = liveBinding.startMarker;
	for (let index = 0; index < values.length; index++) {
		const value = coerceToTemplate(values[index]);
		assertNestable(value);
		const spanStart = rowStart.nextSibling!;
		const { instance, tailMarker } = hydrateRow(value, rowStart);
		const parsed = getParsedTemplate(value.__templateStrings);
		items[index] = {
			tailMarker,
			instance,
			itemHash: hashValue(values[index]),
			keyHash: keyHashOf(value, parsed),
			spanStart,
		};
		rowStart = tailMarker;
	}
	list.items = items;
	list.aggregateHash = foldOrderedContentHashes(values);
};
