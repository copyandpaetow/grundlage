import { AttrBinding } from "./parser-html";
import { HTMLTemplate } from "./template-html";

export class AttributeHole {
	binding: AttrBinding;
	element: HTMLElement;
	updateId = -1;

	constructor(binding: AttrBinding) {
		this.binding = binding;
	}

	/*
	? if we have a boolean attribute that changes from something to nothing => it needs to be removed, we dont have a way to target it as we dont have a name anymore
	=> do we need to store them?
	- nested css classes


*/

	setup(placeholder: HTMLElement, context: HTMLTemplate) {
		this.element = placeholder;

		this.update(context);
	}

	update(context: HTMLTemplate) {
		if (this.updateId === context.updateId) {
			return;
		}
		this.updateId = context.updateId;

		if (this.binding.values.length === 0) {
			this.handleBooleanAttribute(this.binding.keys, context.currentValues);
			return;
		}
		const key = this.binding.keys
			.map((relatedIndex) =>
				typeof relatedIndex === "number"
					? context.currentValues[relatedIndex]
					: relatedIndex
			)
			.join("")
			.trim();

		if (
			key.slice(0, 2) === "on" &&
			typeof context.currentValues[this.binding.values[0]] === "function"
		) {
			this.setEventListener(
				key.slice(2).toLowerCase() as keyof HTMLElementEventMap,
				context.currentValues[this.binding.values[0]] as EventListener
			);
			return;
		}
		const value = this.binding.values
			.map((relatedIndex) =>
				typeof relatedIndex === "number"
					? context.currentValues[relatedIndex]
					: relatedIndex
			)
			.join("");
		this.setAttribute(key, value);
	}

	handleBooleanAttribute(keys: Array<unknown>, values: Array<unknown>) {
		if (keys.length > 1) {
			const key = this.binding.keys
				.map((relatedIndex) =>
					typeof relatedIndex === "number" ? values[relatedIndex] : relatedIndex
				)
				.join("")
				.trim();

			this.setBooleanAttribute(key);
			return;
		}

		const key = values[keys[0]];

		if (Array.isArray(key)) {
			key.forEach(this.setBooleanAttribute.bind(this));
			return;
		}
		if (typeof key === "object") {
			Object.entries(key).forEach(([attrKey, attrValue]) =>
				this.setAttribute(attrKey, attrValue)
			);
			return;
		}
	}

	setBooleanAttribute(key: string) {
		this.element.setAttribute(key, "");
	}

	setAttribute(key: string, value: unknown) {
		if (!value && typeof value !== "number") {
			this.element.removeAttribute(key);
			return;
		}
		this.element.setAttribute(key, value.toString());
	}

	setEventListener(key: keyof HTMLElementEventMap, callback: EventListener) {
		//TODO: since we have the old function we should be able to just remove the event without storing it
		if (this.event && this.key) {
			this.element.removeEventListener(this.key, this.event);
		}
		this.element.addEventListener(key, callback);
		this.event = callback;
		this.key = key;
	}
}
