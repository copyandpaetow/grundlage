import { html } from "../parser/html";
import { bindingToString } from "../utils/binding-to-string";
import { isStringable, toPrimitive } from "../utils/to-primitive";
import { isComment, isSameTemplate } from "../utils/validators";
import { HTMLTemplate } from "./template-html";

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

const LIST_IDENTIFIER = "*.*";

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

	const hashPositions = new Map<number, Comment>();
	const previousMarkers = [];

	let index = 0;
	let element: Node | null = marker;
	while ((element = element.nextSibling)) {
		if (!isComment(element) || !element.data.startsWith(LIST_IDENTIFIER))
			continue;
		if (element.data === marker.data) break;

		const hash = previous[index].hash;

		hashPositions.set(hash, element);
		previousMarkers.push(element);
		index++;
	}

	let position: Element | Comment | null = marker;

	for (let index = 0; index < current.length; index++) {
		const template = current[index];
		const currentHashExists = hashPositions.get(template.hash);

		if (currentHashExists) {
			hashPositions.delete(template.hash);
			if (previousMarkers[index] === currentHashExists) {
				position = currentHashExists;
				continue;
			}
			let moveableElement: Element | Comment | null = currentHashExists;
			while (moveableElement) {
				let prev = moveableElement.previousSibling as Element | Comment;
				position.after(moveableElement);

				if (isComment(prev) && prev.data.startsWith(LIST_IDENTIFIER)) {
					position = currentHashExists;
					break;
				}

				moveableElement = prev;
			}
		} else {
			const listItemMarker = new Comment(LIST_IDENTIFIER);
			position.after(template.setup(), listItemMarker);
			position = listItemMarker;
		}
	}

	for (const entry of hashPositions) {
		let start: Element | Comment = entry[1];

		while (start) {
			let prev = start.previousSibling as Element | Comment;
			start.remove();
			if (isComment(prev) && prev.data.startsWith(LIST_IDENTIFIER)) break;
			start = prev;
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

	const renderableCurrent = toPrimitive(current);
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
