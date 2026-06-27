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

const LIST_IDENTIFIER = "*.*"; //small enough to save space but unique enough to not collide with potential user comments

const isListMarker = (node: Node): node is Comment =>
	isComment(node) && node.data === LIST_IDENTIFIER;

//a list entry resolves to one of three leaves on insert: a user template renders its own DOM, a nested array gets an engine wrapper so its inner markers stay scoped, and any stringable value renders as a single bare text node
const KIND_PRIMITIVE = 0;
const KIND_TEMPLATE = 1;
const KIND_ARRAY = 2;

const kindOf = (entry: unknown): number =>
	isTemplate(entry)
		? KIND_TEMPLATE
		: Array.isArray(entry)
			? KIND_ARRAY
			: KIND_PRIMITIVE;

//shared empty so a slot that has never rendered a list reads as "nothing was here" without a null branch
const EMPTY_HASHES: Array<number> = [];

const primitiveText = (entry: unknown): string =>
	entry == null ? "" : assertPrimitiveString(entry);

//builds a fresh item's DOM right after `position` and returns its trailing marker as the next insertion point. a changed item is rebuilt through here rather than updated in place, so we never need to keep the prior item's HTMLTemplate instance around
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
		//we stop at a per-item marker (next item above) or the outer list container marker
		//if we crossed the container marker we would delete the binding's own anchor and corrupt subsequent renders
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
	//our only persisted state is the prior render's per-item hashes, kept on the template and indexed by the binding's expression slot (allocated lazily so a template that never renders a list pays nothing). we never read or write the user's array — an in-place push/reverse is seen because we re-hash every entry and diff against these stored hashes
	let slots = context.listItemHashes;
	if (slots === EMPTY_LIST_ITEM_HASHES) {
		slots = context.listItemHashes = new Array(
			context.currentExpressions.length,
		).fill(EMPTY_HASHES);
	}
	const previousHashes = slots[expressionIndex];

	const current = context.currentExpressions[expressionIndex] as Array<unknown>;
	const currentLength = current.length;

	//hash every entry once up front (templates read their memoized hash, primitives/arrays fold their content) for the reconciliation below
	//updateTemplate already folded this same array and only marks the binding dirty when the fold changed, so by the time we run at least one entry differs — no "nothing changed" bail needed here
	const currentHashes: Array<number> = new Array(currentLength);
	for (let index = 0; index < currentLength; index++) {
		currentHashes[index] = hashValue(current[index]);
	}

	slots[expressionIndex] = currentHashes;

	//we walk the live DOM once and collect one marker per item that's currently rendered
	//the DOM is the source of truth here. if it has fewer items than the prior hashes (e.g. someone cleared the binding's children between renders) we cap collection at what we actually see
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

	/*
	before tackling the harder reconciliation we peel matching entries from both ends inwards
	hash-equal entries are interchangeable (the hash folds shape + content) so any item we match at the head or tail can stay exactly where it already is in the DOM
	=> append, prepend, pop, shift, and adjacent-swap all resolve in this phase without touching the DOM
	*/
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

	//if the current middle is empty after the peel, every leftover in the previous middle is a deletion
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

	//if the previous middle is empty after the peel, every leftover in the current middle is a fresh insertion
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

	/*
	otherwise both middles have content. we claim a previous slot for each current entry by exact hash:
	- a hash match means identical content => the existing DOM range stays, moved only if it arrives out of order
	- anything unmatched is rebuilt fresh (a changed item is an insert, not an in-place update — we keep no instance to patch)
	unclaimed previous slots are removed at the end
	*/
	const middleLengthPrevious = tailPrevious - headPrevious + 1;
	const hashToMiddleIndex = new Map<number, number>();
	for (let middleIndex = 0; middleIndex < middleLengthPrevious; middleIndex++) {
		hashToMiddleIndex.set(previousHashes[headPrevious + middleIndex], middleIndex);
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

		//if our claims have been coming in the same order they appear in the previous middle (the common "same list, values changed" case), the existing DOM is already where we want it
		//=> we only walk siblings to verify and potentially move when a claim arrives out of order
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
