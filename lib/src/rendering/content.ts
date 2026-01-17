import { ContentBinding } from "./parser-html";
import { HTMLTemplate } from "./template-html";

export class ContentHole {
	binding: ContentBinding;
	pointer: Comment;
	updateId = -1;

	constructor(binding: ContentBinding, pointer: Comment) {
		this.binding = binding;
		this.pointer = pointer;
	}

	update(context: HTMLTemplate) {
		if (this.updateId === context.updateId) {
			return;
		}
		this.updateId = context.updateId;

		if (this.binding.values.length > 1) {
			//todo: handle comments. Maybe we need to strip the trailing and leading comment markers
			//* we can create a new comment like `new Comment(content)` and append that
			return;
		}

		const index = this.binding.values[0] as number;

		const current = context.currentValues[index];
		const previous = context.previousValues[index];

		//if the new value is a renderTemplate, we need to check if the old one is also a renderTemplate and if they have the same templateHash
		if (current instanceof HTMLTemplate) {
			if (
				previous instanceof HTMLTemplate &&
				previous.templateResult.templateHash ===
					current.templateResult.templateHash
			) {
				//if they do, we can update the old one just with new dynamic values
				previous.update(current.currentValues);
				//to not lose the reference we need to keep it in the currentValeus
				context.currentValues[index] = previous;
				return;
			}
			//otherwise we delete the old dom and render again
			this.delete();
			this.pointer.after(current.setup());
			return;
		}

		this.delete();

		const content = this.toString(current);

		if (!content) {
			return;
		}

		this.pointer.after(document.createTextNode(content));
	}

	toString(value: unknown): string {
		if (!value && typeof value !== "number") {
			return "";
		}
		if (typeof value === "function") {
			return this.toString(value());
		}
		return value.toString();
	}

	delete() {
		let current = this.pointer.nextSibling;
		while (
			current &&
			!(
				current.nodeType === 8 &&
				(current as Comment).data === this.pointer.data
			)
		) {
			const next = current.nextSibling;
			current.remove();
			current = next;
		}
	}
}
