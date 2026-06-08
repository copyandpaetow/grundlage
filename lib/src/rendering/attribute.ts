import { ATTRIBUTE_NAME_KIND, ATTRIBUTE_SHAPE, AttributeBinding, ValueOf } from "../parser/types";
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
		//`on-<name>`: explicit listener. nothing native uses the `on-` shape, so the dash is the signal — no IDL-property gate, so custom events bind without any registration
		return key.slice(3).toLowerCase();
	}
	//`on<name>`: native handlers (onclick, …), gated on the matching IDL property existing so arbitrary on* function props still fall through to property assignment
	const lowerKey = key.toLowerCase();
	return lowerKey in element ? lowerKey.slice(2) : null;
};

//a camelCase on<name> whose IDL property doesn't exist on this element: a function value gets written as a property that never fires (a typo'd `onClik` becomes a dead `element.onClik`). warn before that silent write.
//self-filtering so the single call site stays branch-free: on-<name> is exempt (it always binds a listener) and non-on* names aren't handlers, so both return without warning.
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
		//reached only when a function value didn't resolve to a listener. gated on the *current* value being the function so teardown (oldValue-only) doesn't re-warn the binding it already warned about on apply.
		if (valueIsFunction) warnIfDeadNativeHandler(key, element);
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

//apply every name a spread value currently owns — the "set everything" half, used on first render and as the fallback when the spread changes shape (array⇄object⇄primitive) so a diff would have nothing stable to align on
const applyExpandable = (element: Element, value: unknown) => {
	if (Array.isArray(value)) {
		for (let arrayIndex = 0; arrayIndex < value.length; arrayIndex++) {
			applyAttributeBinding(element, value[arrayIndex], "");
		}
	} else if (isPlainObject(value)) {
		//user-supplied object with arbitrary keys: iterate to spread each name→value
		for (const name in value) {
			applyAttributeBinding(element, name, value[name as keyof typeof value]);
		}
	} else if (value) {
		applyAttributeBinding(element, assertPrimitiveString(value), "");
	}
};

//object spread update: write only the names that actually changed. an unchanged entry (same key, same value reference) is skipped entirely, which for a function value means we keep the existing listener instead of detach+reattach every render.
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
		//oldValue threads through so a changed function value detaches the previous listener before binding the new one
		applyAttributeBinding(element, name, newValue, oldValue);
	}
	for (const name in previous) {
		//a name that was present and now isn't: remove it, passing the old value so a listener is torn down
		if (!(name in current)) {
			applyAttributeBinding(element, name, null, previous[name]);
		}
	}
};

//one unit per attribute shape: its write (apply to the DOM) and remove (teardown) halves sit together so they can't drift on what names the shape owns. the two entry points below each switch over the shape and call the half they need.
type AttributeShapeHandler = {
	write: (context: HTMLTemplate, index: number) => void;
	remove: (
		element: Element,
		binding: AttributeBinding,
		expressions: Array<unknown>,
	) => void;
};

//two shapes share each of these removes (static literal name; dynamic concatenated name). fewer params than the handler type is fine — TS lets a narrower function slot in.
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

//<div class="card"> — literal value, written once on first render
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

//<div class="${x}"> — single pass-through value (functions, objects, primitives)
const staticNameSingleValueAttr: AttributeShapeHandler = {
	write: (context, index) => {
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
	},
	//pass the parser's nameKind/eventName so teardown tears down a listener by the right name
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

//<div class="${a} ${b}"> — concatenated, always stringified
const staticNameMultiValueAttr: AttributeShapeHandler = {
	write: (context, index) => {
		const binding = context.parsedHTML.bindings[index] as AttributeBinding;
		const element = context.targets[index] as Element;
		//bindingToString always yields a string, so a function can never reach the listener path here — no oldValue needed, no leak possible.
		applyAttributeBinding(
			element,
			binding.keys[0] as string,
			bindingToString(binding.values, context.currentExpressions),
		);
	},
	remove: removeStaticName,
};

//<div data-${a}> — concatenated name, no value
const dynamicNameBooleanAttr: AttributeShapeHandler = {
	write: (context, index) => {
		const binding = context.parsedHTML.bindings[index] as AttributeBinding;
		const element = context.targets[index] as Element;
		const currentName = bindingToString(
			binding.keys,
			context.currentExpressions,
		);
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
	},
	remove: removeDynamicName,
};

//<div ${name}="${value}"> — concatenated name, single pass-through value
const dynamicNameSingleValueAttr: AttributeShapeHandler = {
	write: (context, index) => {
		const binding = context.parsedHTML.bindings[index] as AttributeBinding;
		const element = context.targets[index] as Element;
		const expressionIndex = binding.values[0] as number;
		const currentName = bindingToString(
			binding.keys,
			context.currentExpressions,
		);
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
	},
	remove: (element, binding, expressions) =>
		applyAttributeBinding(
			element,
			bindingToString(binding.keys, expressions),
			null,
			expressions[binding.values[0] as number],
		),
};

//<div ${name}="prefix ${value}"> — concatenated name and stringified value
const dynamicNameMultiValueAttr: AttributeShapeHandler = {
	write: (context, index) => {
		const binding = context.parsedHTML.bindings[index] as AttributeBinding;
		const element = context.targets[index] as Element;
		const currentName = bindingToString(
			binding.keys,
			context.currentExpressions,
		);
		if (context.previousExpressions.length > 0) {
			const previousName = bindingToString(
				binding.keys,
				context.previousExpressions,
			);
			if (previousName !== currentName) {
				element.removeAttribute(previousName);
			}
		}
		//same string-only invariant as the static-name multi-value path: no function reaches the listener path, so no oldValue and no leak.
		applyAttributeBinding(
			element,
			currentName,
			bindingToString(binding.values, context.currentExpressions),
		);
	},
	remove: removeDynamicName,
};

//<div ${attrs}> — object/array/string spread
const expandableAttr: AttributeShapeHandler = {
	write: (context, index) => {
		const binding = context.parsedHTML.bindings[index] as AttributeBinding;
		const element = context.targets[index] as Element;
		const slot = binding.keys[0] as number;
		const current = context.currentExpressions[slot];

		//first render: nothing was applied before, so there is nothing to diff against — apply everything
		if (context.previousExpressions.length === 0) {
			applyExpandable(element, current);
			return;
		}

		const previous = context.previousExpressions[slot];
		//object spread is where diffing pays: it carries listeners and complex values, so skipping unchanged keys avoids real detach/reattach churn
		if (isPlainObject(current) && isPlainObject(previous)) {
			diffExpandableObjects(element, previous, current);
			return;
		}
		//array spread (bare boolean-attr names) and shape changes fall back to clear-all + apply-all — for value-less names a membership diff costs more than the cheap add/removeAttribute it would guard
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

//removes every attribute name this binding represents under the given expressions snapshot; mirrors updateAttribute's switch over the same per-shape units so the write/remove sides can't drift on what a shape owns
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
