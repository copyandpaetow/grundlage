import { ContentBinding } from "./parser-html";
import { HTMLTemplate } from "./template-html";

export class ContentHole {
	binding: ContentBinding;
	anchorStart: Comment;
	anchorEnd: Comment;
	updateId = -1;

	constructor(binding: ContentBinding) {
		this.binding = binding;
	}

	setup(placeholder: HTMLElement, context: HTMLTemplate) {
		this.anchorStart = new Comment("content anchor start");
		this.anchorEnd = new Comment("content anchor end");

		placeholder.replaceWith(this.anchorStart, this.anchorEnd);

		this.update(context);
	}

	update(context: HTMLTemplate) {
		if (this.updateId === context.updateId) {
			return;
		}
		this.updateId = context.updateId;
		const current = context.currentValues[this.binding];
		const previous = context.previousValues[this.binding];

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
				context.currentValues[this.binding] = previous;
				return;
			}
			//otherwise we delete the old dom and render again
			this.delete();
			this.anchorStart.after(current.setup());
			return;
		}

		this.delete();

		const content = this.toString(current);

		if (!content) {
			return;
		}

		this.anchorStart.after(document.createTextNode(content));
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
		let current = this.anchorStart.nextSibling;
		while (current && current !== this.anchorEnd) {
			const next = current.nextSibling;
			current.remove();
			current = next;
		}
	}
}
