import { BaseComponent } from "../types";
import { AttributeDescriptor } from "../parser/parser-html";
import { HTMLTemplate } from "./template-html";

export class AttributeBinding {
	#descriptor: AttributeDescriptor;
	#marker: Comment;
	#updateId = -1;

	constructor(descriptor: AttributeDescriptor, marker: Comment) {
		this.#descriptor = descriptor;
		this.#marker = marker;
	}

	update(context: HTMLTemplate) {
		if (this.#updateId === context.updateId) {
			return;
		}
		this.#updateId = context.updateId;

		const key = this.#buildAttribute(
			this.#descriptor.keys,
			context.currentExpressions
		);
		const previousKey = this.#buildAttribute(
			this.#descriptor.keys,
			context.previousExpressions
		);

		if (typeof previousKey === "object") {
			if (Array.isArray(previousKey)) {
				for (const name of previousKey) {
					this.#removeAttribute(name, undefined);
				}
			} else {
				for (const name in previousKey as object) {
					this.#removeAttribute(name, previousKey[name]);
				}
			}
		} else {
			this.#removeAttribute(
				previousKey as string,
				this.#buildAttribute(
					this.#descriptor.values,
					context.previousExpressions
				)
			);
		}

		// Add new
		if (typeof key === "object") {
			if (Array.isArray(key)) {
				for (const name of key) {
					this.#removeAttribute(name, "");
				}
			} else {
				for (const name in key) {
					this.#addAttribute(name, key[name]);
				}
			}
		} else {
			this.#addAttribute(
				key as string,
				this.#buildAttribute(
					this.#descriptor.values,
					context.currentExpressions
				)
			);
		}
	}

	#buildAttribute(
		keyOrValue: Array<number | string>,
		currentValues: Array<unknown>
	) {
		if (keyOrValue.length === 1 && typeof keyOrValue[0] === "number") {
			return currentValues[keyOrValue[0]];
		}

		let attr = "";

		for (let index = 0; index < keyOrValue.length; index++) {
			const entry = keyOrValue[index];
			attr += typeof entry === "number" ? currentValues[entry] : entry;
		}

		return attr;
	}

	#addAttribute(key: string, value: unknown) {
		const element = this.#marker.nextElementSibling!;
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

	#removeAttribute(key: string, value: unknown) {
		const element = this.#marker.nextElementSibling!;
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
