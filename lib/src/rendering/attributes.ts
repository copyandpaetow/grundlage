import { BaseComponent } from "../types";
import { AttrBinding } from "./parser-html";
import { HTMLTemplate } from "./template-html";

export class AttributeHole {
	binding: AttrBinding;
	pointer: Comment;
	updateId = -1;

	constructor(binding: AttrBinding, pointer: Comment) {
		this.binding = binding;
		this.pointer = pointer;
	}

	update(context: HTMLTemplate) {
		if (this.updateId === context.updateId) {
			return;
		}
		this.updateId = context.updateId;

		const key = this.buildAttribute(this.binding.keys, context.currentValues);
		const previousKey = this.buildAttribute(
			this.binding.keys,
			context.previousValues
		);

		if (typeof previousKey === "object") {
			if (Array.isArray(previousKey)) {
				previousKey.forEach((name) => this.removeAttribute(name, undefined));
			} else {
				Object.entries(previousKey!).forEach(([name, value]) =>
					this.removeAttribute(name, value)
				);
			}
		} else {
			this.removeAttribute(
				previousKey as string,
				this.buildAttribute(this.binding.values, context.previousValues)
			);
		}

		// Add new
		if (typeof key === "object") {
			if (Array.isArray(key)) {
				key.forEach((name) => this.addAttribute(name, ""));
			} else {
				Object.entries(key!).forEach(([name, value]) =>
					this.addAttribute(name, value)
				);
			}
		} else {
			this.addAttribute(
				key as string,
				this.buildAttribute(this.binding.values, context.currentValues)
			);
		}
	}

	buildAttribute(
		keyOrValue: Array<number | string>,
		currentValues: Array<unknown>
	) {
		if (keyOrValue.length === 1 && typeof keyOrValue[0] === "number") {
			return currentValues[keyOrValue[0]];
		}

		let attr = "";

		for (let index = 0; index < keyOrValue.length; index++) {
			const entry = keyOrValue[index];
			attr += typeof entry === "number" ? currentValues[index] : index;
		}

		return attr;
	}

	addAttribute(key: string, value: unknown) {
		const element = this.pointer.nextElementSibling!;
		if (typeof value === "function" && key.slice(0, 2) === "on") {
			const event = key.slice(2).toLowerCase() as keyof HTMLElementEventMap;
			element.addEventListener(event, value as EventListener);
			return;
		}

		customElements.upgrade(element);
		if ("setProperty" in element) {
			(element as BaseComponent).setProperty(key, value);
		}

		if (value === null || value === undefined || value === false) {
			return;
		}

		element.setAttribute(key, String(value));
	}

	removeAttribute(key: string, value: unknown) {
		const element = this.pointer.nextElementSibling!;
		if (typeof value === "function" && key.slice(0, 2) === "on") {
			const event = key.slice(2).toLowerCase() as keyof HTMLElementEventMap;
			element?.removeEventListener(event, value as EventListener);
			return;
		}

		if ("setProperty" in element) {
			(element as BaseComponent).setProperty(key, undefined);
			return;
		}

		element.removeAttribute(key);
	}
}
