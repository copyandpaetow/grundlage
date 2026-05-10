import { AttributeBinding } from "../parser/types";
import { BaseComponent } from "../types";
import { bindingToString } from "../utils/binding-to-string";
import { assertPrimitiveString, isStringable } from "../utils/to-primitive";
import { isPlainObject } from "../utils/validators";
import { HTMLTemplate } from "./template-html";

//event-handler attributes always start with "on" (onclick, onsubmit, …)
//=> we sniff the first two char codes ('o' = 111, 'n' = 110) instead of `key.startsWith("on")` so we avoid allocating a substring on every attribute write
const CHAR_LOWER_O = 111;
const CHAR_LOWER_N = 110;

export const applyAttributeBinding = (
	element: Element,
	key: string,
	value: unknown,
	oldValue?: unknown,
) => {
	//Static class/id/data-* attributes never carry function values, so bail before touching the key.
	const valueIsFunction = typeof value === "function";
	const oldValueIsFunction = typeof oldValue === "function";
	if (valueIsFunction || oldValueIsFunction) {
		if (
			key.charCodeAt(0) === CHAR_LOWER_O &&
			key.charCodeAt(1) === CHAR_LOWER_N
		) {
			const lowerKey = key.toLowerCase();
			if (lowerKey in element) {
				const eventName = lowerKey.slice(2);
				if (oldValueIsFunction) {
					element.removeEventListener(eventName, oldValue as EventListener);
				}
				if (valueIsFunction) {
					element.addEventListener(eventName, value as EventListener);
				}
				return;
			}
		}
	}

	if (value === null || value === undefined || value === false) {
		element.removeAttribute(key);
		return;
	}

	if (isStringable(value)) {
		if (oldValue !== undefined && !isStringable(oldValue)) {
			//the previous value was non-stringable, so we wrote it as a JS property on the element (see the else branch below)
			//=> now that we're switching to a stringable value we need to delete that property, otherwise the JS property would shadow the html attribute we're about to set
			delete (element as any)[key];
		}
		element.setAttribute(key, String(value));
	} else {
		// @ts-expect-error - dynamic property assignment for complex (non-stringable) values passed via template bindings
		element[key] = value;

		if ("update" in element) {
			(element as BaseComponent).update();
		}
	}
};

const handleExpandableAttribute = (
	context: HTMLTemplate,
	element: Element,
	index: number,
	previousExpressions: Array<unknown>,
) => {
	const current = context.currentExpressions[index];
	const previous = previousExpressions[index];

	if (Array.isArray(previous)) {
		for (let index = 0; index < previous.length; index++) {
			applyAttributeBinding(element, previous[index], null);
		}
	} else if (isPlainObject(previous)) {
		for (const name in previous) {
			applyAttributeBinding(
				element,
				name,
				null,
				previous[name as keyof typeof previous],
			);
		}
	} else if (previous) {
		applyAttributeBinding(element, assertPrimitiveString(previous), null);
	}

	if (Array.isArray(current)) {
		for (let index = 0; index < current.length; index++) {
			applyAttributeBinding(element, current[index], "");
		}
	} else if (isPlainObject(current)) {
		for (const name in current) {
			applyAttributeBinding(
				element,
				name,
				current[name as keyof typeof previous],
			);
		}
	} else if (current) {
		applyAttributeBinding(element, assertPrimitiveString(current), "");
	}
};

export const updateAttribute = (context: HTMLTemplate, index: number) => {
	const element = context.markers[index].nextElementSibling!;
	const binding = context.parsedHTML.bindings[index] as AttributeBinding;

	const isBooleanAttribute = binding.values.length === 0;
	//"expandable" means the binding is a single expression in attribute-key position with no value half (e.g. `<div ${attrs}>`)
	//the expression can be an array of names, an object of name/value pairs, or a string name
	//=> handleExpandableAttribute fans it out into individual attribute writes for us
	const isExpandable = binding.keys.length === 1;

	//on the very first render previousExpressions is empty, so any `previousExpressions[index]` lookup downstream would be undefined, and we'd need a special-case branch everywhere
	//=> we point it at currentExpressions instead, which makes every "did this change" comparison look unchanged — exactly what we want on the initial render
	const previousExpressions =
		context.previousExpressions.length > 0
			? context.previousExpressions
			: context.currentExpressions;

	if (isBooleanAttribute && isExpandable) {
		handleExpandableAttribute(
			context,
			element,
			binding.keys[0] as number,
			previousExpressions,
		);
		return;
	}

	const isStaticName =
		binding.keys.length === 1 && typeof binding.keys[0] === "string";
	const currentName = isStaticName
		? (binding.keys[0] as string)
		: bindingToString(binding.keys, context.currentExpressions);
	const previousName = isStaticName
		? currentName
		: bindingToString(binding.keys, previousExpressions);

	if (isBooleanAttribute) {
		if (!isStaticName) {
			applyAttributeBinding(element, previousName, null);
		}
		applyAttributeBinding(element, currentName, "");
		return;
	}

	const isSingleExpression =
		binding.values.length === 1 && typeof binding.values[0] === "number";

	const previousExpression = isSingleExpression
		? previousExpressions[binding.values[0] as number]
		: undefined;

	const currentValue: unknown = isSingleExpression
		? context.currentExpressions[binding.values[0] as number]
		: bindingToString(binding.values, context.currentExpressions);

	if (previousName !== currentName) {
		applyAttributeBinding(element, previousName, null, previousExpression);
	}

	applyAttributeBinding(element, currentName, currentValue, previousExpression);
};
