import { html } from "../parser/html";
import { hashValue } from "../utils/hashing";
import { assertPrimitiveString } from "../utils/to-primitive";
import { isComment } from "../utils/validators";
import { HTMLTemplate, isTemplate, setupTemplate, updateTemplate } from "./template-html";

const LIST_IDENTIFIER = "*.*"; //small enough to save space but unique enough to not collide with potential user comments

const isListMarker = (node: Node): node is Comment =>
	isComment(node) && node.data === LIST_IDENTIFIER;

//a list entry resolves to one of three leaves on apply: a user template renders/updates in place, a nested array gets its own engine wrapper so its inner markers stay scoped, and any stringable value renders as a single bare text node
const KIND_PRIMITIVE = 0;
const KIND_TEMPLATE = 1;
const KIND_ARRAY = 2;

const kindOf = (entry: unknown): number =>
	isTemplate(entry)
		? KIND_TEMPLATE
		: Array.isArray(entry)
			? KIND_ARRAY
			: KIND_PRIMITIVE;

//every nested-array entry is wrapped through this one call site, so all array wrappers share one ParsedHTML. comparing a prior carrier against it tells an array slot apart from a user-template slot without storing a parallel kind array
//resolved lazily, not at module load: list -> template-html -> content -> list is an import cycle, and html`` constructs an HTMLTemplate that may not be initialized yet during module evaluation
let arrayWrapperParsed: HTMLTemplate["parsedHTML"] | undefined;
const arrayWrapper = (): HTMLTemplate["parsedHTML"] =>
	(arrayWrapperParsed ??= html`${null}`.parsedHTML);

//a prior slot keeps a carrier only when it owns persistent state: a template (its DOM bindings) or an array wrapper (the nested list). a primitive's DOM is a single text node found via its marker, so it carries null
const carrierKind = (carrier: HTMLTemplate | null): number =>
	carrier === null
		? KIND_PRIMITIVE
		: carrier.parsedHTML === arrayWrapper()
			? KIND_ARRAY
			: KIND_TEMPLATE;

interface ListSnapshot {
	//carriers[i] is the engine's DOM carrier for item i (template/array-wrapper), or null for a primitive item
	carriers: Array<HTMLTemplate | null>;
	//hashes[i] folds item i's content; primitives keep no carrier, so this is the only record of their prior value
	hashes: Array<number>;
}

const EMPTY_SNAPSHOT: ListSnapshot = { carriers: [], hashes: [] };

//the engine's own record of what each list binding rendered last, keyed on the binding's marker (stable across renders) so we never write reconciled state back into the user's array. GCs with the marker when the list is torn down
const listSnapshots = new WeakMap<Comment, ListSnapshot>();

const primitiveText = (entry: unknown): string =>
	entry == null ? "" : assertPrimitiveString(entry);

//inserts a fresh item's DOM right after `position`, records its carrier, and returns the trailing item marker as the next insertion point
const insertItem = (
	position: ChildNode,
	entry: unknown,
	kind: number,
	carriers: Array<HTMLTemplate | null>,
	index: number,
): Comment => {
	const itemMarker = new Comment(LIST_IDENTIFIER);
	if (kind === KIND_TEMPLATE) {
		position.after(setupTemplate(entry as HTMLTemplate, null), itemMarker);
		carriers[index] = entry as HTMLTemplate;
	} else if (kind === KIND_ARRAY) {
		const wrapper = html`${entry}`;
		position.after(setupTemplate(wrapper, null), itemMarker);
		carriers[index] = wrapper;
	} else {
		position.after(document.createTextNode(primitiveText(entry)), itemMarker);
		carriers[index] = null;
	}
	return itemMarker;
};

//reuses a claimed prior slot's DOM for a changed entry of the same kind: a template re-diffs its expressions, an array wrapper re-reconciles, a primitive patches its existing text node
const updateItem = (
	itemMarker: Comment,
	carrier: HTMLTemplate | null,
	entry: unknown,
	kind: number,
) => {
	if (kind === KIND_TEMPLATE) {
		updateTemplate(
			carrier as HTMLTemplate,
			(entry as HTMLTemplate).currentExpressions,
		);
	} else if (kind === KIND_ARRAY) {
		updateTemplate(carrier as HTMLTemplate, [entry]);
	} else {
		(itemMarker.previousSibling as Text).data = primitiveText(entry);
	}
};

//a prior slot can be reused for a current entry only when their leaves are the same shape: same-kind for primitives/arrays, same ParsedHTML for templates
const canReuseStructurally = (
	carrier: HTMLTemplate | null,
	entry: unknown,
	kind: number,
): boolean => {
	if (kind === KIND_PRIMITIVE) return carrier === null;
	if (kind === KIND_ARRAY) return carrierKind(carrier) === KIND_ARRAY;
	return carrier !== null && carrier.parsedHTML === (entry as HTMLTemplate).parsedHTML;
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
	//we diff the live user array against our own snapshot of what we rendered last time, never against (or into) the user's array — an in-place push/reverse is seen because we re-read and re-hash every entry here
	const previous = listSnapshots.get(marker) ?? EMPTY_SNAPSHOT;
	const previousCarriers = previous.carriers;
	const previousHashes = previous.hashes;

	const current = context.currentExpressions[expressionIndex] as Array<unknown>;
	const currentLength = current.length;

	//hash every entry once up front (the parallel hash side-channel); templates read their memoized hash, primitives/arrays fold their content. reused across the peel and claim passes and stored as next render's snapshot
	const currentHashes: Array<number> = new Array(currentLength);
	for (let index = 0; index < currentLength; index++) {
		currentHashes[index] = hashValue(current[index]);
	}
	const newCarriers: Array<HTMLTemplate | null> = new Array(currentLength);

	//we walk the live DOM once and collect one marker per item that's currently rendered
	//the DOM is the source of truth here. if it has fewer items than the snapshot (e.g. someone cleared the binding's children between renders) we cap collection at what we actually see
	const previousMarkers: Array<Comment> = [];
	let sibling: Node | null = marker.nextSibling;
	while (sibling) {
		if (isComment(sibling) && sibling.data === marker.data) break;
		if (
			isListMarker(sibling) &&
			previousMarkers.length < previousCarriers.length
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
		newCarriers[headCurrent] = previousCarriers[headPrevious];
		headCurrent++;
		headPrevious++;
	}
	while (
		headCurrent <= tailCurrent &&
		headPrevious <= tailPrevious &&
		currentHashes[tailCurrent] === previousHashes[tailPrevious]
	) {
		newCarriers[tailCurrent] = previousCarriers[tailPrevious];
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
		listSnapshots.set(marker, { carriers: newCarriers, hashes: currentHashes });
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
				newCarriers,
				currentIndex,
			);
		}
		listSnapshots.set(marker, { carriers: newCarriers, hashes: currentHashes });
		return;
	}

	/*
	otherwise both middles have content, and we need to reconcile them
	we walk the current middle and try to claim a previous slot for each entry:
	- first by hash (shape + content match exactly => DOM stays, no update needed)
	- otherwise by leaf shape at the same relative position (DOM stays, we update it to the new content)
	- otherwise we insert a fresh item
	hash and structural claims share the same walk, so a structural claim for current[earlyIndex] can occasionally take a slot that a later current[laterIndex] would have hash-matched
	=> the output still stays correct (the reused slot gets updated to current[laterIndex]) and the worst case is one extra update in a pathological cross-pattern
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
		const entry = current[currentIndex];
		const kind = kindOf(entry);
		const relativeOffset = currentIndex - headCurrent;

		let claimedMiddleIndex = hashToMiddleIndex.get(currentHashes[currentIndex]);
		if (
			claimedMiddleIndex !== undefined &&
			previousClaimed[claimedMiddleIndex]
		) {
			claimedMiddleIndex = undefined;
		}

		if (
			claimedMiddleIndex === undefined &&
			relativeOffset < middleLengthPrevious &&
			!previousClaimed[relativeOffset] &&
			canReuseStructurally(
				previousCarriers[headPrevious + relativeOffset],
				entry,
				kind,
			)
		) {
			claimedMiddleIndex = relativeOffset;
		}

		if (claimedMiddleIndex === undefined) {
			position = insertItem(position, entry, kind, newCarriers, currentIndex);
			continue;
		}

		previousClaimed[claimedMiddleIndex] = 1;
		const claimedSlot = headPrevious + claimedMiddleIndex;
		const reusedCarrier = previousCarriers[claimedSlot];
		const itemMarker = previousMarkers[claimedSlot];
		//a hash claim already matched content exactly; only a structural claim (different hash, same leaf shape) needs the DOM updated
		if (currentHashes[currentIndex] !== previousHashes[claimedSlot]) {
			updateItem(itemMarker, reusedCarrier, entry, kind);
		}
		newCarriers[currentIndex] = reusedCarrier;

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

	listSnapshots.set(marker, { carriers: newCarriers, hashes: currentHashes });
};
