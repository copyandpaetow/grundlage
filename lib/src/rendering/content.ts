import { bindingToString } from "../utils/binding-to-string";
import { assertPrimitiveString, isStringable } from "../utils/to-primitive";
import { isComment, isSameTemplate } from "../utils/validators";
import { EMPTY_EXPRESSIONS } from "./empty-expressions";
import { renderList } from "./list";
import {
	HTMLTemplate,
	isTemplate,
	setupTemplate,
	updateTemplate,
} from "./template-html";

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

const renderTemplate = (
	context: HTMLTemplate,
	marker: Comment,
	expressionIndex: number,
) => {
	const current = context.currentExpressions[expressionIndex] as HTMLTemplate;
	const previous = context.previousExpressions[expressionIndex];

	if (isTemplate(previous) && isSameTemplate(current, previous)) {
		updateTemplate(previous, current.currentExpressions);
		//we swap the reused template into currentExpressions so that on the next render
		//we compare against the template actually attached to the DOM and not the discarded `current`
		context.currentExpressions[expressionIndex] = previous;
		return;
	}

	deleteNodesBetween(marker);
	marker.after(setupTemplate(current, null));
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

	if (isTemplate(current)) {
		renderTemplate(context, marker, expressionIndex);
		return;
	}

	if (Array.isArray(current)) {
		renderList(context, marker, expressionIndex);
		return;
	}

	const renderableCurrent = assertPrimitiveString(current);

	//first render: previousExpressions is the shared sentinel, so no text node exists here yet — insert one
	if (context.previousExpressions === EMPTY_EXPRESSIONS) {
		marker.after(document.createTextNode(renderableCurrent));
		return;
	}

	const previous = context.previousExpressions[expressionIndex];

	if (isStringable(previous)) {
		(marker.nextSibling as Text).data = renderableCurrent;
		return;
	}

	//previous was a template or list, so non-text nodes sit after the marker. clear them before inserting the text node
	deleteNodesBetween(marker);
	marker.after(document.createTextNode(renderableCurrent));
};
