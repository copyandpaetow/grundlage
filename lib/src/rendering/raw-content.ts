import { RawContentBinding } from "./parser-html";
import { HTMLTemplate } from "./template-html";

export class RawContentHole {
	binding: RawContentBinding;
	pointer: Comment;
	updateId = -1;

	constructor(binding: RawContentBinding, pointer: Comment) {
		this.binding = binding;
		this.pointer = pointer;
	}

	update(context: HTMLTemplate) {
		if (this.updateId === context.updateId) {
			return;
		}
		this.updateId = context.updateId;

		let rawTextContent = "";
		for (let index = 0; index < this.binding.values.length; index++) {
			const entry = this.binding.values[index];
			rawTextContent +=
				typeof entry === "string"
					? entry
					: this.toString(context.currentValues[entry]);
		}
		this.pointer.nextElementSibling!.textContent = rawTextContent;
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
}
