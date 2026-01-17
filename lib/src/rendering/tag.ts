import { TagDescriptor } from "../parser/parser-html";
import { toPrimitive } from "../utils/to-primitve";
import { HTMLTemplate } from "./template-html";

export class TagBinding {
	#descriptor: TagDescriptor;
	#marker: Comment;
	#updateId = -1;

	constructor(descriptor: TagDescriptor, marker: Comment) {
		this.#descriptor = descriptor;
		this.#marker = marker;
	}

	update(context: HTMLTemplate) {
		if (this.#updateId === context.updateId) {
			return;
		}
		this.#updateId = context.updateId;

		const element = this.#marker.nextElementSibling!;
		const newTag = this.#getTag(context.currentExpressions);

		const newElement = document.createElement(newTag);
		for (const attr of element.attributes) {
			newElement.setAttribute(attr.name, attr.value);
		}

		newElement.replaceChildren(...element.childNodes);
		element.replaceWith(newElement);

		return;
	}

	#getTag(values: Array<unknown>) {
		return this.#descriptor.values
			.map((relatedIndex) =>
				typeof relatedIndex === "number"
					? toPrimitive(values[relatedIndex])
					: relatedIndex
			)
			.join("");
	}
}
