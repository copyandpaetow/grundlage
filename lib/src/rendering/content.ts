import { html } from "../parser/html";
import { bindingToString } from "../utils/binding-to-string";
import { assertPrimitiveString, isStringable } from "../utils/to-primitive";
import { isComment, isSameTemplate } from "../utils/validators";
import { HTMLTemplate } from "./template-html";

const deleteNodesBetween = (start: Node, end?: Node) => {
	let current = start.nextSibling;

	while (current) {
		//each content binding is bracketed by two comments with the same data
		//=> when we hit another comment carrying `start`'s data we've reached the binding's far edge and can stop
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

//we wrap non-template entries in place rather than allocating a new array. renderList already walks every entry several times (peel, hash map, claim loop), so cutting one array allocation per render matters on large lists
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

	//we walk the live DOM once and collect one marker per item that's currently rendered
	//the DOM is the source of truth here. if it has fewer items than trackedPrevious (e.g. someone cleared the binding's children between renders) we cap collection at what we actually see
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

	/*
	before tackling the harder reconciliation we peel matching templates from both ends inwards
	hash-equal templates are interchangeable (the hash folds template shape + expression values) so any item we match at the head or tail can stay exactly where it already is in the DOM
	=> append, prepend, pop, shift, and adjacent-swap all resolve in this phase without touching the DOM
	*/
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
			const listItemMarker = new Comment(LIST_IDENTIFIER);
			position.after(current[currentIndex].setup(null), listItemMarker);
			position = listItemMarker;
		}
		return;
	}

	/*
	otherwise both middles have content, and we need to reconcile them
	we walk the current middle and try to claim a previous slot for each entry:
	- first by hash (template shape + expression values match exactly => DOM stays, no .update() needed)
	- otherwise by parsed shape at the same relative position (DOM stays, we .update() it to the new expression values)
	- otherwise we insert a fresh item
	hash and structural claims share the same walk, so a structural claim for current[earlyIndex] can occasionally take a slot that a later current[laterIndex] would have hash-matched
	=> the output still stays correct (the reused template gets .update()d to current[laterIndex]) and the worst case is one extra .update() call in a pathological cross-pattern
	*/
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
			position.after(template.setup(null), listItemMarker);
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

const renderTemplate = (
	context: HTMLTemplate,
	marker: Comment,
	expressionIndex: number,
) => {
	const current = context.currentExpressions[expressionIndex] as HTMLTemplate;
	const previous = context.previousExpressions[expressionIndex];

	if (previous instanceof HTMLTemplate && isSameTemplate(current, previous)) {
		previous.update(current.currentExpressions);
		//we swap the reused template into currentExpressions so that on the next render
		//we compare against the template actually attached to the DOM and not the discarded `current`
		context.currentExpressions[expressionIndex] = previous;
		return;
	}

	deleteNodesBetween(marker);
	marker.after(current.setup(null));
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
	const marker = context.targets[bindingIndex] as Comment;

	//only comments can have multiple bindings, normal content only has one
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

	//previous was a template or list, so non-text nodes sit after the marker. clear them before inserting the text node
	deleteNodesBetween(marker);
	marker.after(document.createTextNode(renderableCurrent));
};
