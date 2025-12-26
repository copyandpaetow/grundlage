import { TagBinding } from "./parser-html";
import { HTMLTemplate } from "./template-html";

export class TagHole {
	binding: TagBinding;
	pointer: Comment;
	updateId = -1;

	constructor(binding: TagBinding, pointer: Comment) {
		this.binding = binding;
		this.pointer = pointer;
	}

	update(context: HTMLTemplate) {
		if (this.updateId === context.updateId) {
			return;
		}
		this.updateId = context.updateId;

		const element = this.pointer.nextElementSibling!;
		const newTag = this.getTag(context.currentValues);

		const newElement = document.createElement(newTag);
		element
			.getAttributeNames()
			.forEach((name) =>
				newElement.setAttribute(name, element.getAttribute(name)!)
			);

		newElement.replaceChildren(...element.childNodes);
		element.replaceWith(newElement);

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
