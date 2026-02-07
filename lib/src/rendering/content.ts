import { descriptorToString } from "../utils/descriptor-to-string";
import { hashValue } from "../utils/hashing";
import { toPrimitive } from "../utils/to-primitive";
import { HTMLTemplate } from "./template-html";

export const OPERATION_TYPES = {
	ADD: 1,
	DELETE: 2,
	REPLACE: 3,
	SWAP: 4,
} as const;

/*
conceptually, we have 2 lists of elements and we want to compare them to find the least amount of moves to match them
We do this by mutating the old list until and generate patches. This way we dont have to deal with shifting indices

We iterate the lists and compare elements. Depending on the outcome we increment the indices or move on (when we delete entries)

*/
const diff = (oldList: Array<HTMLTemplate>, newList: Array<HTMLTemplate>) => {
	const oldHashes = new Set(oldList.map(hashValue));
	const newHashes = new Set(newList.map(hashValue));

	const current = oldList.map(hashValue);
	const operations = [];

	let oldIndex = 0;
	let newIndex = 0;

	while (oldIndex < current.length || newIndex < newList.length) {
		const currentHash = oldIndex < current.length ? current[oldIndex] : null;
		const newHash =
			newIndex < newList.length ? hashValue(newList[newIndex]) : null;

		if (currentHash === null && newHash === null) {
			break;
		}

		if (currentHash === newHash) {
			oldIndex++;
			newIndex++;
			continue;
		}

		if (currentHash === null) {
			operations.push({ index: newIndex, type: OPERATION_TYPES.ADD });
			newIndex++;
			continue;
		}

		if (newHash === null) {
			operations.push({ index: oldIndex, type: OPERATION_TYPES.DELETE });
			oldIndex++;
			continue;
		}

		const newExistsInOld = oldHashes.has(newHash);
		const currentExistsInNew = newHashes.has(currentHash);

		if (!currentExistsInNew) {
			operations.push({ index: oldIndex, type: OPERATION_TYPES.DELETE });
			current.splice(oldIndex, 1);
			continue;
		}

		if (!newExistsInOld) {
			//this is a special case to help with the shifting indices problem. It could also be an add and remove
			if (newList.length === operations.length) {
				operations.push({ index: newIndex, type: OPERATION_TYPES.REPLACE });
				current[oldIndex] = newHash;
			} else {
				operations.push({ index: newIndex, type: OPERATION_TYPES.ADD });
				current.splice(oldIndex, 0, newHash);
			}

			oldIndex++;
			newIndex++;
			continue;
		}

		const swapTarget = current.indexOf(newHash, oldIndex + 1);
		operations.push({
			index: oldIndex,
			type: OPERATION_TYPES.SWAP,
			with: swapTarget,
		});
		[current[oldIndex], current[swapTarget]] = [
			current[swapTarget],
			current[oldIndex],
		];
		oldIndex++;
		newIndex++;
	}

	return operations;
};

const collectMarker = (listMarker: Comment) => {
	const markers: Array<{ start: Comment; end: Comment }> = [];

	let current = listMarker.nextSibling;
	let start: Comment | null = null;
	while (current) {
		if (current.nodeType !== Node.COMMENT_NODE) {
			current = current.nextSibling;
			continue;
		}

		if ((current as Comment).data === listMarker.data) {
			break;
		}

		if (start?.data === (current as Comment).data) {
			markers.push({ start, end: current as Comment });
			start = null;
			current = current.nextSibling;
			continue;
		}

		start = current as Comment;
		current = current.nextSibling;
	}

	return markers;
};

const getNodesBetween = (start: Node, end: Node) => {
	const nodes = [];

	let current = start.nextSibling;
	while (current && current !== end) {
		nodes.push(current);
		current = current.nextSibling;
	}
	return nodes;
};

const deleteNodesBetween = (start: Node, end?: Node) => {
	let current = start.nextSibling;

	while (current) {
		const isComment = current.nodeType === Node.COMMENT_NODE;
		const isLastComment =
			current === end ||
			(isComment && (current as Comment)?.data === (start as Comment).data);

		if (isLastComment) {
			break;
		}

		const next = current.nextSibling;
		current.remove();
		current = next;
	}
};

const renderList = (
	context: HTMLTemplate,
	marker: Comment,
	expressionIndex: number,
) => {
	const current = context.currentExpressions[
		expressionIndex
	] as Array<HTMLTemplate>;
	const previous = context.previousExpressions[expressionIndex];

	let oldList = [];
	if (Array.isArray(previous)) {
		oldList = previous;
	} else if (previous) {
		oldList.push(previous);
	}

	const operations = diff(oldList, current);
	const markers = collectMarker(marker);

	for (const operation of operations) {
		if (operation.type === OPERATION_TYPES.ADD) {
			const start = new Comment("list" + operation.index);
			const end = new Comment("list" + operation.index);
			const content = (current[operation.index] as HTMLTemplate).setup();

			const insertAfter = markers[operation.index - 1]?.end || marker;
			insertAfter.after(start, content, end);
			markers.splice(operation.index, 0, { start, end });
		} else if (operation.type === OPERATION_TYPES.REPLACE) {
			//todo: we need to investigate if it makes sense to update the template instead of moving dom nodes

			const marker = markers[operation.index];
			deleteNodesBetween(marker.start, marker.end);
			const content = (current[operation.index] as HTMLTemplate).setup();
			marker.start.after(content);
		} else if (operation.type === OPERATION_TYPES.DELETE) {
			const marker = markers[operation.index];
			deleteNodesBetween(marker.start, marker.end);
			marker.start.remove();
			marker.end.remove();
			markers.splice(operation.index, 1);
		} else if (operation.type === OPERATION_TYPES.SWAP) {
			//todo: we need to investigate if it makes sense to update the template instead of moving dom nodes
			const markerA = markers[operation.index];
			const markerB = markers[operation.with!];
			const nodesA = getNodesBetween(markerA.start, markerA.end);
			const nodesB = getNodesBetween(markerB.start, markerB.end);
			markerA.start.after(...nodesB);
			markerB.start.after(...nodesA);
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

	if (
		previous instanceof HTMLTemplate &&
		previous.parsedHTML.templateHash === current.parsedHTML.templateHash
	) {
		//if they do, we can update the old one just with new dynamic values
		previous.update(current.currentExpressions);
		//to not lose the reference we need to keep it in the currentValeus
		context.currentExpressions[expressionIndex] = previous;
		return;
	}

	deleteNodesBetween(marker);
	marker.after(current.setup());
	//otherwise we delete the old dom and render again
	return;
};

const renderComment = (
	context: HTMLTemplate,
	marker: Comment,
	descriptorValues: Array<string | number>,
) => {
	deleteNodesBetween(marker);
	marker.after(
		new Comment(
			descriptorToString(descriptorValues, context.currentExpressions),
		),
	);
};

export const updateContent = (context: HTMLTemplate, bindingIndex: number) => {
	const descriptor = context.parsedHTML.descriptors[bindingIndex];
	const marker = context.markers[bindingIndex];

	//only true for comments
	if (descriptor.values.length > 1) {
		renderComment(context, marker, descriptor.values);
		return;
	}

	const expressionIndex = descriptor.values[0] as number;
	const current = context.currentExpressions[expressionIndex];

	if (current instanceof HTMLTemplate) {
		renderTemplate(context, marker, expressionIndex);
		return;
	}

	if (Array.isArray(current)) {
		renderList(context, marker, expressionIndex);
		return;
	}

	deleteNodesBetween(marker);
	marker.after(document.createTextNode(toPrimitive(current)));
};
