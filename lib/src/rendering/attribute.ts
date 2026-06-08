import {
	AttributeBinding,
	ATTRIBUTE_NAME_KIND,
	ATTRIBUTE_SHAPE,
	ValueOf,
} from "../parser/types";
import { BaseComponent } from "../types";
import { bindingToString } from "../utils/binding-to-string";
import { assertPrimitiveString, isStringable } from "../utils/to-primitive";
import { isPlainObject } from "../utils/validators";
import { HTMLTemplate } from "./template-html";

//event-handler attributes always start with "on" (onclick, onsubmit, …)
//=> we sniff char codes ('o' = 111, 'n' = 110, '-' = 45) instead of `key.startsWith` so we avoid allocating a substring on every attribute write
const CHAR_LOWER_O = 111;
const CHAR_LOWER_N = 110;
const CHAR_DASH = 45;

//runtime fallback for names the parser couldn't classify (dynamic names, spread keys): derive the listener name from the resolved key, or null if it isn't an event
//static names skip this entirely — the parser pre-resolved their eventName at parse time (ATTRIBUTE_NAME_KIND)
const resolveEventNameFromKey = (key: string, element: Element): string | null => {
	if (key.charCodeAt(0) !== CHAR_LOWER_O || key.charCodeAt(1) !== CHAR_LOWER_N) {
		return null;
	}
	if (key.charCodeAt(2) === CHAR_DASH) {
		//`on-<name>`: explicit listener. nothing native uses the `on-` shape, so the dash is the signal — no IDL-property gate, so custom events bind without any registration
		return key.slice(3).toLowerCase();
	}
	//`on<name>`: native handlers (onclick, …), gated on the matching IDL property existing so arbitrary on* function props still fall through to property assignment
	const lowerKey = key.toLowerCase();
	return lowerKey in element ? lowerKey.slice(2) : null;
};

export const applyAttributeBinding = (
	element: Element,
	key: string,
	value: unknown,
	oldValue?: unknown,
	//pre-resolved by the parser for static names; defaulted so dynamic/spread callers fall through to the runtime probe
	nameKind: ValueOf<typeof ATTRIBUTE_NAME_KIND> = ATTRIBUTE_NAME_KIND.UNKNOWN,
	eventName = "",
) => {
	//Static class/id/data-* attributes never carry function values, so bail before touching the key.
	const valueIsFunction = typeof value === "function";
	const oldValueIsFunction = typeof oldValue === "function";
	if (valueIsFunction || oldValueIsFunction) {
		let listenerName: string | null = null;
		switch (nameKind) {
			case ATTRIBUTE_NAME_KIND.EXPLICIT_EVENT:
				listenerName = eventName;
				break;
			case ATTRIBUTE_NAME_KIND.NATIVE_EVENT:
				//IDL gate stays at write time (it depends on the element instance); the name itself is already resolved
				if ("on" + eventName in element) listenerName = eventName;
				break;
			case ATTRIBUTE_NAME_KIND.PLAIN:
				//static non-on* name: never a listener — fall through to value handling below
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

		//writing a complex value as a property is how we pass props into a child component. if it exposes update(), nudge it to re-render against the new value
		if ("update" in element) {
			(element as BaseComponent).update();
		}
	}
};

//the spread/cleanup half of EXPANDABLE bindings lives here so both updateExpandable and removeAttributeBinding share one definition of "what names does this binding currently own"
const removeExpandable = (
	element: Element,
	binding: AttributeBinding,
	expressions: Array<unknown>,
) => {
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
};

//on the very first render previousExpressions is empty. aliasing to current makes the upcoming removeExpandable call a no-op against a freshly-cloned element (every removeAttribute / removeEventListener targets something that was never set) without a separate "skip cleanup on first render" branch
const resolvePreviousExpressions = (context: HTMLTemplate) =>
	context.previousExpressions.length > 0
		? context.previousExpressions
		: context.currentExpressions;

const updateStatic = (context: HTMLTemplate, index: number) => {
	const binding = context.parsedHTML.bindings[index] as AttributeBinding;
	const element = context.targets[index] as Element;
	const value =
		binding.values.length === 0 ? "" : (binding.values[0] as string);
	applyAttributeBinding(element, binding.keys[0] as string, value);
};

const updateStaticNameSingleValue = (context: HTMLTemplate, index: number) => {
	const binding = context.parsedHTML.bindings[index] as AttributeBinding;
	const element = context.targets[index] as Element;
	const expressionIndex = binding.values[0] as number;
	const previousExpression =
		context.previousExpressions.length > 0
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
};

const updateStaticNameMultiValue = (context: HTMLTemplate, index: number) => {
	const binding = context.parsedHTML.bindings[index] as AttributeBinding;
	const element = context.targets[index] as Element;
	applyAttributeBinding(
		element,
		binding.keys[0] as string,
		bindingToString(binding.values, context.currentExpressions),
	);
};

const updateDynamicNameBoolean = (context: HTMLTemplate, index: number) => {
	const binding = context.parsedHTML.bindings[index] as AttributeBinding;
	const element = context.targets[index] as Element;
	const currentName = bindingToString(binding.keys, context.currentExpressions);
	//on initial render the previous name equals the current name by construction, so we only spend a second bindingToString allocation on real updates
	if (context.previousExpressions.length > 0) {
		const previousName = bindingToString(
			binding.keys,
			context.previousExpressions,
		);
		if (previousName !== currentName) {
			element.removeAttribute(previousName);
		}
	}
	applyAttributeBinding(element, currentName, "");
};

const updateDynamicNameSingleValue = (context: HTMLTemplate, index: number) => {
	const binding = context.parsedHTML.bindings[index] as AttributeBinding;
	const element = context.targets[index] as Element;
	const expressionIndex = binding.values[0] as number;
	const currentName = bindingToString(binding.keys, context.currentExpressions);
	const hasPrevious = context.previousExpressions.length > 0;
	const previousExpression = hasPrevious
		? context.previousExpressions[expressionIndex]
		: undefined;
	if (hasPrevious) {
		const previousName = bindingToString(
			binding.keys,
			context.previousExpressions,
		);
		if (previousName !== currentName) {
			//pass previousExpression as oldValue so the event-listener / property cleanup path inside applyAttributeBinding still runs against the right name
			applyAttributeBinding(element, previousName, null, previousExpression);
		}
	}
	applyAttributeBinding(
		element,
		currentName,
		context.currentExpressions[expressionIndex],
		previousExpression,
	);
};

const updateDynamicNameMultiValue = (context: HTMLTemplate, index: number) => {
	const binding = context.parsedHTML.bindings[index] as AttributeBinding;
	const element = context.targets[index] as Element;
	const currentName = bindingToString(binding.keys, context.currentExpressions);
	if (context.previousExpressions.length > 0) {
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
};

const updateExpandable = (context: HTMLTemplate, index: number) => {
	const binding = context.parsedHTML.bindings[index] as AttributeBinding;
	const element = context.targets[index] as Element;
	removeExpandable(element, binding, resolvePreviousExpressions(context));

	const current = context.currentExpressions[binding.keys[0] as number];
	if (Array.isArray(current)) {
		for (let arrayIndex = 0; arrayIndex < current.length; arrayIndex++) {
			applyAttributeBinding(element, current[arrayIndex], "");
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
	const binding = context.parsedHTML.bindings[index] as AttributeBinding;
	switch (binding.shape) {
		case ATTRIBUTE_SHAPE.STATIC:
			updateStatic(context, index);
			return;
		case ATTRIBUTE_SHAPE.STATIC_NAME_SINGLE_VALUE:
			updateStaticNameSingleValue(context, index);
			return;
		case ATTRIBUTE_SHAPE.STATIC_NAME_MULTI_VALUE:
			updateStaticNameMultiValue(context, index);
			return;
		case ATTRIBUTE_SHAPE.DYNAMIC_NAME_BOOLEAN:
			updateDynamicNameBoolean(context, index);
			return;
		case ATTRIBUTE_SHAPE.DYNAMIC_NAME_SINGLE_VALUE:
			updateDynamicNameSingleValue(context, index);
			return;
		case ATTRIBUTE_SHAPE.DYNAMIC_NAME_MULTI_VALUE:
			updateDynamicNameMultiValue(context, index);
			return;
		case ATTRIBUTE_SHAPE.EXPANDABLE:
			updateExpandable(context, index);
			return;
	}
};

//removes every attribute name this binding represents under the given expressions snapshot
//keeping the per-shape removal logic alongside the apply logic above guarantees the cleanup and apply paths can't drift on what names a binding owns
export const removeAttributeBinding = (
	element: Element,
	binding: AttributeBinding,
	expressions: Array<unknown>,
) => {
	switch (binding.shape) {
		case ATTRIBUTE_SHAPE.STATIC:
		case ATTRIBUTE_SHAPE.STATIC_NAME_MULTI_VALUE:
			applyAttributeBinding(element, binding.keys[0] as string, null);
			return;
		case ATTRIBUTE_SHAPE.STATIC_NAME_SINGLE_VALUE:
			applyAttributeBinding(
				element,
				binding.keys[0] as string,
				null,
				expressions[binding.values[0] as number],
				binding.nameKind,
				binding.eventName,
			);
			return;
		case ATTRIBUTE_SHAPE.DYNAMIC_NAME_BOOLEAN:
		case ATTRIBUTE_SHAPE.DYNAMIC_NAME_MULTI_VALUE:
			applyAttributeBinding(
				element,
				bindingToString(binding.keys, expressions),
				null,
			);
			return;
		case ATTRIBUTE_SHAPE.DYNAMIC_NAME_SINGLE_VALUE:
			applyAttributeBinding(
				element,
				bindingToString(binding.keys, expressions),
				null,
				expressions[binding.values[0] as number],
			);
			return;
		case ATTRIBUTE_SHAPE.EXPANDABLE:
			removeExpandable(element, binding, expressions);
			return;
	}
};
