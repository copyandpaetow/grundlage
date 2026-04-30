import { html } from "../parser/html";
import { bindingToString } from "../utils/binding-to-string";
import { assertPrimitiveString, isStringable } from "../utils/to-primitive";
import { isComment, isSameTemplate } from "../utils/validators";
import { HTMLTemplate } from "./template-html";

const deleteNodesBetween = (start: Node, end?: Node) => {
	let current = start.nextSibling;

	while (current) {
		//list markers all have the same data, if we find another comment with the same data as our marker, we found the start of the next entry
		const isLastComment =
			current === end ||
			(isComment(current) && current.data === (start as Comment).data);

		if (isLastComment) {
			break;
		}

		const next = current.nextSibling;
		current.remove();
		current = next;
	}
};

const toTemplateList = (list: Array<unknown>): Array<HTMLTemplate> => {
	for (let index = 0; index < list.length; index++) {
		const element = list[index];
		if (!(element instanceof HTMLTemplate)) {
			list[index] = html`${element}`;
		}
	}
	return list as Array<HTMLTemplate>;
};

const LIST_IDENTIFIER = "*.*"; //small enough to save space but unique enough to not collide with potential user comments
const EMPTY_PREVIOUS: ReadonlyArray<HTMLTemplate> = [];

const isListMarker = (node: Node): node is Comment =>
	isComment(node) && node.data === LIST_IDENTIFIER;

const removeItemDom = (itemMarker: Comment, listContainerMarker: Comment) => {
	let current: ChildNode | null = itemMarker;
	while (current) {
		const prev = current.previousSibling as ChildNode | null;
		current.remove();
		// Stop at a per-item marker (next item above) or the outer list
		// container marker — crossing the container marker would delete the
		// binding's own anchor and corrupt subsequent renders.
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

const renderList = (
	context: HTMLTemplate,
	marker: Comment,
	expressionIndex: number,
) => {
	const previousValue = context.previousExpressions[expressionIndex];
	const current = toTemplateList(
		context.currentExpressions[expressionIndex] as Array<unknown>,
	);
	const trackedPrevious = (
		Array.isArray(previousValue) ? previousValue : EMPTY_PREVIOUS
	) as Array<HTMLTemplate>;

	// Walk the current DOM once, collecting per-item markers. The DOM is the
	// source of truth: if it's shorter than the tracked array (e.g. the slot
	// was cleared between renders), we treat the tail as absent.
	const previousMarkers: Array<Comment> = [];
	let sibling: Node | null = marker.nextSibling;
	while (sibling) {
		if (isComment(sibling) && sibling.data === marker.data) break;
		if (
			isListMarker(sibling) &&
			previousMarkers.length < trackedPrevious.length
		) {
			previousMarkers.push(sibling);
		}
		sibling = sibling.nextSibling;
	}
	const previousLength = previousMarkers.length;

	// Two-pointer head/tail peel. Hash-equal templates are interchangeable
	// (hash folds template shape + expression values), so matched ends stay in
	// place with no DOM work and no bookkeeping allocation. Append, prepend,
	// pop, shift, and adjacent-swap all resolve entirely in this phase.
	let headCurrent = 0;
	let headPrevious = 0;
	let tailCurrent = current.length - 1;
	let tailPrevious = previousLength - 1;

	while (
		headCurrent <= tailCurrent &&
		headPrevious <= tailPrevious &&
		current[headCurrent].hash === trackedPrevious[headPrevious].hash
	) {
		current[headCurrent] = trackedPrevious[headPrevious];
		headCurrent++;
		headPrevious++;
	}
	while (
		headCurrent <= tailCurrent &&
		headPrevious <= tailPrevious &&
		current[tailCurrent].hash === trackedPrevious[tailPrevious].hash
	) {
		current[tailCurrent] = trackedPrevious[tailPrevious];
		tailCurrent--;
		tailPrevious--;
	}

	// Pure removal: current middle is empty, previous middle has leftovers.
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

	// Pure insertion: previous middle exhausted, current middle has new items.
	if (headPrevious > tailPrevious) {
		let position: ChildNode =
			headPrevious === 0 ? marker : previousMarkers[headPrevious - 1];
		for (
			let currentIndex = headCurrent;
			currentIndex <= tailCurrent;
			currentIndex++
		) {
			const listItemMarker = new Comment(LIST_IDENTIFIER);
			position.after(current[currentIndex].setup(), listItemMarker);
			position = listItemMarker;
		}
		return;
	}

	// General middle: hash claim + structural fallback + apply, all fused into
	// one walk. Fusion changes priority slightly vs. two separate passes — a
	// structural claim for current[i] can win a slot that a later current[j]
	// would have hash-matched. Output stays correct (the reused template is
	// .update()d to current[j]); worst case is one extra .update() call in a
	// pathological cross-pattern. The head/tail peel above already absorbs the
	// common "stable ends, changed middle" case where this would matter most.
	const middleLengthPrevious = tailPrevious - headPrevious + 1;
	const hashToMiddleIndex = new Map<number, number>();
	for (let middleIndex = 0; middleIndex < middleLengthPrevious; middleIndex++) {
		hashToMiddleIndex.set(
			trackedPrevious[headPrevious + middleIndex].hash,
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
		const template = current[currentIndex];
		const relativeOffset = currentIndex - headCurrent;

		let claimedMiddleIndex = hashToMiddleIndex.get(template.hash);
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
			trackedPrevious[headPrevious + relativeOffset].parsedHTML ===
				template.parsedHTML
		) {
			claimedMiddleIndex = relativeOffset;
		}

		if (claimedMiddleIndex === undefined) {
			const listItemMarker = new Comment(LIST_IDENTIFIER);
			position.after(template.setup(), listItemMarker);
			position = listItemMarker;
			continue;
		}

		previousClaimed[claimedMiddleIndex] = 1;
		const reusedTemplate = trackedPrevious[headPrevious + claimedMiddleIndex];
		if (reusedTemplate.hash !== template.hash) {
			reusedTemplate.update(template.currentExpressions);
		}
		current[currentIndex] = reusedTemplate;

		const itemMarker = previousMarkers[headPrevious + claimedMiddleIndex];
		// Monotonic reuse (the steady state for "same list, values changed")
		// means the existing DOM is already in place — no need to walk
		// siblings to verify. Only reach for isAlreadyInPosition/moveItemAfter
		// when a reorder could have happened.
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

const renderTemplate = (
	context: HTMLTemplate,
	marker: Comment,
	expressionIndex: number,
) => {
	const current = context.currentExpressions[expressionIndex] as HTMLTemplate;
	const previous = context.previousExpressions[expressionIndex];

	//same template shape: feed the existing instance the new expressions and
	//swap the reference back into currentExpressions so the next diff sees it
	if (previous instanceof HTMLTemplate && isSameTemplate(current, previous)) {
		previous.update(current.currentExpressions);
		context.currentExpressions[expressionIndex] = previous;
		return;
	}

	//different shape: discard the old DOM and mount the new template fresh
	deleteNodesBetween(marker);
	marker.after(current.setup());
};

const renderComment = (
	context: HTMLTemplate,
	marker: Comment,
	bindingValues: Array<string | number>,
) => {
	deleteNodesBetween(marker);
	marker.after(
		new Comment(bindingToString(bindingValues, context.currentExpressions)),
	);
};

export const updateContent = (context: HTMLTemplate, bindingIndex: number) => {
	const binding = context.parsedHTML.bindings[bindingIndex];
	const marker = context.markers[bindingIndex];

	//HTML comment slots (e.g. `<!-- ${a}-${b} -->`) concatenate multiple expressions
	//into a single comment node; regular content slots always hold exactly one expression
	if (binding.values.length > 1) {
		renderComment(context, marker, binding.values);
		return;
	}

	const expressionIndex = binding.values[0] as number;
	const current = context.currentExpressions[expressionIndex];

	if (current == null) {
		deleteNodesBetween(marker);
		return;
	}

	if (current instanceof HTMLTemplate) {
		renderTemplate(context, marker, expressionIndex);
		return;
	}

	if (Array.isArray(current)) {
		renderList(context, marker, expressionIndex);
		return;
	}

	const renderableCurrent = assertPrimitiveString(current);
	const previous = context.previousExpressions[expressionIndex];

	if (previous === undefined) {
		marker.after(document.createTextNode(renderableCurrent));
		return;
	}

	if (isStringable(previous)) {
		(marker.nextSibling as Text).data = renderableCurrent;
		return;
	}

	deleteNodesBetween(marker);
	marker.after(document.createTextNode(renderableCurrent));
};
