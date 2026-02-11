import { html } from "../parser/html";
import { bindingToString } from "../utils/binding-to-string";
import { hashValue } from "../utils/hashing";
import { toPrimitive } from "../utils/to-primitive";
import { isComment, isSameTemplate } from "../utils/validators";
import { HTMLTemplate } from "./template-html";

type SwapOperation = {
	type: (typeof OPERATION_TYPES)["SWAP"];
	index: number;
	with: number;
};

type AddOperation = {
	type: (typeof OPERATION_TYPES)["ADD"];
	index: number;
};

type ReplaceOperation = {
	type: (typeof OPERATION_TYPES)["REPLACE"];
	index: number;
};

type DeleteOperation = {
	type: (typeof OPERATION_TYPES)["DELETE"];
	index: number;
};

type Operation =
	| SwapOperation
	| AddOperation
	| ReplaceOperation
	| DeleteOperation;

export const OPERATION_TYPES = {
	ADD: 1,
	DELETE: 2,
	REPLACE: 3,
	SWAP: 4,
} as const;

const LIST_IDENTIFIER = "list";

/*
conceptually, we have 2 lists of elements and we want to compare them to find the least amount of moves to match them
We do this by mutating the old list until and generate patches. This way we dont have to deal with shifting indices

We iterate the lists and compare elements. Depending on the outcome we increment the indices or move on (when we delete entries)

*/
const diff = (
	oldList: Array<HTMLTemplate>,
	newList: Array<HTMLTemplate>,
): Array<Operation> => {
	const operations: Array<Operation> = [];
	const current = oldList.map(hashValue);
	const oldHashes = new Set(current);
	const newHashes = new Set(newList.map(hashValue));

	if (oldHashes.size !== oldList.length || newHashes.size !== newList.length) {
		console.warn(
			"identical templates and contents are used here. This may lead to errors with the list rendering. Some change to either the content or the template needs to make each entry unique",
		);
	}

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
			//this is a special case to help with the shifting indices problem. It could also be an add and remove but this is only have the operations
			if (newList.length === current.length) {
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
	const markers: Array<Comment> = [];

	let current = listMarker.nextSibling;
	while (current) {
		if (!isComment(current) || !current.data.startsWith(LIST_IDENTIFIER)) {
			current = current.nextSibling;
			continue;
		}

		if (current.data === listMarker.data) {
			break;
		}

		markers.push(current);
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
		const isLastComment =
			current === end || (isComment(current) && current.isEqualNode(start));

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

const renderList = (
	context: HTMLTemplate,
	marker: Comment,
	expressionIndex: number,
) => {
	const previousValue = context.previousExpressions[expressionIndex];
	const current = toTemplateList(
		context.currentExpressions[expressionIndex] as Array<unknown>,
	);
	const previous = toTemplateList(
		Array.isArray(previousValue) ? previousValue : [],
	);

	const operations = diff(previous, current);

	if (!Array.isArray(previousValue)) {
		deleteNodesBetween(marker);
	}
	const markers = collectMarker(marker);

	for (const operation of operations) {
		if (operation.type === OPERATION_TYPES.ADD) {
			const listMarker = new Comment(LIST_IDENTIFIER + operation.index);

			(markers[operation.index - 1] || marker).after(
				current[operation.index].setup(),
				listMarker,
			);
			markers.splice(operation.index, 0, listMarker);
		} else if (operation.type === OPERATION_TYPES.REPLACE) {
			const currentContent = current[operation.index];
			const previousContent = previous[operation.index];

			if (isSameTemplate(currentContent, previousContent)) {
				previousContent.update(currentContent.currentExpressions);
				current[operation.index] = previous[operation.index];
			} else {
				deleteNodesBetween(
					markers[operation.index - 1] || marker,
					markers[operation.index],
				);
				markers[operation.index].after(current[operation.index].setup());
			}
		} else if (operation.type === OPERATION_TYPES.DELETE) {
			deleteNodesBetween(
				markers[operation.index - 1] || marker,
				markers[operation.index],
			);
			markers[operation.index].remove();
			markers.splice(operation.index, 1);
		} else if (operation.type === OPERATION_TYPES.SWAP) {
			const nodesA = getNodesBetween(
				markers[operation.index - 1] || marker,
				markers[operation.index],
			);
			const nodesB = getNodesBetween(
				markers[operation.with - 1] || marker,
				markers[operation.with],
			);
			(markers[operation.index - 1] || marker).after(...nodesB);
			(markers[operation.with - 1] || marker).after(...nodesA);
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

	//only true for comments
	if (binding.values.length > 1) {
		renderComment(context, marker, binding.values);
		return;
	}

	const expressionIndex = binding.values[0] as number;
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
