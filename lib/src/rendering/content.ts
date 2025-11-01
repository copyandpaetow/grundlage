import { ContentBinding } from "./html";
import { HTMLTemplate } from "./template";

export class ContentHole {
	binding: ContentBinding;
	previous: unknown = null;
	anchorStart: Comment;
	anchorEnd: Comment;

	constructor(
		binding: ContentBinding,
		dynamicValues: Array<unknown>,
		placeholder: HTMLElement
	) {
		this.binding = binding;
		this.anchorStart = new Comment("content anchor start");
		this.anchorEnd = new Comment("content anchor end");

		placeholder.replaceWith(this.anchorStart, this.anchorEnd);

		this.update(dynamicValues);
	}

	/*
			- nested template vs the same nested template but different dynamic values
					- nested template vs other content (vis versa) => can we recycle the comments?
					- nested template A vs the nested template B
					- array of nested contents
			- nested css
	
	*/

	update(values: Array<unknown>) {
		const currentValue = values[this.binding];

		//if the new value is a renderTemplate, we need to check if the old one is also a renderTemplate and if they have the same templateHash
		if (currentValue instanceof HTMLTemplate) {
			if (
				this.previous instanceof HTMLTemplate &&
				this.previous.templateResult.templateHash ===
					currentValue.templateResult.templateHash
			) {
				//if they do, we can update the old one just with new dynamic values
				this.previous.update(currentValue.dynamicValues);
				return;
			}
			//otherwise we delete the old dom and render again
			this.delete();
			this.anchorStart.after(currentValue.setup());
			this.previous = currentValue;
			return;
		}

		this.delete();

		const content = this.toString(currentValue);
		this.previous = currentValue;

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
