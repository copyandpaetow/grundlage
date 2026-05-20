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

//"expandable" means the binding is a single expression in attribute-key position with no value half (e.g. `<div ${attrs}>`)
//=> the expression can be an array of names, an object of name/value pairs, or a string name
const isExpandableBinding = (binding: AttributeBinding) =>
	binding.values.length === 0 &&
	binding.keys.length === 1 &&
	typeof binding.keys[0] === "number";

//removes every attribute name this binding represents under the given expressions snapshot
//we want one place that knows how each binding form (static, multi-part dynamic, expandable array/object/string, boolean) maps to attribute names so the apply path and the cleanup paths can't drift
export const removeAttributeBinding = (
	element: Element,
	binding: AttributeBinding,
	expressions: Array<unknown>,
) => {
	if (isExpandableBinding(binding)) {
		const value = expressions[binding.keys[0] as number];
		if (Array.isArray(value)) {
			for (let index = 0; index < value.length; index++) {
				applyAttributeBinding(element, value[index], null);
			}
		} else if (isPlainObject(value)) {
			for (const name in value) {
				applyAttributeBinding(
					element,
					name,
					null,
					value[name as keyof typeof value],
				);
			}
		} else if (value) {
			applyAttributeBinding(element, assertPrimitiveString(value), null);
		}
		return;
	}

	const isStaticName =
		binding.keys.length === 1 && typeof binding.keys[0] === "string";
	const name = isStaticName
		? (binding.keys[0] as string)
		: bindingToString(binding.keys, expressions);

	const previousExpression =
		binding.values.length === 1 && typeof binding.values[0] === "number"
			? expressions[binding.values[0] as number]
			: undefined;

	applyAttributeBinding(element, name, null, previousExpression);
};

const handleExpandableAttribute = (
	context: HTMLTemplate,
	element: Element,
	binding: AttributeBinding,
	previousExpressions: Array<unknown>,
) => {
	removeAttributeBinding(element, binding, previousExpressions);

	const current = context.currentExpressions[binding.keys[0] as number];
	if (Array.isArray(current)) {
		for (let index = 0; index < current.length; index++) {
			applyAttributeBinding(element, current[index], "");
		}
	} else if (isPlainObject(current)) {
		for (const name in current) {
			applyAttributeBinding(
				element,
				name,
				current[name as keyof typeof current],
			);
		}
	} else if (current) {
		applyAttributeBinding(element, assertPrimitiveString(current), "");
	}
};

export const updateAttribute = (context: HTMLTemplate, index: number) => {
	const element = context.targets[index] as Element;
	const binding = context.parsedHTML.bindings[index] as AttributeBinding;

	const isBooleanAttribute = binding.values.length === 0;

	//on the very first render previousExpressions is empty, so any `previousExpressions[index]` lookup downstream would be undefined, and we'd need a special-case branch everywhere
	//=> we point it at currentExpressions instead, which makes every "did this change" comparison look unchanged — exactly what we want on the initial render
	const previousExpressions =
		context.previousExpressions.length > 0
			? context.previousExpressions
			: context.currentExpressions;

	if (isBooleanAttribute && isExpandableBinding(binding)) {
		handleExpandableAttribute(context, element, binding, previousExpressions);
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
			removeAttributeBinding(element, binding, previousExpressions);
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
		removeAttributeBinding(element, binding, previousExpressions);
	}

	applyAttributeBinding(element, currentName, currentValue, previousExpression);
};
