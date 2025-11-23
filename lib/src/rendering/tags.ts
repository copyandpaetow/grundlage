import { TagBinding } from "./parser-html";
import { HTMLTemplate } from "./template-html";

export class TagHole {
	binding: TagBinding;
	element: HTMLElement;
	relatedAttributes: Array<number> = [];
	updateId = -1;

	constructor(binding: TagBinding) {
		this.binding = binding;
	}

	setup(placeholder: HTMLElement, context: HTMLTemplate) {
		this.relatedAttributes.length = 0;
		this.element = placeholder;

		for (const name of placeholder.getAttributeNames()) {
			const attributeIndex = name.split("data-replace-")[1];
			if (attributeIndex) {
				this.relatedAttributes.push(parseInt(attributeIndex));
			}
		}

		this.update(context);
	}

	update(context: HTMLTemplate) {
		if (this.updateId === context.updateId) {
			return;
		}
		this.updateId = context.updateId;
		const placeholder = this.element;
		const newTag = this.getTag(context.currentValues);

		const newElement = document.createElement(newTag);
		placeholder
			.getAttributeNames()
			.forEach((name) =>
				newElement.setAttribute(name, placeholder.getAttribute(name)!)
			);

		newElement.replaceChildren(...placeholder.childNodes);
		placeholder.replaceWith(newElement);
		this.element = newElement;

		this.relatedAttributes.forEach((attrIndex) => {
			context.bindings[attrIndex].setup(newElement, context);
		});

		return;
	}

	getTag(values: Array<unknown>) {
		return this.binding.values
			.map((relatedIndex) =>
				typeof relatedIndex === "number"
					? this.toString(values[relatedIndex])
					: relatedIndex
			)
			.join("");
	}

	toString(value: unknown): string {
		if (typeof value === "function") {
			return this.toString(value());
		}
		if (typeof value === "number") {
			return value.toString();
		}

		if (Array.isArray(value)) {
			return value.join("");
		}
		if (typeof value === "string") {
			return value;
		}

		throw Error("value cant be made into a string");
	}
}
