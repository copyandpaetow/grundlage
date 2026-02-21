import { AttributeBinding } from "../parser/types";
import { BaseComponent } from "../types";
import { bindingToString } from "../utils/binding-to-string";
import { toPrimitive } from "../utils/to-primitive";
import { isObject } from "../utils/validators";
import { HTMLTemplate } from "./template-html";

const isEventListener = (key: string, value: unknown) => {
	if (typeof value !== "function") {
		return false;
	}
	return key.startsWith("on");
};

const addAttribute = (element: Element, key: string, value: unknown) => {
	if (isEventListener(key, value)) {
		const event = key.slice(2).toLowerCase() as keyof HTMLElementEventMap;
		element.addEventListener(event, value as EventListener);
		return;
	}

	customElements.upgrade(element);
	if ("setProperty" in element) {
		(element as BaseComponent).setProperty(key, value);
		return;
	}

	if (value === null || value === undefined || value === false) {
		return;
	}

	element.setAttribute(key, String(value));
};

const removeAttribute = (element: Element, key: string, value?: unknown) => {
	if (isEventListener(key, value)) {
		const event = key.slice(2).toLowerCase() as keyof HTMLElementEventMap;
		element?.removeEventListener(event, value as EventListener);
		return;
	}

	if ("setProperty" in element) {
		(element as BaseComponent).setProperty(key, undefined);
		return;
	}

	element.removeAttribute(key);
};

const handleExpandableAttribute = (
	context: HTMLTemplate,
	element: Element,
	index: number,
) => {
	const current = context.currentExpressions[index];
	const previous = context.previousExpressions[index];

	if (Array.isArray(previous)) {
		for (const name of previous) {
			removeAttribute(element, name);
		}
	} else if (isObject(previous)) {
		for (const name in previous) {
			removeAttribute(element, name, previous[name as keyof typeof previous]);
		}
	} else if (previous) {
		removeAttribute(element, toPrimitive(previous));
	}

	if (Array.isArray(current)) {
		for (const name of current) {
			addAttribute(element, name, "");
		}
	} else if (isObject(current)) {
		for (const name in current) {
			addAttribute(element, name, current[name as keyof typeof previous]);
		}
	} else if (current) {
		addAttribute(element, toPrimitive(current), "");
	}
};

export const updateAttribute = (context: HTMLTemplate, index: number) => {
	const element = context.markers[index].nextElementSibling!;
	const binding = context.parsedHTML.bindings[index] as AttributeBinding;

	const isBooleanAttribute = binding.values.length === 0;
	const isExpandable = binding.keys.length === 1;

	if (isBooleanAttribute && isExpandable) {
		handleExpandableAttribute(context, element, binding.keys[0] as number);
		return;
	}
	const previousName = bindingToString(
		binding.keys,
		context.previousExpressions,
	);
	const currentName = bindingToString(binding.keys, context.currentExpressions);

	if (isBooleanAttribute) {
		removeAttribute(element, previousName);
		addAttribute(element, currentName, "");
		return;
	}

	const currentExpression =
		context.currentExpressions[binding.values[0] as number];

	const currentValue = isEventListener(currentName, currentExpression)
		? currentExpression
		: bindingToString(binding.values, context.currentExpressions);

	if (previousName !== currentName) {
		const previousExpression =
			context.previousExpressions[binding.values[0] as number];
		removeAttribute(element, previousName, previousExpression);
	}

	addAttribute(element, currentName, currentValue);
};
