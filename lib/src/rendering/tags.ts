import { TagBinding } from "./html";

export class TagHole {
	binding: TagBinding;
	anchor: Comment;

	constructor(
		binding: TagBinding,
		dynamicValues: Array<unknown>,
		placeholder: HTMLElement
	) {
		this.binding = binding;
		this.anchor = new Comment("tag");

		placeholder.prepend(this.anchor);
		this.update(dynamicValues);
	}

	update(values: Array<unknown>) {
		const placeholder = this.anchor.parentElement!;
		const newTag = this.binding.values
			.map((relatedIndex) =>
				typeof relatedIndex === "number" ? values[relatedIndex] : relatedIndex
			)
			.join(""); //functions in here would need to get called

		const newElement = document.createElement(newTag);
		placeholder
			.getAttributeNames()
			.forEach((name) =>
				newElement.setAttribute(name, placeholder.getAttribute(name)!)
			);

		newElement.replaceChildren(...placeholder.childNodes);
		placeholder.replaceWith(newElement);
	}
}
