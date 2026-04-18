import {AttributeBinding} from "../parser/types";
import {BaseComponent} from "../types";
import {bindingToString} from "../utils/binding-to-string";
import {isStringable, toPrimitive} from "../utils/to-primitive";
import {isObject} from "../utils/validators";
import {HTMLTemplate} from "./template-html";

const isEventListener = (element: Element, key: string, value: unknown) => {
    if (typeof value !== "function") {
        return false;
    }
    return key.startsWith("on") && key.toLowerCase() in element;
};

export const addOrRemoveProperty = (
    element: Element,
    key: string,
    value: unknown,
    oldValue?: unknown,
) => {
    if (
        isEventListener(element, key, value) ||
        isEventListener(element, key, oldValue)
    ) {
        const event = key.slice(2).toLowerCase();
        if (oldValue) {
            element.removeEventListener(event, oldValue as EventListener);
        }
        if (value) {
            element.addEventListener(event, value as EventListener);
        }
        return;
    }

    if (value === null || value === undefined || value === false) {
        element.removeAttribute(key);
        return;
    }

    if (isStringable(value)) {
        if (oldValue !== undefined && !isStringable(oldValue)) {
            // Clean up the JS property that was previously set for a complex value
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
            addOrRemoveProperty(element, previous[index], null);
        }
    } else if (isObject(previous)) {
        for (const name in previous) {
            addOrRemoveProperty(
                element,
                name,
                null,
                previous[name as keyof typeof previous],
            );
        }
    } else if (previous) {
        addOrRemoveProperty(element, toPrimitive(previous), null);
    }

    if (Array.isArray(current)) {
        for (let index = 0; index < current.length; index++) {
            addOrRemoveProperty(element, current[index], "");
        }
    } else if (isObject(current)) {
        for (const name in current) {
            addOrRemoveProperty(
                element,
                name,
                current[name as keyof typeof previous],
            );
        }
    } else if (current) {
        addOrRemoveProperty(element, toPrimitive(current), "");
    }
};

export const updateAttribute = (context: HTMLTemplate, index: number) => {
    const element = context.markers[index].nextElementSibling!;
    const binding = context.parsedHTML.bindings[index] as AttributeBinding;

    const isBooleanAttribute = binding.values.length === 0;
    const isExpandable = binding.keys.length === 1;

    const previousExpressions = context.previousExpressions.length > 0
        ? context.previousExpressions
        : context.currentExpressions;

    if (isBooleanAttribute && isExpandable) {
        handleExpandableAttribute(context, element, binding.keys[0] as number, previousExpressions);
        return;
    }


    const isStaticName = binding.keys.length === 1 && typeof binding.keys[0] === "string";
    const currentName = isStaticName
        ? binding.keys[0] as string
        : bindingToString(binding.keys, context.currentExpressions);
    const previousName = isStaticName
        ? currentName
        : bindingToString(binding.keys, previousExpressions);

    if (isBooleanAttribute) {
        if (!isStaticName) {
            addOrRemoveProperty(element, previousName, null);
        }
        addOrRemoveProperty(element, currentName, "");
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
        addOrRemoveProperty(element, previousName, null, previousExpression);
    }

    addOrRemoveProperty(element, currentName, currentValue, previousExpression);
};
