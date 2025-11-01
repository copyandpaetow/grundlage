import { TagBinding } from "./html";

export class TagHole {
	binding: TagBinding;
	anchor: Comment;
	relatedAttributes: Array<number>;

	constructor(
		binding: TagBinding,
		dynamicValues: Array<unknown>,
		placeholder: HTMLElement
	) {
		this.binding = binding;
		this.anchor = new Comment("tag");
		this.relatedAttributes = [];
		//TODO: maybe we can skip the comment here and store the element itself
		//? or are there cases where the element gets replaced and not rerendered?

		for (const name of placeholder.getAttributeNames()) {
			const attributeIndex = name.split("data-replace-")[1];
			if (attributeIndex) {
				this.relatedAttributes.push(parseInt(attributeIndex));
			}
		}

		placeholder.prepend(this.anchor);
		this.update(dynamicValues);
	}

	update(
		values: Array<unknown>,
		forceUpdate?: (indices: Array<number>) => void
	) {
		const placeholder = this.anchor.parentElement!;
		const newTag = this.binding.values
			.map((relatedIndex) =>
				typeof relatedIndex === "number"
					? this.toString(values[relatedIndex])
					: relatedIndex
			)
			.join("");

		const newElement = document.createElement(newTag);
		placeholder
			.getAttributeNames()
			.forEach((name) =>
				newElement.setAttribute(name, placeholder.getAttribute(name)!)
			);

		newElement.replaceChildren(...placeholder.childNodes);
		placeholder.replaceWith(newElement);

		if (this.relatedAttributes.length) {
			forceUpdate?.(this.relatedAttributes);
		}

		return;
	}

	toString(value: unknown): string {
		if (typeof value === "function") {
			return this.toString(value());
		}
		if (typeof value === "number") {
			return value.toString();
		}

		if (Array.isArray(value)) {
			return value.join("");
		}
		if (typeof value === "string") {
			return value;
		}

		throw Error("value cant be made into a string");
	}
}
