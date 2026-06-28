import {
	ATTRIBUTE_NAME_KIND,
	ATTRIBUTE_SHAPE,
	AttributeBinding,
	ValueOf,
} from "../parser/types";
import { BaseComponent } from "../types";
import { bindingToString } from "../utils/binding-to-string";
import { assertPrimitiveString, isStringable } from "../utils/to-primitive";
import { isPlainObject } from "../utils/validators";
import { EMPTY_EXPRESSIONS } from "./empty-expressions";
import { HTMLTemplate } from "./template-html";

const CHAR_LOWER_O = 111;
const CHAR_LOWER_N = 110;
const CHAR_DASH = 45;

const resolveEventNameFromKey = (
	key: string,
	element: Element,
): string | null => {
	if (
		key.charCodeAt(0) !== CHAR_LOWER_O ||
		key.charCodeAt(1) !== CHAR_LOWER_N
	) {
		return null;
	}
	if (key.charCodeAt(2) === CHAR_DASH) {
		return key.slice(3).toLowerCase();
	}
	const lowerKey = key.toLowerCase();
	return lowerKey in element ? lowerKey.slice(2) : null;
};

const warnIfDeadNativeHandler = (key: string, element: Element) => {
	if (
		key.charCodeAt(0) !== CHAR_LOWER_O ||
		key.charCodeAt(1) !== CHAR_LOWER_N
	) {
		return;
	}
	if (key.charCodeAt(2) === CHAR_DASH) return;
	const lowerKey = key.toLowerCase();
	if (lowerKey in element) return;
	console.warn(
		`grundlage: "${key}" looks like an event handler but "${lowerKey}" is not a property of <${element.localName}> — the function was assigned as a dead property and will never fire. Check the spelling, or use "on-${key.slice(2).toLowerCase()}" to bind it as a custom event.`,
	);
};

export const applyAttributeBinding = (
	element: Element,
	key: string,
	value: unknown,
	oldValue?: unknown,
	nameKind: ValueOf<typeof ATTRIBUTE_NAME_KIND> = ATTRIBUTE_NAME_KIND.UNKNOWN,
	eventName = "",
) => {
	const valueIsFunction = typeof value === "function";
	const oldValueIsFunction = typeof oldValue === "function";
	if (valueIsFunction || oldValueIsFunction) {
		let listenerName: string | null = null;
		switch (nameKind) {
			case ATTRIBUTE_NAME_KIND.EXPLICIT_EVENT:
				listenerName = eventName;
				break;
			case ATTRIBUTE_NAME_KIND.NATIVE_EVENT:
				if ("on" + eventName in element) listenerName = eventName;
				break;
			case ATTRIBUTE_NAME_KIND.PLAIN:
				break;
			case ATTRIBUTE_NAME_KIND.UNKNOWN:
				listenerName = resolveEventNameFromKey(key, element);
				break;
		}
		if (listenerName !== null) {
			if (oldValueIsFunction) {
				element.removeEventListener(listenerName, oldValue as EventListener);
			}
			if (valueIsFunction) {
				element.addEventListener(listenerName, value as EventListener);
			}
			return;
		}
		if (valueIsFunction) warnIfDeadNativeHandler(key, element);
	}

	if (value === null || value === undefined || value === false) {
		element.removeAttribute(key);
		return;
	}

	if (isStringable(value)) {
		if (oldValue !== undefined && !isStringable(oldValue)) {
			delete (element as any)[key];
		}
		element.setAttribute(key, String(value));
	} else {
		element[key] = value;

		if ("update" in element) {
			(element as BaseComponent).update();
		}
	}
};

const removeExpandable = (
	element: Element,
	binding: AttributeBinding,
	expressions: Array<unknown>,
) => {
	const value = expressions[binding.values[0] as number];
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
};

const applyExpandable = (element: Element, value: unknown) => {
	if (Array.isArray(value)) {
		for (let arrayIndex = 0; arrayIndex < value.length; arrayIndex++) {
			applyAttributeBinding(element, value[arrayIndex], "");
		}
	} else if (isPlainObject(value)) {
		for (const name in value) {
			applyAttributeBinding(element, name, value[name as keyof typeof value]);
		}
	} else if (value) {
		applyAttributeBinding(element, assertPrimitiveString(value), "");
	}
};

const diffExpandableObjects = (
	element: Element,
	previous: Record<string, unknown>,
	current: Record<string, unknown>,
) => {
	for (const name in current) {
		const newValue = current[name];
		const hadName = name in previous;
		const oldValue = hadName ? previous[name] : undefined;
		if (hadName && oldValue === newValue) continue;
		applyAttributeBinding(element, name, newValue, oldValue);
	}
	for (const name in previous) {
		if (!(name in current)) {
			applyAttributeBinding(element, name, null, previous[name]);
		}
	}
};

type AttributeShapeHandler = {
	write: (context: HTMLTemplate, index: number) => void;
	remove: (
		element: Element,
		binding: AttributeBinding,
		expressions: Array<unknown>,
	) => void;
};

const removeStaticName = (element: Element, binding: AttributeBinding) =>
	applyAttributeBinding(element, binding.keys[0] as string, null);

const removeDynamicName = (
	element: Element,
	binding: AttributeBinding,
	expressions: Array<unknown>,
) =>
	applyAttributeBinding(
		element,
		bindingToString(binding.keys, expressions),
		null,
	);

const staticAttr: AttributeShapeHandler = {
	write: (context, index) => {
		const binding = context.parsedHTML.bindings[index] as AttributeBinding;
		const element = context.targets[index] as Element;
		const value =
			binding.values.length === 0 ? "" : (binding.values[0] as string);
		applyAttributeBinding(element, binding.keys[0] as string, value);
	},
	remove: removeStaticName,
};

const staticNameSingleValueAttr: AttributeShapeHandler = {
	write: (context, index) => {
		const binding = context.parsedHTML.bindings[index] as AttributeBinding;
		const element = context.targets[index] as Element;
		const expressionIndex = binding.values[0] as number;
		const previousExpression =
			context.previousExpressions !== EMPTY_EXPRESSIONS
				? context.previousExpressions[expressionIndex]
				: undefined;
		applyAttributeBinding(
			element,
			binding.keys[0] as string,
			context.currentExpressions[expressionIndex],
			previousExpression,
			binding.nameKind,
			binding.eventName,
		);
	},
	remove: (element, binding, expressions) =>
		applyAttributeBinding(
			element,
			binding.keys[0] as string,
			null,
			expressions[binding.values[0] as number],
			binding.nameKind,
			binding.eventName,
		),
};

const staticNameMultiValueAttr: AttributeShapeHandler = {
	write: (context, index) => {
		const binding = context.parsedHTML.bindings[index] as AttributeBinding;
		const element = context.targets[index] as Element;
		applyAttributeBinding(
			element,
			binding.keys[0] as string,
			bindingToString(binding.values, context.currentExpressions),
		);
	},
	remove: removeStaticName,
};

const dynamicNameBooleanAttr: AttributeShapeHandler = {
	write: (context, index) => {
		const binding = context.parsedHTML.bindings[index] as AttributeBinding;
		const element = context.targets[index] as Element;
		const currentName = bindingToString(
			binding.keys,
			context.currentExpressions,
		);
		if (context.previousExpressions !== EMPTY_EXPRESSIONS) {
			const previousName = bindingToString(
				binding.keys,
				context.previousExpressions,
			);
			if (previousName !== currentName) {
				element.removeAttribute(previousName);
			}
		}
		applyAttributeBinding(element, currentName, "");
	},
	remove: removeDynamicName,
};

const dynamicNameSingleValueAttr: AttributeShapeHandler = {
	write: (context, index) => {
		const binding = context.parsedHTML.bindings[index] as AttributeBinding;
		const element = context.targets[index] as Element;
		const expressionIndex = binding.values[0] as number;
		const currentName = bindingToString(
			binding.keys,
			context.currentExpressions,
		);
		const hasPrevious = context.previousExpressions !== EMPTY_EXPRESSIONS;
		const previousExpression = hasPrevious
			? context.previousExpressions[expressionIndex]
			: undefined;
		if (hasPrevious) {
			const previousName = bindingToString(
				binding.keys,
				context.previousExpressions,
			);
			if (previousName !== currentName) {
				applyAttributeBinding(element, previousName, null, previousExpression);
			}
		}
		applyAttributeBinding(
			element,
			currentName,
			context.currentExpressions[expressionIndex],
			previousExpression,
		);
	},
	remove: (element, binding, expressions) =>
		applyAttributeBinding(
			element,
			bindingToString(binding.keys, expressions),
			null,
			expressions[binding.values[0] as number],
		),
};

const dynamicNameMultiValueAttr: AttributeShapeHandler = {
	write: (context, index) => {
		const binding = context.parsedHTML.bindings[index] as AttributeBinding;
		const element = context.targets[index] as Element;
		const currentName = bindingToString(
			binding.keys,
			context.currentExpressions,
		);
		if (context.previousExpressions !== EMPTY_EXPRESSIONS) {
			const previousName = bindingToString(
				binding.keys,
				context.previousExpressions,
			);
			if (previousName !== currentName) {
				element.removeAttribute(previousName);
			}
		}
		applyAttributeBinding(
			element,
			currentName,
			bindingToString(binding.values, context.currentExpressions),
		);
	},
	remove: removeDynamicName,
};

const expandableAttr: AttributeShapeHandler = {
	write: (context, index) => {
		const binding = context.parsedHTML.bindings[index] as AttributeBinding;
		const element = context.targets[index] as Element;
		const slot = binding.values[0] as number;
		const current = context.currentExpressions[slot];

		if (context.previousExpressions === EMPTY_EXPRESSIONS) {
			applyExpandable(element, current);
			return;
		}

		const previous = context.previousExpressions[slot];
		if (isPlainObject(current) && isPlainObject(previous)) {
			diffExpandableObjects(element, previous, current);
			return;
		}
		removeExpandable(element, binding, context.previousExpressions);
		applyExpandable(element, current);
	},
	remove: removeExpandable,
};

export const updateAttribute = (context: HTMLTemplate, index: number) => {
	const binding = context.parsedHTML.bindings[index] as AttributeBinding;
	switch (binding.shape) {
		case ATTRIBUTE_SHAPE.STATIC:
			return staticAttr.write(context, index);
		case ATTRIBUTE_SHAPE.STATIC_NAME_SINGLE_VALUE:
			return staticNameSingleValueAttr.write(context, index);
		case ATTRIBUTE_SHAPE.STATIC_NAME_MULTI_VALUE:
			return staticNameMultiValueAttr.write(context, index);
		case ATTRIBUTE_SHAPE.DYNAMIC_NAME_BOOLEAN:
			return dynamicNameBooleanAttr.write(context, index);
		case ATTRIBUTE_SHAPE.DYNAMIC_NAME_SINGLE_VALUE:
			return dynamicNameSingleValueAttr.write(context, index);
		case ATTRIBUTE_SHAPE.DYNAMIC_NAME_MULTI_VALUE:
			return dynamicNameMultiValueAttr.write(context, index);
		case ATTRIBUTE_SHAPE.EXPANDABLE:
			return expandableAttr.write(context, index);
	}
};

export const removeAttributeBinding = (
	element: Element,
	binding: AttributeBinding,
	expressions: Array<unknown>,
) => {
	switch (binding.shape) {
		case ATTRIBUTE_SHAPE.STATIC:
			return staticAttr.remove(element, binding, expressions);
		case ATTRIBUTE_SHAPE.STATIC_NAME_SINGLE_VALUE:
			return staticNameSingleValueAttr.remove(element, binding, expressions);
		case ATTRIBUTE_SHAPE.STATIC_NAME_MULTI_VALUE:
			return staticNameMultiValueAttr.remove(element, binding, expressions);
		case ATTRIBUTE_SHAPE.DYNAMIC_NAME_BOOLEAN:
			return dynamicNameBooleanAttr.remove(element, binding, expressions);
		case ATTRIBUTE_SHAPE.DYNAMIC_NAME_SINGLE_VALUE:
			return dynamicNameSingleValueAttr.remove(element, binding, expressions);
		case ATTRIBUTE_SHAPE.DYNAMIC_NAME_MULTI_VALUE:
			return dynamicNameMultiValueAttr.remove(element, binding, expressions);
		case ATTRIBUTE_SHAPE.EXPANDABLE:
			return expandableAttr.remove(element, binding, expressions);
	}
};
