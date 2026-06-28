import { html } from "../parser/html";
import { hashValue } from "../utils/hashing";
import { assertPrimitiveString } from "../utils/to-primitive";
import { isComment } from "../utils/validators";
import {
	EMPTY_LIST_ITEM_HASHES,
	HTMLTemplate,
	isTemplate,
	setupTemplate,
} from "./template-html";

const LIST_IDENTIFIER = "*.*";

const isListMarker = (node: Node): node is Comment =>
	isComment(node) && node.data === LIST_IDENTIFIER;

const KIND_PRIMITIVE = 0;
const KIND_TEMPLATE = 1;
const KIND_ARRAY = 2;

const kindOf = (entry: unknown): number =>
	isTemplate(entry)
		? KIND_TEMPLATE
		: Array.isArray(entry)
			? KIND_ARRAY
			: KIND_PRIMITIVE;

const EMPTY_HASHES: Array<number> = [];

const primitiveText = (entry: unknown): string =>
	entry == null ? "" : assertPrimitiveString(entry);

const insertItem = (
	position: ChildNode,
	entry: unknown,
	kind: number,
): Comment => {
	const itemMarker = new Comment(LIST_IDENTIFIER);
	if (kind === KIND_TEMPLATE) {
		position.after(setupTemplate(entry as HTMLTemplate, null), itemMarker);
	} else if (kind === KIND_ARRAY) {
		position.after(setupTemplate(html`${entry}`, null), itemMarker);
	} else {
		position.after(document.createTextNode(primitiveText(entry)), itemMarker);
	}
	return itemMarker;
};

const removeItemDom = (itemMarker: Comment, listContainerMarker: Comment) => {
	let current: ChildNode | null = itemMarker;
	while (current) {
		const prev = current.previousSibling as ChildNode | null;
		current.remove();
		if (!prev || prev === listContainerMarker || isListMarker(prev)) return;
		current = prev;
	}
};

const isAlreadyInPosition = (position: Node, itemMarker: Comment) => {
	let scan: Node | null = itemMarker.previousSibling;
	while (scan && scan !== position) {
		if (isListMarker(scan)) return false;
		scan = scan.previousSibling;
	}
	return scan === position;
};

const moveItemAfter = (position: ChildNode, itemMarker: Comment) => {
	let current: ChildNode | null = itemMarker;
	while (current) {
		const prev = current.previousSibling as ChildNode | null;
		position.after(current);
		if (!prev || isListMarker(prev)) return;
		current = prev;
	}
};

export const renderList = (
	context: HTMLTemplate,
	marker: Comment,
	expressionIndex: number,
) => {
	let slots = context.listItemHashes;
	if (slots === EMPTY_LIST_ITEM_HASHES) {
		slots = context.listItemHashes = new Array(
			context.currentExpressions.length,
		).fill(EMPTY_HASHES);
	}
	const previousHashes = slots[expressionIndex];

	const current = context.currentExpressions[expressionIndex] as Array<unknown>;
	const currentLength = current.length;

	const currentHashes: Array<number> = new Array(currentLength);
	for (let index = 0; index < currentLength; index++) {
		currentHashes[index] = hashValue(current[index]);
	}

	slots[expressionIndex] = currentHashes;

	const previousMarkers: Array<Comment> = [];
	let sibling: Node | null = marker.nextSibling;
	while (sibling) {
		if (isComment(sibling) && sibling.data === marker.data) break;
		if (
			isListMarker(sibling) &&
			previousMarkers.length < previousHashes.length
		) {
			previousMarkers.push(sibling);
		}
		sibling = sibling.nextSibling;
	}
	const previousLength = previousMarkers.length;

	let headCurrent = 0;
	let headPrevious = 0;
	let tailCurrent = currentLength - 1;
	let tailPrevious = previousLength - 1;

	while (
		headCurrent <= tailCurrent &&
		headPrevious <= tailPrevious &&
		currentHashes[headCurrent] === previousHashes[headPrevious]
	) {
		headCurrent++;
		headPrevious++;
	}
	while (
		headCurrent <= tailCurrent &&
		headPrevious <= tailPrevious &&
		currentHashes[tailCurrent] === previousHashes[tailPrevious]
	) {
		tailCurrent--;
		tailPrevious--;
	}

	if (headCurrent > tailCurrent) {
		for (
			let previousIndex = headPrevious;
			previousIndex <= tailPrevious;
			previousIndex++
		) {
			removeItemDom(previousMarkers[previousIndex], marker);
		}
		return;
	}

	if (headPrevious > tailPrevious) {
		let position: ChildNode =
			headPrevious === 0 ? marker : previousMarkers[headPrevious - 1];
		for (
			let currentIndex = headCurrent;
			currentIndex <= tailCurrent;
			currentIndex++
		) {
			position = insertItem(
				position,
				current[currentIndex],
				kindOf(current[currentIndex]),
			);
		}
		return;
	}

	const middleLengthPrevious = tailPrevious - headPrevious + 1;
	const hashToMiddleIndex = new Map<number, number>();
	for (let middleIndex = 0; middleIndex < middleLengthPrevious; middleIndex++) {
		hashToMiddleIndex.set(
			previousHashes[headPrevious + middleIndex],
			middleIndex,
		);
	}

	const previousClaimed = new Uint8Array(middleLengthPrevious);

	let position: ChildNode =
		headPrevious === 0 ? marker : previousMarkers[headPrevious - 1];
	let expectedMiddleIndex = 0;

	for (
		let currentIndex = headCurrent;
		currentIndex <= tailCurrent;
		currentIndex++
	) {
		let claimedMiddleIndex = hashToMiddleIndex.get(currentHashes[currentIndex]);
		if (
			claimedMiddleIndex !== undefined &&
			previousClaimed[claimedMiddleIndex]
		) {
			claimedMiddleIndex = undefined;
		}

		if (claimedMiddleIndex === undefined) {
			position = insertItem(
				position,
				current[currentIndex],
				kindOf(current[currentIndex]),
			);
			continue;
		}

		previousClaimed[claimedMiddleIndex] = 1;
		const itemMarker = previousMarkers[headPrevious + claimedMiddleIndex];

		if (claimedMiddleIndex !== expectedMiddleIndex) {
			if (!isAlreadyInPosition(position, itemMarker)) {
				moveItemAfter(position, itemMarker);
			}
		}
		expectedMiddleIndex = claimedMiddleIndex + 1;
		position = itemMarker;
	}

	for (let middleIndex = 0; middleIndex < middleLengthPrevious; middleIndex++) {
		if (!previousClaimed[middleIndex]) {
			removeItemDom(previousMarkers[headPrevious + middleIndex], marker);
		}
	}
};
