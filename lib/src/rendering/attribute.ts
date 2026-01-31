import { BaseComponent } from "../types";
import { AttributeDescriptor } from "../parser/parser-html";
import { HTMLTemplate } from "./template-html";
import { toPrimitive } from "../utils/to-primitve";

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
			context.currentExpressions,
		);
		const previousKey = this.#buildAttribute(
			this.#descriptor.keys,
			context.previousExpressions.length > 0
				? context.previousExpressions
				: context.currentExpressions,
		);

		if (typeof previousKey === "object") {
			if (Array.isArray(previousKey)) {
				for (const name of previousKey) {
					this.#removeAttribute(name, undefined);
				}
			} else {
				for (const name in previousKey) {
					this.#removeAttribute(
						name,
						previousKey[name as keyof typeof previousKey],
					);
				}
			}
		} else {
			this.#removeAttribute(
				previousKey as string,
				this.#buildAttribute(
					this.#descriptor.values,
					context.previousExpressions.length > 0
						? context.previousExpressions
						: context.currentExpressions,
				),
			);
		}

		if (typeof key === "object") {
			if (Array.isArray(key)) {
				for (const name of key) {
					this.#addAttribute(name, "");
				}
			} else {
				for (const name in key) {
					this.#addAttribute(name, key[name as keyof typeof key]);
				}
			}
		} else {
			this.#addAttribute(
				key as string,
				this.#buildAttribute(
					this.#descriptor.values,
					context.currentExpressions,
				),
			);
		}
	}

	#buildAttribute(
		descriptorContent: Array<number | string>,
		currentValues: Array<unknown>,
	) {
		if (
			descriptorContent.length === 1 &&
			typeof descriptorContent[0] === "number"
		) {
			const entry = currentValues[descriptorContent[0]];
			if (
				Array.isArray(entry) ||
				(entry !== null && typeof entry === "object")
			) {
				return entry;
			}
			if (
				typeof entry === "function" ||
				entry === null ||
				entry === undefined
			) {
				return entry;
			}

			return toPrimitive(entry);
		}

		let attr = "";

		for (const key of descriptorContent) {
			attr += typeof key === "number" ? toPrimitive(currentValues[key]) : key;
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
			return;
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
