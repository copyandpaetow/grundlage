import {
	MARKER_INDEX_END,
	MARKER_INDEX_START,
	TagDescriptor,
} from "../parser/parser-html";
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

		this.#updateRelated(context);

		return;
	}

	#updateRelated(context: HTMLTemplate) {
		let marker = this.#marker;

		while (marker.nextSibling?.nodeType === 8) {
			marker = marker.nextSibling as Comment;
			const relatedIndex = parseInt(
				marker.substringData(MARKER_INDEX_START, MARKER_INDEX_END),
			);
			if (isNaN(relatedIndex)) {
				continue;
			}

			context.bindings[relatedIndex].update(context);
		}
	}

	#getTag(values: Array<unknown>) {
		let tag = "";

		for (const relatedIndex of this.#descriptor.values) {
			tag +=
				typeof relatedIndex === "number"
					? toPrimitive(values[relatedIndex])
					: relatedIndex;
		}
		return tag;
	}
}
