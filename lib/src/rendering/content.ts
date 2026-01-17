import { ContentDescriptor } from "../parser/parser-html";
import { HTMLTemplate } from "./template-html";

export class ContentBinding {
	#descriptor: ContentDescriptor;
	#marker: Comment;
	#updateId = -1;

	constructor(descriptor: ContentDescriptor, marker: Comment) {
		this.#descriptor = descriptor;
		this.#marker = marker;
	}

	update(context: HTMLTemplate) {
		if (this.#updateId === context.updateId) {
			return;
		}
		this.#updateId = context.updateId;

		if (this.#descriptor.values.length > 1) {
			//todo: handle comments. Maybe we need to strip the trailing and leading comment markers
			//* we can create a new comment like `new Comment(content)` and append that
			return;
		}

		const index = this.#descriptor.values[0] as number;

		const current = context.currentExpressions[index];
		const previous = context.previousExpressions[index];

		//if the new value is a renderTemplate, we need to check if the old one is also a renderTemplate and if they have the same templateHash
		if (current instanceof HTMLTemplate) {
			if (
				previous instanceof HTMLTemplate &&
				previous.parsedHTML.templateHash === current.parsedHTML.templateHash
			) {
				//if they do, we can update the old one just with new dynamic values
				previous.update(current.currentExpressions);
				//to not lose the reference we need to keep it in the currentValeus
				context.currentExpressions[index] = previous;
				return;
			}
			//otherwise we delete the old dom and render again
			this.#delete();
			this.#marker.after(current.setup());
			return;
		}

		this.#delete();

		const content = this.#toString(current);

		if (!content) {
			return;
		}

		this.#marker.after(document.createTextNode(content));
	}

	#toString(value: unknown): string {
		if (!value && typeof value !== "number") {
			return "";
		}
		if (typeof value === "function") {
			return this.#toString(value());
		}
		return value.toString();
	}

	#delete() {
		let current = this.#marker.nextSibling;
		while (
			current &&
			!(
				current.nodeType === 8 &&
				(current as Comment).data === this.#marker.data
			)
		) {
			const next = current.nextSibling;
			current.remove();
			current = next;
		}
	}
}
