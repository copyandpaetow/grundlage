import { AttrBinding } from "../html/html";

export class AttributeHole {
	binding: AttrBinding;
	anchor: Comment;

	constructor(
		binding: AttrBinding,
		dynamicValues: Array<unknown>,
		placeholder: HTMLElement
	) {
		this.binding = binding;
		this.anchor = new Comment("attr");
		placeholder.prepend(this.anchor);
		this.update(dynamicValues);
	}

	/*
- eventlistener
- nested css classes

*/

	update(values: Array<unknown>) {
		const key = this.binding.keys
			.map((relatedIndex) =>
				typeof relatedIndex === "number" ? values[relatedIndex] : relatedIndex
			)
			.join("");
		const value = this.binding.values
			.map((relatedIndex) =>
				typeof relatedIndex === "number" ? values[relatedIndex] : relatedIndex
			)
			.join("");

		this.anchor.parentElement!.setAttribute(key, value);
	}
}
