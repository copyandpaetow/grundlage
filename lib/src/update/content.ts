import { ContentBinding } from "../html/html";
import { HTMLTemplate } from "../template";

export class ContentHole {
	binding: ContentBinding;
	dynamicValues: Array<unknown> = [];
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
		const previous = this.dynamicValues[this.binding];
		const currentValue = values[this.binding];

		if (
			previous instanceof HTMLTemplate &&
			currentValue.hasOwnProperty("dynamicValues")
		) {
			//should the content be updated or re-rendered?

			previous.update(currentValue.dynamicValues);
			return;
		}
		const textNode = document.createTextNode(currentValue);

		let current = this.anchorStart.nextSibling;
		while (current && current !== this.anchorEnd) {
			const next = current.nextSibling;
			current.remove();
			current = next;
		}
		this.anchorStart.after(textNode);
		this.dynamicValues = values;
	}
}
