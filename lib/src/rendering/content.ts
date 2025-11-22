import { ContentBinding } from "./parser-html";
import { HTMLTemplate } from "./template";

export class ContentHole {
	binding: ContentBinding;
	anchorStart: Comment;
	anchorEnd: Comment;
	updateId = -1;

	constructor(binding: ContentBinding) {
		this.binding = binding;
	}

	/*
			- nested template vs the same nested template but different dynamic values
					- nested template vs other content (vis versa) => can we recycle the comments?
					- nested template A vs the nested template B
					- array of nested contents
			- nested css
	
	*/

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
